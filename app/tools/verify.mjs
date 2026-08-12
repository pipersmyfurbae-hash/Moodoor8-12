/**
 * verify.mjs — drives the real site in a real browser.
 *
 * The static link checker cannot see anything a page builds at runtime, and it
 * cannot tell a page that renders from a page that throws on load. This does:
 *
 *   - loads every page and fails on any console error or failed network request
 *   - re-checks every <a href> in the *rendered* DOM, so JS-built links count
 *   - asserts the storefront actually hydrated from the database
 *   - drives the Studio's geometry pipeline and asserts a blueprint is drawn
 *   - signs into the admin console and asserts it renders
 *   - writes a screenshot of each page to tools/screens/
 *
 * Usage: node tools/verify.mjs [baseUrl]
 *   (playwright is resolved from wherever it is installed; this is a dev tool,
 *    not a runtime dependency of the server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const SHOTS = path.join(ROOT, 'tools/screens');
const EMAIL = process.env.MOODOOR_ADMIN_EMAIL || 'owner@moodoor.studio';
const PASSWORD = process.env.MOODOOR_ADMIN_PASSWORD || 'moodoor-admin';

let chromium;
for (const spec of ['playwright', '/tmp/pw/node_modules/playwright']) {
  try { ({ chromium } = createRequire(import.meta.url)(spec)); break; } catch { /* next */ }
}
if (!chromium) {
  console.error('playwright is not installed. npm i -D playwright (browsers are preinstalled).');
  process.exit(2);
}

/**
 * Use whichever Chromium is on the machine. Playwright pins an exact browser
 * build per release, so a preinstalled browser from a different Playwright
 * version has to be pointed at explicitly rather than downloaded again.
 */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = path.join(root, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;                       // let Playwright use its own default
}

fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);
const ok = (msg) => notes.push('  ok   ' + msg);

/* Console noise that is not the site's fault. */
const IGNORE = [
  /favicon/i,
  /fonts\.(googleapis|gstatic)\.com/i,        // webfonts are external to this build
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/i,
];
const ignorable = (text) => IGNORE.some((re) => re.test(text));

const PAGES = [
  ['index.html', 'Homepage'],
  ['signature-wreaths.html', 'Catalog'],
  ['moodoor-product-page.html?w=september-porch', 'Product'],
  ['collection-bundles.html', 'Bundles'],
  ['territories.html', 'Territories'],
  ['upcoming-drops.html', 'Drops'],
  ['digital-blueprints.html', 'Blueprints'],
  ['how-matching-works.html', 'How it works'],
  ['checkout.html', 'Checkout'],
  ['stories.html', 'Stories'],
  ['studio.html', 'Studio'],
];

const browser = await chromium.launch({ executablePath: findChromium() });
/**
 * Everything this build serves is same-origin. External requests (the Google
 * Fonts stylesheet) are aborted rather than waited on: they never resolve in a
 * sandboxed network, and letting them hang makes every page load look slow and
 * every 'networkidle' wait time out. Blocking them also proves the pages stay
 * legible on their fallback stack.
 */
async function blockExternal(ctx) {
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    // Fulfil rather than abort: an aborted request logs a console error of its
    // own, which would then be reported as a fault in the page under test.
    return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await blockExternal(context);

async function visit(url, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
  page.on('requestfailed', (r) => {
    const t = r.url() + ' ' + (r.failure()?.errorText || '');
    if (!ignorable(t)) errors.push('request failed: ' + t);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !ignorable(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.goto(BASE + url, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(900);
  for (const e of errors) fail(label, e);
  if (!errors.length) ok(`${label} loads clean`);
  return page;
}

/* ------------------------------------------------------------------ *
 * 1. every page loads, renders and screenshots
 * ------------------------------------------------------------------ */

const renderedLinks = new Set();

for (const [url, label] of PAGES) {
  const page = await visit('/' + url, label);

  const title = await page.title();
  if (!title || title.length < 3) fail(label, 'has no usable <title>');

  // Nothing should render as a zero-height page.
  const height = await page.evaluate(() => document.body.scrollHeight);
  if (height < 500) fail(label, `body is only ${height}px tall — the page did not render`);

  // No horizontal overflow. This asks whether the user can actually scroll
  // sideways, not whether scrollWidth exceeds clientWidth — those differ by the
  // scrollbar width on every page that sets `overflow-x: hidden`, which would
  // report a 17px "break" on a layout that is in fact clipped correctly.
  const sideways = await page.evaluate(() => {
    const before = window.scrollX;
    window.scrollTo(99999, window.scrollY);
    const after = window.scrollX;
    window.scrollTo(before, window.scrollY);
    return after;
  });
  if (sideways > 2) fail(label, `page scrolls horizontally by ${sideways}px`);

  for (const href of await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))) {
    if (href && !/^(https?:|mailto:|tel:|javascript:|#)/i.test(href)) {
      renderedLinks.add(new URL(href, BASE + '/' + url).pathname + new URL(href, BASE + '/' + url).search);
    }
  }

  await page.screenshot({ path: path.join(SHOTS, label.toLowerCase().replace(/\s+/g, '-') + '.png'), fullPage: true });
  await page.close();
}

/* every link that only exists after JavaScript ran */
for (const link of renderedLinks) {
  const r = await fetch(BASE + link).catch(() => null);
  if (!r || r.status !== 200) fail('rendered DOM', `dead link ${link} (${r ? r.status : 'unreachable'})`);
}
ok(`${renderedLinks.size} rendered-DOM links all resolve`);

/* ------------------------------------------------------------------ *
 * 2. hydration actually happened
 * ------------------------------------------------------------------ */

for (const [url, kind, expect] of [
  ['collection-bundles.html', 'bundles', 3],
  ['territories.html', 'territories', 6],
  ['upcoming-drops.html', 'drops', 3],
]) {
  const page = await visit('/' + url, `Hydrate ${kind}`);
  const state = await page.getAttribute(`[data-hydrate="${kind}"]`, 'data-hydrated');
  if (state !== String(expect)) {
    fail(`Hydrate ${kind}`, `expected ${expect} records from the database, got "${state}"`);
  } else {
    ok(`${kind} rendered ${expect} records from the database`);
  }
  const cards = await page.$$eval(`[data-hydrate="${kind}"] article`, (n) => n.length);
  if (cards !== expect) fail(`Hydrate ${kind}`, `${cards} cards in the DOM, expected ${expect}`);
  // The illustrations must survive the round trip through the database.
  const svgs = await page.$$eval(`[data-hydrate="${kind}"] svg`, (n) => n.length);
  if (kind !== 'drops' && svgs === 0) fail(`Hydrate ${kind}`, 'illustrations were lost in hydration');
  await page.close();
}

/* an admin edit reaches the storefront */
{
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = res.headers.getSetCookie?.()[0]?.split(';')[0];
  if (!cookie) {
    fail('Admin', 'could not sign in with the configured owner credentials');
  } else {
    const marker = 'Verified live at ' + Date.now();
    const before = await (await fetch(BASE + '/api/public/territories')).json();
    const original = before.data.find((t) => t.slug === 'comfort').lede;

    await fetch(BASE + '/api/admin/territories/comfort', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ lede: marker }),
    });

    const page = await visit('/territories.html', 'Admin edit propagation');
    const shown = await page.textContent('[data-hydrate="territories"] .t-lede');
    if (!shown || !shown.includes(marker)) {
      fail('Admin edit propagation', `the storefront still shows "${shown}" after an admin edit`);
    } else {
      ok('an admin edit appears on the storefront without a rebuild');
    }
    await page.close();

    await fetch(BASE + '/api/admin/territories/comfort', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ lede: original }),
    });
  }
}

/* ------------------------------------------------------------------ *
 * 3. the engine draws — the thing that was missing entirely
 * ------------------------------------------------------------------ */

{
  const page = await visit('/studio.html', 'Studio engine');

  const probe = await page.evaluate(() => {
    if (!window.EC) return { error: 'window.EC is not defined' };
    if (!window.EverInventory) return { error: 'window.EverInventory is not defined' };

    const pick = (role) => (window.EverInventory.find((i) => i.engineType === role) || {}).id;
    window.EC.data.inventory = {
      items: window.EverInventory.map((f) => ({
        item_id: f.id, name: f.name, color_hex: f.hex, color_family: f.colorFamily,
        colorName: f.colorName, bloom_diameter_in: { typical: f.bloomIn || 3.6 },
        role: f.engineType, price: f.price,
      })),
    };

    const composed = window.EC.composeDreamBlueprint({
      formula: 'Crescent',
      emotional_tags: ['nostalgia'],
      florals: [
        { item_id: pick('focal'), role: 'focal', qty: 7 },
        { item_id: pick('secondary'), role: 'secondary', qty: 9 },
        { item_id: pick('filler'), role: 'filler', qty: 12 },
        { item_id: pick('accent'), role: 'accent', qty: 3 },
      ],
      foliage: window.EverInventory.filter((i) => i.engineType === 'foliage').slice(0, 2).map((i) => i.id),
      seed: window.EC.seedFromText('a september porch'),
    }, { diameter_in: 18, tier: 'GARDEN' });

    const bp = composed.blueprint;
    const svg = window.EC.generateOmniSVG(bp);
    const score = window.EC.scoreBlueprint(bp);
    const listing = window.EC.commerceListing(bp, {});

    // Draw it into the Studio's own blueprint stage so the screenshot is real.
    const stage = document.getElementById('bpStage');
    if (stage) stage.innerHTML = svg;

    return {
      clusters: bp.clusters.length, sweeps: bp.foliage_sweeps.length,
      silence: bp.silence_arcs.length, svgLength: svg.length,
      grade: score.overall_grade, score: score.overall_score,
      price: listing.price_estimate, prompt: window.EC.editorialPrompt(bp).slice(0, 60),
    };
  });

  if (probe.error) fail('Studio engine', probe.error);
  else {
    if (probe.clusters < 10) fail('Studio engine', `only ${probe.clusters} clusters composed`);
    if (probe.silence < 1) fail('Studio engine', 'no silence arc — COMP.L4 requires a moment of rest');
    if (probe.svgLength < 2000) fail('Studio engine', 'the blueprint SVG is suspiciously small');
    if (!probe.price) fail('Studio engine', 'no price was estimated');
    const drawn = await page.$$eval('#bpStage svg', (n) => n.length);
    if (!drawn) fail('Studio engine', 'the blueprint did not draw into the Studio stage');
    else ok(`Studio composed and drew ${probe.clusters} clusters, ` +
            `grade ${probe.grade} ${probe.score}/120, $${probe.price}`);
    await page.screenshot({ path: path.join(SHOTS, 'studio-blueprint.png'), fullPage: false });
  }

  // window.claude must exist, and say something useful when unconfigured.
  const claude = await page.evaluate(async () => {
    if (typeof window.claude?.complete !== 'function') return { error: 'window.claude.complete is missing' };
    try { await window.claude.complete('ping', { maxTokens: 8 }); return { ok: true }; }
    catch (e) { return { code: e.code, message: e.message }; }
  });
  if (claude.error) fail('Studio engine', claude.error);
  else if (claude.ok) ok('window.claude reached the model service');
  else if (claude.code === 'AI_NOT_CONFIGURED') ok('window.claude exists and reports the missing key clearly');
  else fail('Studio engine', 'window.claude failed unexpectedly: ' + claude.message);

  await page.close();
}

/* the product page must now render the engine's diagram, not the flat motif */
{
  const page = await visit('/moodoor-product-page.html?w=september-porch', 'Product blueprint');
  const info = await page.evaluate(() => {
    const hero = document.getElementById('heroSvg');
    return {
      hasEngine: Boolean(window.EC),
      paths: hero ? hero.querySelectorAll('path').length : 0,
      anatomy: (document.getElementById('pathBaseLi') || {}).textContent || '',
      badge: (document.getElementById('badgeBp') || {}).textContent || '',
    };
  });
  if (!info.hasEngine) fail('Product blueprint', 'the engine did not load on the product page');
  if (info.paths < 10) fail('Product blueprint', `hero only drew ${info.paths} paths — the live diagram is missing`);
  if (!/grade/i.test(info.badge)) fail('Product blueprint', 'no live grade shown on the badge');
  else ok('product hero renders the live engine diagram and grade (' + info.badge.trim() + ')');
  await page.close();
}

/* ------------------------------------------------------------------ *
 * 4. cart and admin console
 * ------------------------------------------------------------------ */

{
  const page = await visit('/moodoor-product-page.html?w=september-porch', 'Cart');
  const btn = await page.$('[data-add-to-cart]');
  if (!btn) fail('Cart', 'no add-to-cart control on the product page');
  else {
    await btn.click();
    await page.waitForTimeout(600);
    // cart.js stores under moodoor_cart_v1.
    const count = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('moodoor_cart_v1') || '[]')
        .reduce((n, i) => n + (i.qty || 1), 0));
    if (!count) fail('Cart', 'clicking add-to-cart stored nothing');
    else ok('add-to-cart writes a line to the cart');
    await page.screenshot({ path: path.join(SHOTS, 'cart.png') });
  }
  await page.close();
}

{
  const page = await visit('/admin', 'Admin console');
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not(.hide)', { timeout: 10000 }).catch(() => {});

  const signedIn = await page.evaluate(() => !document.getElementById('app').classList.contains('hide'));
  if (!signedIn) fail('Admin console', 'sign-in did not reveal the console');
  else {
    const stats = await page.$$eval('.stat', (n) => n.length);
    if (stats < 8) fail('Admin console', `only ${stats} collections on the overview`);
    else ok(`admin console signs in and lists ${stats} collections`);
    await page.screenshot({ path: path.join(SHOTS, 'admin-overview.png'), fullPage: true });

    await page.click('[data-go="products"]');
    await page.waitForSelector('tbody tr', { timeout: 8000 }).catch(() => {});
    const rows = await page.$$eval('tbody tr', (n) => n.length);
    if (rows < 5) fail('Admin console', `the designs table shows ${rows} rows`);
    else ok(`the designs table lists ${rows} records`);

    await page.click('tbody tr [data-edit]');
    await page.waitForTimeout(400);
    const fields = await page.$$eval('#drawerBody [data-f]', (n) => n.length);
    if (fields < 10) fail('Admin console', `the editor exposed only ${fields} fields`);
    else ok(`the record editor exposes ${fields} fields`);
    await page.screenshot({ path: path.join(SHOTS, 'admin-editor.png'), fullPage: true });
  }
  await page.close();
}

/* the 404 page must be a page, not a JSON blob */
{
  const page = await context.newPage();
  const res = await page.goto(BASE + '/no-such-page-here.html', { waitUntil: 'load' });
  if (res.status() !== 404) fail('404', `expected 404, got ${res.status()}`);
  const heading = await page.textContent('h1').catch(() => null);
  if (!heading) fail('404', 'the 404 response is not a rendered page');
  else ok(`404 renders a real page ("${heading.trim().replace(/\s+/g, ' ')}")`);
  await page.screenshot({ path: path.join(SHOTS, '404.png') });
  await page.close();
}

/* the Studio must compose with no API key configured */
{
  const page = await visit('/studio.html', 'Studio geometry-only path');
  const btn = await page.$('#composeBtn');
  if (!btn) {
    fail('Studio geometry-only path', 'no geometry-only button — the Studio is unusable without a key');
  } else {
    await page.fill('#memoryInput',
      'My grandmother kept a cutting garden behind the kitchen, and in late September ' +
      'it smelled of cedar and cold coffee and the screen door never quite closed.');
    await page.waitForTimeout(300);
    if (await btn.isDisabled()) fail('Studio geometry-only path', 'the button stayed disabled with a valid memory');
    await btn.click();
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => ({
      svgs: document.querySelectorAll('#bpStage svg').length,
      grade: (document.getElementById('gradeBadge') || {}).textContent || '',
      prompt: ((document.getElementById('mjBox') || {}).textContent || '').length,
      json: ((document.getElementById('bpJson') || {}).textContent || '').length,
      catalog: ((document.getElementById('catalogBox') || {}).textContent || '').length,
      legend: document.querySelectorAll('#bpLegend .lg-item').length,
    }));

    if (!result.svgs) fail('Studio geometry-only path', 'no blueprint was drawn');
    if (!/GRADE/i.test(result.grade)) fail('Studio geometry-only path', 'the quality gate did not score it');
    if (result.prompt < 200) fail('Studio geometry-only path', 'no Midjourney prompt was compiled');
    if (result.json < 500) fail('Studio geometry-only path', 'no blueprint JSON was emitted');
    if (result.catalog < 200) fail('Studio geometry-only path', 'no catalog record was produced');
    if (!result.legend) fail('Studio geometry-only path', 'the material legend is empty');
    if (result.svgs && result.prompt > 200 && result.catalog > 200) {
      ok(`Studio composes with no API key: ${result.grade.trim()}, ` +
         `${result.legend} materials, prompt + JSON + catalog record all produced`);
    }
    await page.screenshot({ path: path.join(SHOTS, 'studio-composed.png'), fullPage: true });
  }
  await page.close();
}

/* ------------------------------------------------------------------ *
 * 4b. performance budget
 *
 * Guards the two things that actually move: how many bytes cross the wire
 * (compression) and how long until something is on screen (render-blocking
 * scripts). Budgets are set ~40% above the measured figures, so ordinary
 * variation passes and a regression of the kind already fixed does not.
 * ------------------------------------------------------------------ */

{
  const BUDGET = [
    ['/', 'Homepage', 40, 500],
    ['/signature-wreaths.html', 'Catalog', 40, 500],
    ['/moodoor-product-page.html?w=september-porch', 'Product', 90, 600],
    ['/studio.html', 'Studio', 80, 500],
    ['/admin', 'Admin console', 30, 500],
  ];

  for (const [url, label, kbBudget, fcpBudget] of BUDGET) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.route('**/*', async (r) => {
      if (!r.request().url().startsWith(BASE)) {
        return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      await new Promise((res) => setTimeout(res, 40));   // a realistic round trip
      return r.continue();
    });

    const page = await ctx.newPage();
    let transferred = 0;
    page.on('response', async (r) => {
      if (!r.url().startsWith(BASE)) return;
      try { transferred += Number((await r.allHeaders())['content-length'] || 0); } catch { /* ignore */ }
    });

    await page.goto(BASE + url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(500);

    const fcp = await page.evaluate(() => {
      const e = performance.getEntriesByName('first-contentful-paint')[0];
      return e ? Math.round(e.startTime) : null;
    });
    const kb = Math.round(transferred / 1024);

    if (kb > kbBudget) fail(`${label} (perf)`, `${kb}KB over the wire, budget ${kbBudget}KB`);
    if (fcp != null && fcp > fcpBudget) fail(`${label} (perf)`, `first paint at ${fcp}ms, budget ${fcpBudget}ms`);
    if (kb <= kbBudget && (fcp == null || fcp <= fcpBudget)) {
      ok(`${label}: ${kb}KB transferred, first paint ${fcp}ms`);
    }
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ *
 * 5. mobile
 * ------------------------------------------------------------------ */

{
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockExternal(mobile);
  for (const [url, label] of [['index.html', 'Homepage'], ['signature-wreaths.html', 'Catalog'],
                              ['stories.html', 'Stories'], ['admin', 'Admin console']]) {
    const page = await mobile.newPage();
    await page.goto(BASE + '/' + url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(700);
    const sideways = await page.evaluate(() => {
      window.scrollTo(99999, 0);
      const x = window.scrollX;
      window.scrollTo(0, 0);
      return x;
    });
    if (sideways > 2) fail(`${label} (mobile)`, `scrolls horizontally by ${sideways}px at 390px wide`);
    else ok(`${label} fits a 390px viewport`);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-' + label.toLowerCase().replace(/\s+/g, '-') + '.png'), fullPage: true });
    await page.close();
  }
  await mobile.close();
}

await browser.close();

/* ------------------------------------------------------------------ */

console.log(notes.join('\n'));
if (failures.length) {
  console.error(`\n  ${failures.length} problem(s):\n`);
  for (const f of failures) console.error('    ' + f);
  process.exit(1);
}
console.log(`\n  Verified. ${notes.length} checks passed. Screenshots in tools/screens/\n`);
