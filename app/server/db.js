/**
 * db.js — SQLite schema + seeding.
 *
 * The table and column names are ported verbatim from the Drizzle schema that
 * shipped in the archive (`schema.ts`, 11 mysqlTable definitions). That schema
 * targeted MySQL on a hosted platform which is not available here, so the types
 * are mapped to SQLite (int -> INTEGER, varchar/text -> TEXT, decimal -> REAL,
 * boolean -> INTEGER 0/1, timestamp -> TEXT ISO-8601) and the mysqlEnum
 * constraints are kept as CHECK constraints so the same values remain legal.
 * Everything an admin edits still lands in the field the original app named.
 *
 * Extra columns exist on catalog_products / catalog_bundles / catalog_territories
 * / seasonal_drops to carry the presentational payload the static pages already
 * had (inline SVG, trio markup, signature bars). Without them the database could
 * not reproduce the pages it is meant to drive.
 *
 * Uses node:sqlite, built into Node 22 — no native module to install.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  openId        TEXT NOT NULL UNIQUE,
  name          TEXT,
  email         TEXT UNIQUE,
  passwordHash  TEXT,
  loginMethod   TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt     TEXT NOT NULL DEFAULT (datetime('now')),
  lastSignedIn  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  userId     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  expiresAt  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contentKey  TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  heading     TEXT,
  body        TEXT,
  imageUrl    TEXT,
  imageKey    TEXT,
  altText     TEXT,
  updatedBy   INTEGER,
  createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_products (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  territory          TEXT NOT NULL,
  lede               TEXT,
  description        TEXT,
  price              REAL NOT NULL DEFAULT 0,
  blueprintCode      TEXT,
  blueprintVersion   TEXT,
  listingImageUrl    TEXT,
  heroImageUrl       TEXT,
  inventoryQuantity  INTEGER NOT NULL DEFAULT 0,
  runLimit           INTEGER NOT NULL DEFAULT 0,
  blueprintPrice     REAL NOT NULL DEFAULT 39,
  blueprintAssetUrl  TEXT,
  blueprintFilename  TEXT,
  profileJson        TEXT,
  anatomyJson        TEXT,
  storyJson          TEXT,
  relatedJson        TEXT,
  motifSvg           TEXT,
  motifViewBox       TEXT,
  blueprintJson      TEXT,
  isPublished        INTEGER NOT NULL DEFAULT 1,
  sortOrder          INTEGER NOT NULL DEFAULT 0,
  updatedBy          INTEGER,
  createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_bundles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  territory    TEXT NOT NULL,
  price        REAL NOT NULL DEFAULT 0,
  priceLabel   TEXT,
  saving       TEXT,
  lede         TEXT,
  description  TEXT,
  itemsJson    TEXT,
  visualClass  TEXT NOT NULL DEFAULT 'v1',
  trioHtml     TEXT,
  ctaHref      TEXT,
  tone         TEXT NOT NULL DEFAULT 'olive',
  imageUrl     TEXT,
  isPublished  INTEGER NOT NULL DEFAULT 1,
  sortOrder    INTEGER NOT NULL DEFAULT 0,
  updatedBy    INTEGER,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_territories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  overline       TEXT,
  numeral        TEXT,
  description    TEXT,
  lede           TEXT,
  designCount    INTEGER NOT NULL DEFAULT 0,
  visualClass    TEXT,
  visualSvg      TEXT,
  signatureJson  TEXT,
  samples        TEXT,
  browseHref     TEXT,
  tone           TEXT NOT NULL DEFAULT 'olive',
  imageUrl       TEXT,
  isPublished    INTEGER NOT NULL DEFAULT 1,
  sortOrder      INTEGER NOT NULL DEFAULT 0,
  updatedBy      INTEGER,
  createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasonal_drops (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  dropNumber        TEXT,
  timingLabel       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','next','live','archived')),
  statusLabel       TEXT,
  lede              TEXT,
  description       TEXT,
  tagsJson          TEXT,
  finishedRunCount  INTEGER NOT NULL DEFAULT 0,
  blueprintCount    INTEGER NOT NULL DEFAULT 0,
  imageUrl          TEXT,
  launchAt          TEXT,
  isPublished       INTEGER NOT NULL DEFAULT 1,
  sortOrder         INTEGER NOT NULL DEFAULT 0,
  updatedBy         INTEGER,
  createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS studio_concepts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  memory          TEXT,
  territory       TEXT NOT NULL,
  palette         TEXT,
  focalFlorals    TEXT,
  foliage         TEXT,
  styleNotes      TEXT,
  renderPrompt    TEXT,
  renderUrl       TEXT,
  renderAlt       TEXT,
  blueprintJson   TEXT,
  scoreJson       TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','generating','ready','approved','published','failed')),
  generationError TEXT,
  reviewNotes     TEXT,
  productSlug     TEXT,
  createdBy       INTEGER NOT NULL,
  updatedBy       INTEGER,
  publishedAt     TEXT,
  createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodoor_briefs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  sourceMemory      TEXT,
  season            TEXT,
  territory         TEXT NOT NULL,
  collectionName    TEXT,
  palette           TEXT,
  materials         TEXT,
  collectionInsight TEXT,
  collectionPlan    TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','analyzed','approved','archived')),
  createdBy         INTEGER NOT NULL,
  updatedBy         INTEGER,
  createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodoor_stories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL DEFAULT 'story'
                    CHECK (kind IN ('lifestyle','studio','genesis','story','lookbook')),
  title             TEXT NOT NULL,
  eyebrow           TEXT,
  excerpt           TEXT,
  body              TEXT,
  imageUrl          TEXT,
  linkedProductSlug TEXT,
  linkedDropSlug    TEXT,
  isPublished       INTEGER NOT NULL DEFAULT 0,
  sortOrder         INTEGER NOT NULL DEFAULT 0,
  createdBy         INTEGER NOT NULL,
  updatedBy         INTEGER,
  publishedAt       TEXT,
  createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodoor_quality_checks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  studioConceptSlug  TEXT,
  productSlug        TEXT,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','in_review','passed','needs_revision')),
  compositionScore   INTEGER NOT NULL DEFAULT 0,
  materialScore      INTEGER NOT NULL DEFAULT 0,
  commerceScore      INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  reviewedBy         TEXT,
  checkedAt          TEXT,
  createdBy          INTEGER NOT NULL,
  updatedBy          INTEGER,
  createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodoor_operations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  module            TEXT NOT NULL DEFAULT 'operator'
                    CHECK (module IN ('operator','pipeline','experience','drop')),
  status            TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','active','blocked','complete')),
  summary           TEXT,
  ownerNote         TEXT,
  linkedBriefSlug   TEXT,
  linkedStorySlug   TEXT,
  linkedProductSlug TEXT,
  linkedDropSlug    TEXT,
  dueAt             TEXT,
  createdBy         INTEGER NOT NULL,
  updatedBy         INTEGER,
  completedAt       TEXT,
  createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodoor_inventory_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                 TEXT NOT NULL UNIQUE,
  canonId             TEXT,
  species             TEXT NOT NULL,
  colorName           TEXT,
  colorHex            TEXT,
  primaryRole         TEXT,
  qtyOnHand           INTEGER NOT NULL DEFAULT 0,
  recommendedQty24in  INTEGER,
  unitPrice           REAL,
  seasonality         TEXT,
  primaryEmotion      TEXT,
  secondaryEmotion    TEXT,
  wheelSector         TEXT,
  textureArchetype    TEXT,
  isRegisterGap       INTEGER NOT NULL DEFAULT 0,
  lowStockThreshold   INTEGER NOT NULL DEFAULT 5,
  notes               TEXT,
  createdBy           INTEGER,
  updatedBy           INTEGER,
  createdAt           TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_published ON catalog_products(isPublished, sortOrder);
CREATE INDEX IF NOT EXISTS idx_bundles_published  ON catalog_bundles(isPublished, sortOrder);
CREATE INDEX IF NOT EXISTS idx_terr_published     ON catalog_territories(isPublished, sortOrder);
CREATE INDEX IF NOT EXISTS idx_drops_published    ON seasonal_drops(isPublished, sortOrder);
CREATE INDEX IF NOT EXISTS idx_stories_published  ON moodoor_stories(isPublished, sortOrder);
CREATE INDEX IF NOT EXISTS idx_inventory_species  ON moodoor_inventory_items(species);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry    ON sessions(expiresAt);
`;

/* ---------------------------------------------------------------- *
 * Password hashing — scrypt, from node:crypto. No dependency needed.
 * ---------------------------------------------------------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/* ---------------------------------------------------------------- */

function open(file) {
  const dbPath = file || process.env.MOODOOR_DB || path.join(ROOT, 'data/moodoor.sqlite');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

function insertRow(db, table, row) {
  const cols = Object.keys(row);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  );
  stmt.run(...cols.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }));
}

/**
 * Seed from data/seed.json (extracted from the shipped storefront by
 * tools/build-seed.mjs). Idempotent: INSERT OR IGNORE on unique slugs, so
 * restarting never duplicates or overwrites an admin's edits.
 */
function seed(db, opts = {}) {
  const seedPath = path.join(ROOT, 'data/seed.json');
  if (!fs.existsSync(seedPath)) throw new Error('data/seed.json missing — run: node tools/build-seed.mjs');
  const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const owner = ensureOwner(db, opts);

  const stamp = (rows) => rows.map((r) => ({ ...r, updatedBy: owner.id }));

  for (const r of stamp(data.siteContent)) insertRow(db, 'site_content', r);
  for (const r of stamp(data.products)) insertRow(db, 'catalog_products', r);
  for (const r of stamp(data.bundles)) insertRow(db, 'catalog_bundles', r);
  for (const r of stamp(data.territories)) insertRow(db, 'catalog_territories', r);
  for (const r of stamp(data.drops)) insertRow(db, 'seasonal_drops', r);

  const invCount = db.prepare('SELECT COUNT(*) AS n FROM moodoor_inventory_items').get().n;
  if (!invCount) {
    for (const r of data.inventory) insertRow(db, 'moodoor_inventory_items', { ...r, createdBy: owner.id });
  }

  return {
    owner,
    counts: {
      siteContent: db.prepare('SELECT COUNT(*) AS n FROM site_content').get().n,
      products: db.prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n,
      bundles: db.prepare('SELECT COUNT(*) AS n FROM catalog_bundles').get().n,
      territories: db.prepare('SELECT COUNT(*) AS n FROM catalog_territories').get().n,
      drops: db.prepare('SELECT COUNT(*) AS n FROM seasonal_drops').get().n,
      inventory: db.prepare('SELECT COUNT(*) AS n FROM moodoor_inventory_items').get().n,
    },
  };
}

function ensureOwner(db, opts = {}) {
  const email = opts.email || process.env.MOODOOR_ADMIN_EMAIL || 'owner@moodoor.studio';
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) return { ...existing, created: false };

  const password = opts.password || process.env.MOODOOR_ADMIN_PASSWORD || 'moodoor-admin';
  const generated = !opts.password && !process.env.MOODOOR_ADMIN_PASSWORD;

  db.prepare(`INSERT INTO users (openId, name, email, passwordHash, loginMethod, role)
              VALUES (?, ?, ?, ?, 'password', 'admin')`)
    .run(crypto.randomUUID(), 'Moodoor Owner', email, hashPassword(password));

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return { ...user, created: true, defaultPassword: generated ? password : null };
}

module.exports = { open, seed, ensureOwner, hashPassword, verifyPassword, insertRow, SCHEMA };
