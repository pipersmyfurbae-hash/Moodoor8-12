/**
 * API tests — auth, authorisation, CRUD, validation, import, publish.
 * Each test file gets its own throwaway database, so nothing here touches the
 * development data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp, parseCsv, normaliseInventoryPayload } = require('../server/index.js');

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'moodoor-test-')), 'test.sqlite');
const app = createApp({ dbFile, email: 'test@moodoor.test', password: 'test-password-123' });

let base;
await new Promise((r) => app.server.listen(0, () => {
  base = `http://127.0.0.1:${app.server.address().port}`;
  r();
}));
test.after(() => app.server.close());

let cookie = '';
async function call(method, path, body, opts = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.anon ? {} : cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.()[0];
  if (setCookie && !opts.keepCookie) cookie = setCookie.split(';')[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

test('the database seeds from the shipped storefront', () => {
  assert.equal(app.boot.counts.products, 10);
  assert.equal(app.boot.counts.territories, 6);
  assert.equal(app.boot.counts.bundles, 3);
  assert.equal(app.boot.counts.drops, 3);
  assert.ok(app.boot.counts.inventory > 500);
});

test('health reports live counts', async () => {
  const { status, json } = await call('GET', '/api/health', null, { anon: true });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.products, 10);
});

/* ------------------------------------------------------------------ *
 * Authorisation — every admin surface must be closed by default
 * ------------------------------------------------------------------ */

test('every admin route rejects an anonymous caller', async () => {
  const routes = [
    ['GET', '/api/admin/summary'], ['GET', '/api/admin/products'],
    ['POST', '/api/admin/products'], ['PATCH', '/api/admin/products/september-porch'],
    ['DELETE', '/api/admin/products/september-porch'],
    ['POST', '/api/admin/inventory/import'],
    ['POST', '/api/admin/concepts/x/publish'], ['POST', '/api/auth/password'],
  ];
  for (const [method, route] of routes) {
    const { status } = await call(method, route, method === 'GET' ? null : {}, { anon: true });
    assert.equal(status, 401, `${method} ${route} should be 401 for an anonymous caller`);
  }
});

test('public reads need no session', async () => {
  for (const kind of ['products', 'bundles', 'territories', 'drops', 'stories', 'content']) {
    const { status, json } = await call('GET', `/api/public/${kind}`, null, { anon: true });
    assert.equal(status, 200, kind);
    assert.ok(json.data !== undefined, kind);
  }
});

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await call('POST', '/api/auth/login', { email: 'test@moodoor.test', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(cookie, '', 'no session cookie is issued on a failed login');

  const ok = await call('POST', '/api/auth/login', { email: 'test@moodoor.test', password: 'test-password-123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, 'admin');
  assert.match(cookie, /^moodoor_session=/);
});

test('a signed-in owner is recognised', async () => {
  const { json } = await call('GET', '/api/auth/me');
  assert.equal(json.user.email, 'test@moodoor.test');
});

/* ------------------------------------------------------------------ *
 * CRUD
 * ------------------------------------------------------------------ */

test('admin can list every collection with its writable fields', async () => {
  for (const kind of Object.keys(app.RESOURCES)) {
    const { status, json } = await call('GET', `/api/admin/${kind}`);
    assert.equal(status, 200, kind);
    assert.ok(Array.isArray(json.data), kind);
    assert.ok(json.writable.length > 0, kind);
    assert.ok(json.key, kind);
  }
});

test('creating, editing and deleting a design round-trips', async () => {
  const created = await call('POST', '/api/admin/products', {
    slug: 'test-design', name: 'Test Design', territory: 'Comfort',
    price: 210, inventoryQuantity: 3, runLimit: 5,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.name, 'Test Design');

  const listed = await call('GET', '/api/public/products', null, { anon: true });
  assert.ok(listed.json.data.some((p) => p.slug === 'test-design'), 'appears publicly once published');

  const patched = await call('PATCH', '/api/admin/products/test-design', { price: 265, lede: 'Edited.' });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.price, 265);
  assert.equal(patched.json.data.name, 'Test Design', 'an unmentioned field is left alone');

  const removed = await call('DELETE', '/api/admin/products/test-design');
  assert.equal(removed.status, 200);
  assert.equal((await call('DELETE', '/api/admin/products/test-design')).status, 404);
});

test('an unpublished record disappears from the public API but not the admin one', async () => {
  await call('PATCH', '/api/admin/products/white-hour', { isPublished: 0 });
  const pub = await call('GET', '/api/public/products', null, { anon: true });
  assert.ok(!pub.json.data.some((p) => p.slug === 'white-hour'), 'hidden from the storefront');
  assert.equal((await call('GET', '/api/public/products/white-hour', null, { anon: true })).status, 404);

  const admin = await call('GET', '/api/admin/products');
  assert.ok(admin.json.data.some((p) => p.slug === 'white-hour'), 'still editable by the owner');

  await call('PATCH', '/api/admin/products/white-hour', { isPublished: 1 });
});

test('duplicate slugs are refused, not silently merged', async () => {
  const { status, json } = await call('POST', '/api/admin/products', {
    slug: 'september-porch', name: 'Clash', territory: 'Comfort',
  });
  assert.equal(status, 409);
  assert.match(json.error, /already exists/i);
});

test('required fields are enforced', async () => {
  const { status, json } = await call('POST', '/api/admin/products', { slug: 'no-name-here' });
  assert.equal(status, 400);
  assert.match(json.error, /required/i);
});

test('enum fields reject a value outside the set', async () => {
  const { status, json } = await call('PATCH', '/api/admin/drops/high-summer', { status: 'whenever' });
  assert.equal(status, 400);
  assert.match(json.error, /must be one of/);
});

test('fields outside the allow-list are ignored, not written', async () => {
  const { status } = await call('PATCH', '/api/admin/products/september-porch', {
    price: 350, id: 9999, createdAt: '1999-01-01', updatedBy: 4242,
  });
  assert.equal(status, 200);
  const row = (await call('GET', '/api/admin/products')).json.data.find((p) => p.slug === 'september-porch');
  assert.notEqual(row.id, 9999, 'id is not client-writable');
  assert.notEqual(row.createdAt, '1999-01-01', 'createdAt is not client-writable');
  assert.equal(row.price, 350);
});

test('editing a record changes what the storefront serves', async () => {
  await call('PATCH', '/api/admin/territories/comfort', { lede: 'A brand new lede.', designCount: 99 });
  const pub = await call('GET', '/api/public/territories', null, { anon: true });
  const comfort = pub.json.data.find((t) => t.slug === 'comfort');
  assert.equal(comfort.lede, 'A brand new lede.');
  assert.equal(comfort.designCount, 99);
});

test('a 404 is returned for an unknown record and an unknown collection', async () => {
  assert.equal((await call('PATCH', '/api/admin/products/nope', { price: 1 })).status, 404);
  assert.equal((await call('GET', '/api/admin/nonsense')).status, 404);
  assert.equal((await call('GET', '/api/public/nonsense', null, { anon: true })).status, 404);
});

/* ------------------------------------------------------------------ *
 * Public shape — what the storefront actually reads
 * ------------------------------------------------------------------ */

test('public products carry the fields the product page reads', async () => {
  const { json } = await call('GET', '/api/public/products/september-porch', null, { anon: true });
  const p = json.data;
  for (const f of ['slug', 'name', 'territory', 'lede', 'desc', 'price', 'bp', 'version',
                   'runRemaining', 'runTotal', 'profile', 'anatomy', 'story', 'related',
                   'vb', 'motif', 'blueprint']) {
    assert.ok(f in p, `public product is missing "${f}"`);
  }
  assert.ok(Array.isArray(p.profile) && p.profile.length, 'profile survives the JSON round-trip');
  assert.ok(p.blueprint && p.blueprint.clusters.length, 'the EC_WR_V2 blueprint survives');
});

test('public territories carry the presentation payload the page needs', async () => {
  const { json } = await call('GET', '/api/public/territories', null, { anon: true });
  for (const t of json.data) {
    assert.ok(t.visualSvg && t.visualSvg.startsWith('<svg'), `${t.slug} keeps its illustration`);
    assert.ok(Array.isArray(t.signature) && t.signature.length === 3, `${t.slug} keeps its signature bars`);
  }
});

test('public bundles keep their trio markup', async () => {
  const { json } = await call('GET', '/api/public/bundles', null, { anon: true });
  assert.equal(json.data.length, 3);
  for (const b of json.data) {
    assert.ok(b.trioHtml && b.trioHtml.includes('<svg'), `${b.slug} keeps its trio`);
    assert.ok(b.items.length >= 3, `${b.slug} keeps its list`);
  }
});

/* ------------------------------------------------------------------ *
 * Inventory import
 * ------------------------------------------------------------------ */

test('CSV parsing handles quotes, embedded commas and CRLF', () => {
  const rows = parseCsv('sku,species,colorName,qtyOnHand\r\nX-1,"Rose, Garden",Ivory,7\r\nX-2,"He said ""hi""",Sage,3\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].species, 'Rose, Garden');
  assert.equal(rows[0].qtyOnHand, 7);
  assert.equal(rows[1].species, 'He said "hi"');
});

test('the importer accepts all three documented shapes', () => {
  assert.equal(normaliseInventoryPayload([{ sku: 'A-1', species: 'Rose' }]).length, 1);
  assert.equal(normaliseInventoryPayload({
    species: [{ species: 'Rose', canon_id: 1, skus: [{ sku: 'A-2', color_name: 'Ivory', price: 4 }] }],
  }).length, 1);
  assert.equal(normaliseInventoryPayload('sku,species\nA-3,Rose\n').length, 1);
  assert.equal(normaliseInventoryPayload('nonsense').length, 0);
});

test('import creates new SKUs, updates existing ones and reports duplicates', async () => {
  const before = (await call('GET', '/api/admin/inventory')).json.data.length;
  const { status, json } = await call('POST', '/api/admin/inventory/import', {
    payload: 'sku,species,colorName,qtyOnHand,unitPrice\n' +
             'ZZ-NEW-1,Test Species,Ivory,12,5.5\n' +
             'ZZ-NEW-1,Test Species,Ivory,99,5.5\n' +
             'MD-0001,Amber Dahlia,Rust,4,14.26\n',
  });
  assert.equal(status, 200);
  assert.equal(json.created, 1);
  assert.equal(json.updated, 1);
  assert.deepEqual(json.duplicates, ['ZZ-NEW-1']);

  const after = (await call('GET', '/api/admin/inventory')).json.data;
  assert.equal(after.length, before + 1, 'the duplicate was not inserted twice');
  assert.equal(after.find((i) => i.sku === 'ZZ-NEW-1').qtyOnHand, 12, 'first row wins');
  assert.equal(after.find((i) => i.sku === 'MD-0001').qtyOnHand, 4, 'existing SKU updated');
});

test('an unrecognisable import is refused with a readable message', async () => {
  const { status, json } = await call('POST', '/api/admin/inventory/import', { payload: 'not inventory at all' });
  assert.equal(status, 400);
  assert.match(json.error, /No inventory rows/i);
});

/* ------------------------------------------------------------------ *
 * Studio concept -> catalog
 * ------------------------------------------------------------------ */

test('a concept publishes into the catalog only when it is ready', async () => {
  await call('POST', '/api/admin/concepts', {
    slug: 'test-concept', name: 'Test Concept', territory: 'Renewal',
    memory: 'A morning in April.', blueprintJson: JSON.stringify({ clusters: [] }),
  });

  const early = await call('POST', '/api/admin/concepts/test-concept/publish', { slug: 'published-design' });
  assert.equal(early.status, 400, 'a draft cannot be published');

  await call('PATCH', '/api/admin/concepts/test-concept', { status: 'approved' });
  const done = await call('POST', '/api/admin/concepts/test-concept/publish', { slug: 'published-design' });
  assert.equal(done.status, 201);
  assert.equal(done.json.data.slug, 'published-design');
  assert.equal(done.json.data.territory, 'Renewal', 'the territory comes from the concept');

  const concept = (await call('GET', '/api/admin/concepts')).json.data.find((c) => c.slug === 'test-concept');
  assert.equal(concept.status, 'published');
  assert.equal(concept.productSlug, 'published-design');

  const pub = await call('GET', '/api/public/products', null, { anon: true });
  assert.ok(pub.json.data.some((p) => p.slug === 'published-design'), 'live on the storefront');

  const again = await call('POST', '/api/admin/concepts/test-concept/publish', { slug: 'published-design' });
  assert.equal(again.status, 400, 'a published concept is not re-publishable');
});

/* ------------------------------------------------------------------ *
 * AI proxy
 * ------------------------------------------------------------------ */

test('the AI route is owner-only — it spends the owner\'s API credits', async () => {
  // This was public in an earlier revision, and an earlier version of this very
  // test asserted the anonymous behaviour, which is how it survived: anyone who
  // could reach the host could run inference on the owner's account. The route
  // forwards to Anthropic with a key from the server environment, so it is
  // exactly as sensitive as an admin write.
  const anon = await call('POST', '/api/ai/complete', { prompt: 'hello' }, { anon: true });
  assert.equal(anon.status, 401, 'an anonymous caller must not reach the model');

  const anonEmpty = await call('POST', '/api/ai/complete', {}, { anon: true });
  assert.equal(anonEmpty.status, 401, 'authorisation is checked before the body');
});

test('the AI route reports its configuration rather than failing silently', async () => {
  const status = await call('GET', '/api/ai/status', null, { anon: true });
  assert.equal(status.status, 200);
  assert.equal(typeof status.json.configured, 'boolean');
  assert.equal(status.json.authenticated, false, 'status tells the Studio whether it may call');

  const empty = await call('POST', '/api/ai/complete', {});
  assert.equal(empty.status, 400, 'a missing prompt is a client error for the owner');

  if (!process.env.ANTHROPIC_API_KEY) {
    const res = await call('POST', '/api/ai/complete', { prompt: 'hello' });
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'AI_NOT_CONFIGURED');
    assert.match(res.json.error, /geometry/i, 'the message says what still works');
  }
});

test('the session cookie is HttpOnly, SameSite, and Secure only over TLS', async () => {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@moodoor.test', password: 'test-password-123' }),
  });
  const setCookie = res.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/, 'the session must not be readable from JavaScript');
  assert.match(setCookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(setCookie), 'Secure would break the cookie on a plain-HTTP dev server');

  const proxied = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ email: 'test@moodoor.test', password: 'test-password-123' }),
  });
  assert.match(proxied.headers.getSetCookie()[0], /Secure/,
    'behind a TLS proxy the session must not travel in clear');
});

test('no unauthenticated route can write anything', async () => {
  // Enumerated rather than sampled: every route the server declares is either a
  // read, an auth handshake, or admin-guarded.
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const blocks = server.split('\n  route(').slice(1);
  const open = [];
  for (const b of blocks) {
    const m = b.match(/^'(\w+)', (\/\^.*?\$\/)/s);
    if (!m) continue;
    const [, method, pattern] = m;
    const body = b.split('\n  });')[0];
    const guarded = body.includes('requireAdmin');
    const isRead = method === 'GET';
    // `pattern` is source text, so its slashes arrive escaped as \/ .
    // De-escaping once is clearer than matching backslashes in a regex.
    const route = pattern.split('\\/').join('/');
    const isAuthHandshake = /[/]api[/]auth[/](login|logout|me)/.test(route);
    if (!guarded && !isRead && !isAuthHandshake) open.push(`${method} ${route}`);
  }
  assert.deepEqual(open, [], 'these write/spend routes have no authorisation check');
});

/* ------------------------------------------------------------------ *
 * Static serving
 * ------------------------------------------------------------------ */

test('the site serves and refuses to serve outside its root', async () => {
  for (const p of ['/', '/index.html', '/studio.html', '/evercrafted-engine.js',
                   '/inventory.js', '/cart.js', '/moodoor-runtime.js', '/admin', '/admin/']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
  for (const p of ['/../server/db.js', '/..%2fserver%2fdb.js', '/%2e%2e/package.json']) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.ok(r.status === 403 || r.status === 404, `${p} must not be served (got ${r.status})`);
  }
});

test('a missing page returns 404, not the homepage', async () => {
  const r = await fetch(base + '/definitely-not-here.html', { headers: { Accept: 'text/html' } });
  assert.equal(r.status, 404);
});

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

test('text assets are compressed, and compression actually pays', async () => {
  for (const [path, floor] of [['/inventory.js', 0.85], ['/wreaths-data.js', 0.8],
                               ['/index.html', 0.6], ['/api/public/products', 0.8]]) {
    const raw = await fetch(base + path, { headers: { 'Accept-Encoding': 'identity' } });
    const rawBytes = (await raw.arrayBuffer()).byteLength;

    const br = await fetch(base + path, { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(br.headers.get('content-encoding'), 'br', `${path} should be brotli`);
    assert.equal(br.headers.get('vary'), 'Accept-Encoding', `${path} must vary on encoding`);
    const brBytes = Number(br.headers.get('content-length'));

    const saved = 1 - brBytes / rawBytes;
    assert.ok(saved >= floor,
      `${path}: only ${Math.round(saved * 100)}% saved, expected at least ${floor * 100}%`);
  }
});

test('a cached compressed response still decodes to the file on disk', async () => {
  // The second request takes a shortcut that skips reading the file from disk
  // entirely, so it has to produce exactly what the first one did.
  //
  // Note this goes through fetch, which decompresses the body for us — so a
  // corrupt cached payload surfaces as a decode error rather than a mismatch,
  // and either way this fails. The raw byte counts are checked via the
  // content-length header, which fetch leaves alone.
  const original = fs.readFileSync(new URL('../public/inventory.js', import.meta.url), 'utf8');

  const first = await fetch(base + '/inventory.js', { headers: { 'Accept-Encoding': 'br' } });
  const firstBody = await first.text();
  const second = await fetch(base + '/inventory.js', { headers: { 'Accept-Encoding': 'br' } });
  const secondBody = await second.text();

  assert.equal(first.headers.get('content-encoding'), 'br');
  assert.equal(second.headers.get('content-encoding'), 'br');
  assert.equal(second.headers.get('content-length'), first.headers.get('content-length'),
    'the cached response is a different size from the one that produced it');
  assert.equal(secondBody, firstBody, 'the cached response differs from the first one');
  assert.equal(secondBody, original, 'the cached response does not decode back to the file on disk');
});

test('a client that asks for no encoding gets none', async () => {
  const r = await fetch(base + '/inventory.js', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(r.headers.get('content-encoding'), null);
});

test('small responses are not compressed — the header would cost more than it saves', async () => {
  const r = await fetch(base + '/api/health', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), null);
});

test('HEAD mirrors GET on every route, with no body', async () => {
  for (const path of ['/api/public/products', '/api/health', '/index.html', '/inventory.js']) {
    const get = await fetch(base + path, { headers: { 'Accept-Encoding': 'identity' } });
    const head = await fetch(base + path, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });

    assert.equal(head.status, get.status, `HEAD ${path} status should match GET`);
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'),
      `HEAD ${path} should report the length GET would send`);
    assert.equal((await head.arrayBuffer()).byteLength, 0, `HEAD ${path} must send no body`);
  }
});

test('static assets carry a validator and a cache policy', async () => {
  const asset = await fetch(base + '/inventory.js');
  const etag = asset.headers.get('etag');
  assert.ok(etag, 'assets need an ETag');
  assert.match(asset.headers.get('cache-control'), /max-age=\d{4,}/, 'assets should be cacheable');

  const revalidated = await fetch(base + '/inventory.js', { headers: { 'If-None-Match': etag } });
  assert.equal(revalidated.status, 304, 'an unchanged asset revalidates to 304');

  // HTML must not be cached, or an admin edit would not appear on the next load.
  const page = await fetch(base + '/index.html');
  assert.match(page.headers.get('cache-control'), /no-cache/);
});

test('the engine no longer blocks first paint from <head>', async () => {
  // Moving these below the fold cut the product page's FCP from 388ms to 248ms.
  // Order still matters: they must precede the script that reads window.EC.
  for (const page of ['/moodoor-product-page.html', '/studio.html']) {
    const html = await (await fetch(base + page)).text();
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(!/evercrafted-engine\.js/.test(head), `${page}: engine is back in <head>`);
    assert.ok(!/src="[^"]*inventory\.js"/.test(head), `${page}: inventory is back in <head>`);

    const enginePos = html.indexOf('evercrafted-engine.js');
    assert.ok(enginePos > 0, `${page}: engine script is missing entirely`);
    const consumerPos = html.indexOf('window.EC');
    assert.ok(consumerPos > enginePos,
      `${page}: window.EC is read before the engine is loaded`);
  }
});

/* ------------------------------------------------------------------ *
 * Session lifecycle
 * ------------------------------------------------------------------ */

test('signing out invalidates the session immediately', async () => {
  assert.equal((await call('GET', '/api/admin/summary')).status, 200);
  await call('POST', '/api/auth/logout');
  const after = await fetch(base + '/api/admin/summary', { headers: { Cookie: cookie } });
  assert.equal(after.status, 401, 'the old cookie is dead');
});
