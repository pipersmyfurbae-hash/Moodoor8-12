/**
 * index.js — the Moodoor server.
 *
 * One process serves three things:
 *   1. the public storefront (static files in public/),
 *   2. a public read API the storefront hydrates itself from,
 *   3. a protected admin API + console at /admin.
 *
 * Plus /api/ai/complete, which is what makes Moodoor Studio work at all: the
 * Studio calls `window.claude.complete(...)`, a host-provided global that does
 * not exist outside the environment the page was authored in. Routing it through
 * the server is also the right shape — the archive's own studio_integration_notes.md
 * says the integrated Studio "will not execute the uploaded client-side key
 * handling" and should use "protected server procedures" with the key in the
 * environment instead.
 *
 * Zero runtime dependencies: node:http, node:sqlite, node:crypto only.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { open, seed, verifyPassword, hashPassword } = require('./db');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 7;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/* ================================================================== *
 * Helpers
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * Compression
 *
 * Everything this app serves is text — HTML, JS, JSON, CSS, SVG — and some of
 * it is large: the generated inventory is 226 KB, the catalog 91 KB. Brotli and
 * gzip both come from node:zlib, so this costs no dependency.
 *
 * Compressed results are cached in memory keyed by (path, mtime, encoding).
 * Static files are read from disk on every request anyway, and re-compressing
 * a 226 KB file per request is the expensive part, not the read.
 * ------------------------------------------------------------------ */

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;
const MIN_COMPRESS_BYTES = 1024;
const compressCache = new Map();
const COMPRESS_CACHE_MAX = 64;

/** The best encoding the client accepts, or null. Brotli wins where offered. */
function negotiateEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

function compressSync(buf, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buf, {
      params: {
        // Quality 5 is the knee of the curve for text served from disk: within a
        // few percent of the maximum ratio at a small fraction of the CPU.
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    });
  }
  return zlib.gzipSync(buf, { level: 6 });
}

/**
 * Compress if the client asked, the type benefits, and the body is big enough
 * to be worth it. Returns the body to send plus any headers to add.
 */
function maybeCompress(req, buf, contentType, cacheKey) {
  const encoding = negotiateEncoding(req);
  if (!encoding || buf.length < MIN_COMPRESS_BYTES || !COMPRESSIBLE.test(contentType || '')) {
    return { body: buf, headers: {} };
  }

  const key = cacheKey ? `${cacheKey}:${encoding}` : null;
  if (key && compressCache.has(key)) {
    return { body: compressCache.get(key), headers: { 'Content-Encoding': encoding, Vary: 'Accept-Encoding' } };
  }

  let out;
  try {
    out = compressSync(buf, encoding);
  } catch {
    return { body: buf, headers: {} };          // never fail a request over this
  }

  // If compression did not actually help, send the original.
  if (out.length >= buf.length) return { body: buf, headers: {} };

  if (key) {
    if (compressCache.size >= COMPRESS_CACHE_MAX) {
      compressCache.delete(compressCache.keys().next().value);
    }
    compressCache.set(key, out);
  }
  return { body: out, headers: { 'Content-Encoding': encoding, Vary: 'Accept-Encoding' } };
}

/**
 * Answer a HEAD like the matching GET but write no body, keeping the
 * Content-Length the GET would have reported. Handlers stay unaware of it.
 */
function suppressBody(res) {
  res.end = function (...args) {
    const cb = args.find((a) => typeof a === 'function');
    return http.ServerResponse.prototype.end.call(res, cb);
  };
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

/** send(), with compression negotiated against the request. */
function sendCompressed(req, res, status, body, headers = {}, cacheKey) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const { body: out, headers: extra } = maybeCompress(req, buf, headers['Content-Type'], cacheKey);
  res.writeHead(status, { 'Content-Length': out.length, ...headers, ...extra });
  res.end(out);
}

function json(res, status, obj, headers = {}) {
  const req = res.req;
  const body = JSON.stringify(obj);
  const withType = { 'Content-Type': 'application/json; charset=utf-8', ...headers };
  // API responses change per request, so they are compressed but never cached.
  if (req) return sendCompressed(req, res, status, body, withType, null);
  send(res, status, body, withType);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const bool = (v) => (v ? 1 : 0);
const parseJsonField = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* ================================================================== *
 * App
 * ================================================================== */

function createApp(options = {}) {
  const db = options.db || open(options.dbFile);
  const boot = seed(db, options);

  /* ---------------- sessions ---------------- */

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?,?,?)').run(token, userId, expires);
    return { token, expires };
  }

  function currentUser(req) {
    const token = parseCookies(req).moodoor_session;
    if (!token) return null;
    const row = db.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.userId
        WHERE s.token = ? AND s.expiresAt > datetime('now')`
    ).get(token);
    return row || null;
  }

  function requireAdmin(req, res) {
    const user = currentUser(req);
    if (!user || user.role !== 'admin') {
      json(res, 401, { error: 'Sign in as the owner to do that.' });
      return null;
    }
    return user;
  }

  /* ---------------- resource definitions ----------------
   * One table of truth, so the admin API, the admin console and the public
   * API cannot drift apart. `writable` is the allow-list: anything not on it
   * is never written from a request body, which is what stops a client from
   * setting its own id / createdAt / updatedBy.
   */
  const RESOURCES = {
    products: {
      table: 'catalog_products', key: 'slug', label: 'Design',
      writable: ['slug', 'name', 'territory', 'lede', 'description', 'price', 'blueprintCode',
        'blueprintVersion', 'listingImageUrl', 'heroImageUrl', 'inventoryQuantity', 'runLimit',
        'blueprintPrice', 'blueprintAssetUrl', 'blueprintFilename', 'profileJson', 'anatomyJson',
        'storyJson', 'relatedJson', 'motifSvg', 'motifViewBox', 'blueprintJson', 'isPublished', 'sortOrder'],
      required: ['slug', 'name', 'territory'],
    },
    bundles: {
      table: 'catalog_bundles', key: 'slug', label: 'Bundle',
      writable: ['slug', 'name', 'territory', 'price', 'priceLabel', 'saving', 'lede', 'description',
        'itemsJson', 'visualClass', 'trioHtml', 'ctaHref', 'tone', 'imageUrl', 'isPublished', 'sortOrder'],
      required: ['slug', 'name', 'territory'],
    },
    territories: {
      table: 'catalog_territories', key: 'slug', label: 'Territory',
      writable: ['slug', 'name', 'overline', 'numeral', 'description', 'lede', 'designCount',
        'visualClass', 'visualSvg', 'signatureJson', 'samples', 'browseHref', 'tone', 'imageUrl',
        'isPublished', 'sortOrder'],
      required: ['slug', 'name'],
    },
    drops: {
      table: 'seasonal_drops', key: 'slug', label: 'Drop',
      writable: ['slug', 'title', 'dropNumber', 'timingLabel', 'status', 'statusLabel', 'lede',
        'description', 'tagsJson', 'finishedRunCount', 'blueprintCount', 'imageUrl', 'launchAt',
        'isPublished', 'sortOrder'],
      required: ['slug', 'title', 'timingLabel'],
      enums: { status: ['planned', 'next', 'live', 'archived'] },
    },
    stories: {
      table: 'moodoor_stories', key: 'slug', label: 'Story',
      writable: ['slug', 'kind', 'title', 'eyebrow', 'excerpt', 'body', 'imageUrl',
        'linkedProductSlug', 'linkedDropSlug', 'isPublished', 'sortOrder'],
      required: ['slug', 'title'],
      enums: { kind: ['lifestyle', 'studio', 'genesis', 'story', 'lookbook'] },
      owned: true,
    },
    concepts: {
      table: 'studio_concepts', key: 'slug', label: 'Studio concept',
      writable: ['slug', 'name', 'memory', 'territory', 'palette', 'focalFlorals', 'foliage',
        'styleNotes', 'renderPrompt', 'renderUrl', 'renderAlt', 'blueprintJson', 'scoreJson',
        'status', 'reviewNotes', 'productSlug'],
      required: ['slug', 'name', 'territory'],
      enums: { status: ['draft', 'generating', 'ready', 'approved', 'published', 'failed'] },
      owned: true,
    },
    briefs: {
      table: 'moodoor_briefs', key: 'slug', label: 'Brief',
      writable: ['slug', 'title', 'sourceMemory', 'season', 'territory', 'collectionName',
        'palette', 'materials', 'collectionInsight', 'collectionPlan', 'status'],
      required: ['slug', 'title', 'territory'],
      enums: { status: ['draft', 'analyzed', 'approved', 'archived'] },
      owned: true,
    },
    quality: {
      table: 'moodoor_quality_checks', key: 'slug', label: 'Quality check',
      writable: ['slug', 'title', 'studioConceptSlug', 'productSlug', 'status', 'compositionScore',
        'materialScore', 'commerceScore', 'notes', 'reviewedBy', 'checkedAt'],
      required: ['slug', 'title'],
      enums: { status: ['queued', 'in_review', 'passed', 'needs_revision'] },
      owned: true,
    },
    operations: {
      table: 'moodoor_operations', key: 'slug', label: 'Operation',
      writable: ['slug', 'title', 'module', 'status', 'summary', 'ownerNote', 'linkedBriefSlug',
        'linkedStorySlug', 'linkedProductSlug', 'linkedDropSlug', 'dueAt', 'completedAt'],
      required: ['slug', 'title'],
      enums: { module: ['operator', 'pipeline', 'experience', 'drop'], status: ['planned', 'active', 'blocked', 'complete'] },
      owned: true,
    },
    inventory: {
      table: 'moodoor_inventory_items', key: 'sku', label: 'Inventory item',
      writable: ['sku', 'canonId', 'species', 'colorName', 'colorHex', 'primaryRole', 'qtyOnHand',
        'recommendedQty24in', 'unitPrice', 'seasonality', 'primaryEmotion', 'secondaryEmotion',
        'wheelSector', 'textureArchetype', 'isRegisterGap', 'lowStockThreshold', 'notes'],
      required: ['sku', 'species'],
    },
    content: {
      table: 'site_content', key: 'contentKey', label: 'Content block',
      writable: ['contentKey', 'label', 'heading', 'body', 'imageUrl', 'altText'],
      required: ['contentKey', 'label'],
    },
  };

  function validate(def, payload, { partial = false } = {}) {
    const row = {};
    for (const field of def.writable) {
      if (!(field in payload)) continue;
      let v = payload[field];
      if (typeof v === 'boolean') v = bool(v);
      if (def.enums && def.enums[field] && v != null && !def.enums[field].includes(v)) {
        throw Object.assign(new Error(`${field} must be one of: ${def.enums[field].join(', ')}`), { status: 400 });
      }
      row[field] = v === '' ? null : v;
    }
    if (!partial) {
      for (const field of def.required) {
        if (row[field] == null || row[field] === '') {
          throw Object.assign(new Error(`${field} is required`), { status: 400 });
        }
      }
    }
    if (!Object.keys(row).length) throw Object.assign(new Error('Nothing to save'), { status: 400 });
    return row;
  }

  function listRows(def, { publishedOnly = false } = {}) {
    const hasPublished = def.writable.includes('isPublished');
    const where = publishedOnly && hasPublished ? 'WHERE isPublished = 1' : '';
    const order = def.writable.includes('sortOrder') ? 'sortOrder, id' : 'id';
    return db.prepare(`SELECT * FROM ${def.table} ${where} ORDER BY ${order}`).all();
  }

  /* ================================================================ *
   * Public API — what the storefront hydrates from
   * ================================================================ */

  function publicProduct(r) {
    return {
      slug: r.slug, name: r.name, territory: r.territory, lede: r.lede, desc: r.description,
      price: r.price, bp: r.blueprintCode, version: r.blueprintVersion,
      runRemaining: r.inventoryQuantity, runTotal: r.runLimit,
      blueprintPrice: r.blueprintPrice, blueprintAssetUrl: r.blueprintAssetUrl,
      listingImageUrl: r.listingImageUrl, heroImageUrl: r.heroImageUrl,
      profile: parseJsonField(r.profileJson, []),
      anatomy: parseJsonField(r.anatomyJson, {}),
      story: parseJsonField(r.storyJson, {}),
      related: parseJsonField(r.relatedJson, []),
      vb: r.motifViewBox, motif: r.motifSvg,
      blueprint: parseJsonField(r.blueprintJson, null),
      soldOut: r.inventoryQuantity <= 0,
    };
  }

  const PUBLIC = {
    products: () => listRows(RESOURCES.products, { publishedOnly: true }).map(publicProduct),
    bundles: () => listRows(RESOURCES.bundles, { publishedOnly: true }).map((r) => ({
      slug: r.slug, name: r.name, territory: r.territory, price: r.price,
      priceLabel: r.priceLabel, saving: r.saving, lede: r.lede, desc: r.description,
      items: parseJsonField(r.itemsJson, []), visualClass: r.visualClass,
      trioHtml: r.trioHtml, ctaHref: r.ctaHref, imageUrl: r.imageUrl,
    })),
    territories: () => listRows(RESOURCES.territories, { publishedOnly: true }).map((r) => ({
      slug: r.slug, name: r.name, overline: r.overline, numeral: r.numeral,
      designCount: r.designCount, lede: r.lede, desc: r.description,
      visualClass: r.visualClass, visualSvg: r.visualSvg,
      signature: parseJsonField(r.signatureJson, []), samples: r.samples, browseHref: r.browseHref,
    })),
    drops: () => listRows(RESOURCES.drops, { publishedOnly: true }).map((r) => ({
      slug: r.slug, title: r.title, dropNumber: r.dropNumber, timingLabel: r.timingLabel,
      status: r.status, statusLabel: r.statusLabel, lede: r.lede, desc: r.description,
      tags: parseJsonField(r.tagsJson, []), imageUrl: r.imageUrl,
    })),
    stories: () => listRows(RESOURCES.stories, { publishedOnly: true }).map((r) => ({
      slug: r.slug, kind: r.kind, title: r.title, eyebrow: r.eyebrow, excerpt: r.excerpt,
      body: r.body, imageUrl: r.imageUrl,
      linkedProductSlug: r.linkedProductSlug, linkedDropSlug: r.linkedDropSlug,
    })),
    content: () => {
      const out = {};
      for (const r of listRows(RESOURCES.content)) {
        out[r.contentKey] = { label: r.label, heading: r.heading, body: r.body, imageUrl: r.imageUrl, altText: r.altText };
      }
      return out;
    },
  };

  /* ================================================================ *
   * Routing
   * ================================================================ */

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  /* ---- auth ---- */

  route('POST', /^\/api\/auth\/login$/, async (req, res) => {
    const { email, password } = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return json(res, 401, { error: 'That email and password do not match.' });
    }
    db.prepare("UPDATE users SET lastSignedIn = datetime('now') WHERE id = ?").run(user.id);
    const { token, expires } = createSession(user.id);
    json(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } }, {
      'Set-Cookie': `moodoor_session=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expires).toUTCString()}`,
    });
  });

  route('POST', /^\/api\/auth\/logout$/, async (req, res) => {
    const token = parseCookies(req).moodoor_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    json(res, 200, { ok: true }, { 'Set-Cookie': 'moodoor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  });

  route('GET', /^\/api\/auth\/me$/, async (req, res) => {
    const user = currentUser(req);
    json(res, 200, { user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null });
  });

  route('POST', /^\/api\/auth\/password$/, async (req, res) => {
    const user = requireAdmin(req, res); if (!user) return;
    const { currentPassword, newPassword } = await readJson(req);
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return json(res, 400, { error: 'Current password is not correct.' });
    }
    if (!newPassword || String(newPassword).length < 8) {
      return json(res, 400, { error: 'New password must be at least 8 characters.' });
    }
    db.prepare("UPDATE users SET passwordHash = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(hashPassword(newPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE userId = ?').run(user.id);
    json(res, 200, { ok: true, message: 'Password changed. Sign in again.' },
      { 'Set-Cookie': 'moodoor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  });

  /* ---- public reads ---- */

  route('GET', /^\/api\/public\/([a-z]+)$/, async (req, res, m) => {
    const fn = PUBLIC[m[1]];
    if (!fn) return json(res, 404, { error: 'Unknown collection' });
    json(res, 200, { data: fn() }, { 'Cache-Control': 'no-cache' });
  });

  route('GET', /^\/api\/public\/products\/([a-zA-Z0-9-]+)$/, async (req, res, m) => {
    const row = db.prepare('SELECT * FROM catalog_products WHERE slug = ? AND isPublished = 1').get(m[1]);
    if (!row) return json(res, 404, { error: 'No such design' });
    json(res, 200, { data: publicProduct(row) });
  });

  /* ---- admin CRUD ---- */

  route('GET', /^\/api\/admin\/summary$/, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const counts = {};
    for (const [name, def] of Object.entries(RESOURCES)) {
      counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM ${def.table}`).get().n;
    }
    const lowStock = db.prepare(
      'SELECT sku, species, colorName, qtyOnHand, lowStockThreshold FROM moodoor_inventory_items ' +
      'WHERE isRegisterGap = 0 AND qtyOnHand <= lowStockThreshold ORDER BY qtyOnHand LIMIT 25'
    ).all();
    const soldOut = db.prepare(
      'SELECT slug, name, inventoryQuantity, runLimit FROM catalog_products WHERE inventoryQuantity <= 0'
    ).all();
    const gaps = db.prepare('SELECT species FROM moodoor_inventory_items WHERE isRegisterGap = 1').all()
      .map((r) => r.species);
    json(res, 200, { counts, lowStock, soldOut, registerGaps: gaps });
  });

  route('GET', /^\/api\/admin\/([a-z]+)$/, async (req, res, m) => {
    if (!requireAdmin(req, res)) return;
    const def = RESOURCES[m[1]];
    if (!def) return json(res, 404, { error: 'Unknown collection' });
    json(res, 200, { data: listRows(def), key: def.key, label: def.label, writable: def.writable });
  });

  route('POST', /^\/api\/admin\/([a-z]+)$/, async (req, res, m) => {
    const user = requireAdmin(req, res); if (!user) return;
    const def = RESOURCES[m[1]];
    if (!def) return json(res, 404, { error: 'Unknown collection' });

    const payload = await readJson(req);
    if (!payload[def.key] && payload.name) payload[def.key] = slugify(payload.name);
    if (!payload[def.key] && payload.title) payload[def.key] = slugify(payload.title);
    const row = validate(def, payload);

    if (db.prepare(`SELECT 1 FROM ${def.table} WHERE ${def.key} = ?`).get(row[def.key])) {
      return json(res, 409, { error: `A ${def.label.toLowerCase()} with that ${def.key} already exists.` });
    }

    row.updatedBy = user.id;
    if (def.owned) row.createdBy = user.id;
    else if (def.table === 'moodoor_inventory_items') row.createdBy = user.id;

    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => row[c] ?? null));

    json(res, 201, { data: db.prepare(`SELECT * FROM ${def.table} WHERE ${def.key} = ?`).get(row[def.key]) });
  });

  route('PATCH', /^\/api\/admin\/([a-z]+)\/(.+)$/, async (req, res, m) => {
    const user = requireAdmin(req, res); if (!user) return;
    const def = RESOURCES[m[1]];
    if (!def) return json(res, 404, { error: 'Unknown collection' });
    const id = decodeURIComponent(m[2]);

    const existing = db.prepare(`SELECT * FROM ${def.table} WHERE ${def.key} = ?`).get(id);
    if (!existing) return json(res, 404, { error: `No ${def.label.toLowerCase()} "${id}".` });

    const row = validate(def, await readJson(req), { partial: true });
    if (row[def.key] && row[def.key] !== id &&
        db.prepare(`SELECT 1 FROM ${def.table} WHERE ${def.key} = ?`).get(row[def.key])) {
      return json(res, 409, { error: `${def.key} "${row[def.key]}" is already taken.` });
    }

    row.updatedBy = user.id;
    const sets = Object.keys(row).map((c) => `${c} = ?`).join(', ');
    db.prepare(`UPDATE ${def.table} SET ${sets}, updatedAt = datetime('now') WHERE ${def.key} = ?`)
      .run(...Object.keys(row).map((c) => row[c] ?? null), id);

    json(res, 200, { data: db.prepare(`SELECT * FROM ${def.table} WHERE ${def.key} = ?`).get(row[def.key] || id) });
  });

  route('DELETE', /^\/api\/admin\/([a-z]+)\/(.+)$/, async (req, res, m) => {
    if (!requireAdmin(req, res)) return;
    const def = RESOURCES[m[1]];
    if (!def) return json(res, 404, { error: 'Unknown collection' });
    const id = decodeURIComponent(m[2]);
    const info = db.prepare(`DELETE FROM ${def.table} WHERE ${def.key} = ?`).run(id);
    if (!info.changes) return json(res, 404, { error: `No ${def.label.toLowerCase()} "${id}".` });
    json(res, 200, { ok: true, deleted: id });
  });

  /* ---- inventory import (CSV or JSON, per the archive's audit) ---- */

  route('POST', /^\/api\/admin\/inventory\/import$/, async (req, res) => {
    const user = requireAdmin(req, res); if (!user) return;
    const body = await readJson(req);
    const rows = normaliseInventoryPayload(body.payload ?? body);
    if (!rows.length) return json(res, 400, { error: 'No inventory rows recognised in that file.' });

    let created = 0, updated = 0;
    const duplicates = [];
    const seen = new Set();

    for (const r of rows) {
      if (!r.sku || !r.species) continue;
      if (seen.has(r.sku)) { duplicates.push(r.sku); continue; }
      seen.add(r.sku);
      const exists = db.prepare('SELECT 1 FROM moodoor_inventory_items WHERE sku = ?').get(r.sku);
      if (exists) {
        db.prepare(`UPDATE moodoor_inventory_items SET species=?, colorName=?, primaryRole=?,
          qtyOnHand=?, recommendedQty24in=?, unitPrice=?, seasonality=?, updatedBy=?,
          updatedAt=datetime('now') WHERE sku=?`)
          .run(r.species, r.colorName, r.primaryRole, r.qtyOnHand, r.recommendedQty24in,
               r.unitPrice, r.seasonality, user.id, r.sku);
        updated += 1;
      } else {
        db.prepare(`INSERT INTO moodoor_inventory_items
          (sku, canonId, species, colorName, primaryRole, qtyOnHand, recommendedQty24in, unitPrice,
           seasonality, primaryEmotion, secondaryEmotion, isRegisterGap, createdBy, updatedBy)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(r.sku, r.canonId, r.species, r.colorName, r.primaryRole, r.qtyOnHand,
               r.recommendedQty24in, r.unitPrice, r.seasonality, r.primaryEmotion,
               r.secondaryEmotion, 0, user.id, user.id);
        created += 1;
      }
    }
    json(res, 200, { created, updated, duplicates, total: rows.length });
  });

  /* ---- Studio: persist a composed blueprint, publish it to the catalog ---- */

  route('POST', /^\/api\/admin\/concepts\/([a-zA-Z0-9-]+)\/publish$/, async (req, res, m) => {
    const user = requireAdmin(req, res); if (!user) return;
    const concept = db.prepare('SELECT * FROM studio_concepts WHERE slug = ?').get(m[1]);
    if (!concept) return json(res, 404, { error: 'No such concept.' });
    if (concept.status !== 'approved' && concept.status !== 'ready') {
      return json(res, 400, { error: 'Only a ready or approved concept can be published.' });
    }

    const body = await readJson(req);
    const slug = slugify(body.slug || concept.productSlug || concept.slug);
    if (db.prepare('SELECT 1 FROM catalog_products WHERE slug = ?').get(slug)) {
      return json(res, 409, { error: `A design with slug "${slug}" already exists.` });
    }

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS n FROM catalog_products').get().n;
    db.prepare(`INSERT INTO catalog_products
      (slug, name, territory, lede, description, price, blueprintCode, blueprintVersion,
       inventoryQuantity, runLimit, blueprintJson, heroImageUrl, motifViewBox, motifSvg,
       profileJson, anatomyJson, storyJson, relatedJson, isPublished, sortOrder, updatedBy)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, body.name || concept.name, concept.territory,
        body.lede || null, body.description || null,
        Number(body.price) || 0, body.blueprintCode || null, 'v1',
        Number(body.runLimit) || 5, Number(body.runLimit) || 5,
        concept.blueprintJson, concept.renderUrl || null,
        '0 0 140 140',
        '<circle cx="70" cy="70" r="50" stroke="#A8916F" stroke-width="2" opacity=".5" stroke-dasharray="20 7 16 4"/>' +
        '<circle cx="70" cy="70" r="10" fill="#EEF2ED" stroke="#4A6741" stroke-width="1.2"/>',
        body.profileJson || '[]', body.anatomyJson || '{}', body.storyJson || '{}', '[]',
        1, maxOrder + 1, user.id);

    db.prepare(`UPDATE studio_concepts SET status='published', productSlug=?, publishedAt=datetime('now'),
      updatedBy=?, updatedAt=datetime('now') WHERE slug=?`).run(slug, user.id, concept.slug);

    json(res, 201, { data: db.prepare('SELECT * FROM catalog_products WHERE slug = ?').get(slug) });
  });

  /* ---- AI proxy: what makes window.claude work ---- */

  route('GET', /^\/api\/ai\/status$/, async (req, res) => {
    json(res, 200, {
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: process.env.MOODOOR_AI_MODEL || 'claude-opus-5',
    });
  });

  route('POST', /^\/api\/ai\/complete$/, async (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY;
    const { prompt, maxTokens } = await readJson(req);
    if (!prompt || typeof prompt !== 'string') {
      return json(res, 400, { error: 'A prompt string is required.' });
    }
    if (!key) {
      return json(res, 503, {
        error: 'No ANTHROPIC_API_KEY is set on the server, so the Studio cannot run a live analysis. ' +
               'Set it and restart, or use "Compose without AI" to drive the geometry engine directly.',
        code: 'AI_NOT_CONFIGURED',
      });
    }
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.MOODOOR_AI_MODEL || 'claude-opus-5',
          max_tokens: Math.min(Number(maxTokens) || 1200, 4096),
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const payload = await upstream.json();
      if (!upstream.ok) {
        return json(res, upstream.status, { error: (payload.error && payload.error.message) || 'Upstream error' });
      }
      const text = (payload.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      json(res, 200, { completion: text });
    } catch (err) {
      json(res, 502, { error: 'Could not reach the model service: ' + err.message });
    }
  });

  /* ---- health ---- */

  route('GET', /^\/api\/health$/, async (req, res) => {
    json(res, 200, {
      ok: true,
      products: db.prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n,
      inventory: db.prepare('SELECT COUNT(*) AS n FROM moodoor_inventory_items').get().n,
      ai: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  });

  /* ================================================================ *
   * Static files
   * ================================================================ */

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    // The Studio and product page reference ../inventory.js and
    // ../evercrafted-engine.js because they were authored one directory deeper.
    // Both files live at the site root here, so a parent-relative request for
    // them resolves to the same file rather than escaping the document root.
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });

    let target = file;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      } else if (fs.existsSync(target + '.html')) {
        target = target + '.html';
      } else {
        return notFound(req, res, rel);
      }
    }
    if (!fs.existsSync(target)) return notFound(req, res, rel);

    const ext = path.extname(target).toLowerCase();
    const stat = fs.statSync(target);
    const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }

    const contentType = MIME[ext] || 'application/octet-stream';

    /* HTML must revalidate — an admin edit has to show up on the next load.
     * Everything else may sit in the browser cache for a day, because the ETag
     * still catches a rebuild and these files change only when tools/ is re-run. */
    const cacheControl = ext === '.html'
      ? 'no-cache'
      : 'public, max-age=86400, stale-while-revalidate=604800';

    const headers = { 'Content-Type': contentType, ETag: etag, 'Cache-Control': cacheControl };
    const cacheKey = `${target}:${stat.mtimeMs}`;

    /* On a cache hit the compressed bytes are already in memory, so the file
     * never has to be read. That matters most for exactly the file it matters
     * most for: inventory.js is 226 KB on disk and 12 KB compressed. */
    const encoding = negotiateEncoding(req);
    if (encoding) {
      const hit = compressCache.get(`${cacheKey}:${encoding}`);
      if (hit) {
        return send(res, 200, hit, {
          ...headers, 'Content-Encoding': encoding, Vary: 'Accept-Encoding',
        });
      }
    }

    sendCompressed(req, res, 200, fs.readFileSync(target), headers, cacheKey);
  }

  function notFound(req, res, rel) {
    const page = path.join(PUBLIC_DIR, '404.html');
    if (fs.existsSync(page) && (req.headers.accept || '').includes('text/html')) {
      return send(res, 404, fs.readFileSync(page), { 'Content-Type': MIME['.html'] });
    }
    return json(res, 404, { error: 'Not found', path: rel });
  }

  /* ================================================================ */

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      // `../inventory.js` from a root-level page normalises to `/inventory.js`
      // in the browser already; this handles any that arrive un-normalised.
      const normalised = pathname.replace(/\/\.\.\//g, '/');

      /* HEAD must answer exactly as GET does, minus the body — it is how a
       * client checks a resource without downloading it, and how `curl -I`
       * reads headers. Routing it separately meant every API route 404'd on
       * HEAD while returning 200 on GET. */
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      if (req.method === 'HEAD') suppressBody(res);

      for (const r of routes) {
        if (r.method !== method) continue;
        const m = normalised.match(r.pattern);
        if (m) return await r.handler(req, res, m, url);
      }

      if (normalised === '/admin' || normalised === '/admin/') {
        return serveStatic(req, res, '/admin/index.html');
      }
      if (normalised === '/') return serveStatic(req, res, '/index.html');
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, normalised);

      json(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[moodoor]', req.method, pathname, err);
      json(res, status, { error: err.message || 'Server error' });
    }
  });

  return { server, db, boot, RESOURCES, PUBLIC };
}

/* ================================================================== *
 * Inventory payload normalisation
 *
 * Per moodoor_inventory_audit.md the importer must accept three shapes: the
 * nested EFS-1.0 canon (species[] each with skus[]), a flat array of SKU-like
 * records, and CSV with equivalent headers.
 * ================================================================== */

function normaliseInventoryPayload(payload) {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return normaliseInventoryPayload(JSON.parse(trimmed)); } catch { /* try CSV */ }
    }
    return parseCsv(trimmed);
  }
  if (Array.isArray(payload)) return payload.map(normaliseSku).filter(Boolean);
  if (payload && Array.isArray(payload.species)) {
    const out = [];
    for (const sp of payload.species) {
      for (const k of sp.skus || []) {
        out.push(normaliseSku({
          sku: k.sku, canonId: sp.canon_id, species: sp.species,
          colorName: k.color_name, primaryRole: k.primary_role,
          qtyOnHand: k.qty_on_hand, recommendedQty24in: k.recommended_qty_24in,
          unitPrice: k.price, seasonality: sp.seasonality,
          primaryEmotion: sp.primary_emotion, secondaryEmotion: sp.secondary_emotion,
        }));
      }
    }
    return out.filter(Boolean);
  }
  if (payload && Array.isArray(payload.items)) return payload.items.map(normaliseSku).filter(Boolean);
  return [];
}

/** Accepts both camelCase and the canon's snake_case field names. */
function normaliseSku(r) {
  if (!r || typeof r !== 'object') return null;
  const pick = (...names) => { for (const n of names) if (r[n] != null && r[n] !== '') return r[n]; return null; };
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const sku = pick('sku', 'SKU', 'item_id', 'id');
  const species = pick('species', 'Species', 'name', 'species_name');
  if (!sku || !species) return null;
  return {
    sku: String(sku).trim(),
    canonId: pick('canonId', 'canon_id') == null ? null : String(pick('canonId', 'canon_id')),
    species: String(species).trim(),
    colorName: pick('colorName', 'color_name', 'color'),
    primaryRole: pick('primaryRole', 'primary_role', 'role'),
    qtyOnHand: num(pick('qtyOnHand', 'qty_on_hand', 'qty', 'quantity')) ?? 0,
    recommendedQty24in: num(pick('recommendedQty24in', 'recommended_qty_24in')),
    unitPrice: num(pick('unitPrice', 'price', 'unit_price')),
    seasonality: pick('seasonality', 'season'),
    primaryEmotion: pick('primaryEmotion', 'primary_emotion'),
    secondaryEmotion: pick('secondaryEmotion', 'secondary_emotion'),
  };
}

/** Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c).trim()))
    .map((r) => normaliseSku(Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))))
    .filter(Boolean);
}

/* ================================================================== */

if (require.main === module) {
  const { server, boot } = createApp();
  server.listen(PORT, () => {
    console.log(`\n  Moodoor is running.\n`);
    console.log(`    storefront  http://localhost:${PORT}/`);
    console.log(`    studio      http://localhost:${PORT}/studio.html`);
    console.log(`    admin       http://localhost:${PORT}/admin\n`);
    console.log('    seeded:', JSON.stringify(boot.counts));
    if (boot.owner.created) {
      console.log(`\n    Owner account created: ${boot.owner.email}`);
      if (boot.owner.defaultPassword) {
        console.log(`    Password: ${boot.owner.defaultPassword}`);
        console.log('    ^ development default. Set MOODOOR_ADMIN_PASSWORD before exposing this.');
      }
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('\n    ANTHROPIC_API_KEY is not set: Studio runs in geometry-only mode.');
    }
    console.log('');
  });
}

module.exports = { createApp, normaliseInventoryPayload, parseCsv };
