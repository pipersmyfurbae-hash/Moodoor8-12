/**
 * build-seed.mjs — extracts data/seed.json from the shipped storefront.
 *
 * The bundles / territories / drops pages arrived as hand-written static HTML
 * with no data layer, so the admin had nothing to edit. Rather than retyping
 * that copy (and risking drift from what the pages actually say), this reads the
 * real markup and lifts each card into a record — including its inline SVG, so
 * hydrating from the database reproduces the page pixel-for-pixel.
 *
 * Products come from wreaths-data.js, which is already structured.
 *
 * Run: node tools/build-seed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const text = (s) => (s == null ? null : s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
  .replace(/&amp;/g, '&').replace(/&rarr;/g, '→').replace(/&middot;/g, '·')
  .replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, '’').trim());

/** Every top-level <article class="X ..."> block in a document. */
function articles(html, cls) {
  const out = [];
  const open = new RegExp(`<article class="${cls}[^"]*"[^>]*>`, 'g');
  let m;
  while ((m = open.exec(html))) {
    // Walk forward counting <article> nesting to find the matching close.
    let depth = 1;
    const scan = /<article\b|<\/article>/g;
    scan.lastIndex = m.index + m[0].length;
    let s;
    while (depth > 0 && (s = scan.exec(html))) {
      depth += s[0] === '</article>' ? -1 : 1;
    }
    if (depth === 0) out.push(html.slice(m.index + m[0].length, scan.lastIndex - '</article>'.length));
  }
  return out;
}

const grab = (block, re) => { const m = block.match(re); return m ? m[1] : null; };
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* ------------------------------------------------------------------ *
 * Products — from wreaths-data.js
 * ------------------------------------------------------------------ */
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(read('wreaths-data.js'), sandbox);
const WREATHS = sandbox.window.MOODOOR_WREATHS;

const products = Object.entries(WREATHS).map(([slug, w], i) => ({
  slug,
  name: w.name,
  territory: w.territory,
  lede: w.lede,
  description: w.desc,
  price: w.price,
  blueprintCode: w.bp,
  blueprintVersion: w.version,
  inventoryQuantity: w.runRemaining,
  runLimit: w.runTotal,
  blueprintPrice: 39,
  isPublished: 1,
  sortOrder: i,
  profileJson: JSON.stringify(w.profile),
  anatomyJson: JSON.stringify(w.anatomy),
  storyJson: JSON.stringify(w.story),
  relatedJson: JSON.stringify(w.related || []),
  motifSvg: w.motif,
  motifViewBox: w.vb,
  blueprintJson: w.blueprint ? JSON.stringify(w.blueprint) : null,
}));

/* ------------------------------------------------------------------ *
 * Bundles — collection-bundles.html
 * ------------------------------------------------------------------ */
const bundlesHtml = read('collection-bundles.html');
const bundles = articles(bundlesHtml, 'bundle').map((b, i) => {
  const name = text(grab(b, /<h2>([\s\S]*?)<\/h2>/));
  const priceLabel = text(grab(b, /class="b-price">([\s\S]*?)<\/span>/)) || '';
  return {
    slug: slugify(name),
    name,
    territory: text(grab(b, /class="overline">([\s\S]*?)<\/span>/)),
    price: Number((priceLabel.match(/\$(\d+)/) || [])[1] || 0),
    priceLabel,
    saving: text(grab(b, /class="save">([\s\S]*?)<\/span>/)),
    lede: text(grab(b, /class="b-lede">([\s\S]*?)<\/p>/)),
    description: text(grab(b, /class="desc">([\s\S]*?)<\/p>/)),
    itemsJson: JSON.stringify(
      [...b.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => ({
        html: m[1].trim(), text: text(m[1]),
      }))
    ),
    visualClass: grab(b, /class="b-visual (v\d)"/) || 'v1',
    trioHtml: grab(b, /<div class="trio">([\s\S]*?)<\/div>\s*<\/div>/),
    ctaHref: grab(b, /class="b-cta" href="([^"]+)"/) || 'signature-wreaths.html',
    tone: 'olive',
    isPublished: 1,
    sortOrder: i,
  };
});

/* ------------------------------------------------------------------ *
 * Territories — territories.html
 * ------------------------------------------------------------------ */
const terrHtml = read('territories.html');
const territories = articles(terrHtml, 'terr').map((b, i) => {
  const name = text(grab(b, /<h2>([\s\S]*?)<\/h2>/));
  return {
    slug: slugify(name),
    name,
    overline: text(grab(b, /class="overline">([\s\S]*?)<\/span>/)),
    numeral: text(grab(b, /class="num">([\s\S]*?)<\/span>/)),
    designCount: Number((text(grab(b, /class="count">([\s\S]*?)<\/span>/)) || '').match(/\d+/) || 0),
    lede: text(grab(b, /class="t-lede">([\s\S]*?)<\/p>/)),
    description: text(grab(b, /class="desc">([\s\S]*?)<\/p>/)),
    visualClass: grab(b, /class="t-visual (v-[a-z]+)"/) || 'v-comfort',
    visualSvg: grab(b, /(<svg[\s\S]*?<\/svg>)/),
    signatureJson: JSON.stringify(
      [...b.matchAll(/<div class="sig-row"><span>([^<]+)<\/span>[\s\S]*?data-v="(\d+)"/g)]
        .map((m) => ({ label: m[1], value: Number(m[2]) }))
    ),
    samples: text(grab(b, /class="samples">([\s\S]*?)<\/span>/)),
    browseHref: grab(b, /<a href="([^"]+)">Browse/) || 'signature-wreaths.html',
    tone: 'olive',
    isPublished: 1,
    sortOrder: i,
  };
});

/* ------------------------------------------------------------------ *
 * Drops — upcoming-drops.html
 * ------------------------------------------------------------------ */
const dropsHtml = read('upcoming-drops.html');
const STATUS = { next: 'next', planned: 'planned', live: 'live', archived: 'archived' };
const drops = articles(dropsHtml, 'drop').map((b, i) => {
  const title = text(grab(b, /<h2>([\s\S]*?)<\/h2>/));
  const when = grab(b, /<div class="d-when">([\s\S]*?)<\/div>/) || '';
  const statusClass = (when.match(/class="status ([a-z]+)"/) || [])[1] || 'planned';
  const tags = [...b.matchAll(/<span class="d-tag( amber)?">([^<]+)<\/span>/g)]
    .map((m) => ({ label: text(m[2]), amber: Boolean(m[1]) }));
  return {
    slug: slugify(title),
    title,
    dropNumber: text(grab(when, /<b>([\s\S]*?)<\/b>/)),
    timingLabel: text(when.replace(/<b>[\s\S]*?<\/b>/, '').replace(/<span[\s\S]*?<\/span>/, '')),
    status: STATUS[statusClass] || 'planned',
    statusLabel: text(grab(when, /class="status [a-z]+">([\s\S]*?)<\/span>/)),
    lede: text(grab(b, /class="d-lede">([\s\S]*?)<\/p>/)),
    description: text(grab(b, /class="desc">([\s\S]*?)<\/p>/)),
    tagsJson: JSON.stringify(tags),
    isPublished: 1,
    sortOrder: i,
  };
});

/* ------------------------------------------------------------------ *
 * Inventory — the EFS-1.0 canon, flattened as the importer would
 * ------------------------------------------------------------------ */
const canon = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/moodoor-inventory.json'), 'utf8'));
const inventory = [];
for (const sp of canon.species || []) {
  for (const k of sp.skus || []) {
    inventory.push({
      sku: k.sku, canonId: String(sp.canon_id), species: sp.species,
      colorName: k.color_name, primaryRole: k.primary_role,
      qtyOnHand: k.qty_on_hand, recommendedQty24in: k.recommended_qty_24in,
      unitPrice: k.price, seasonality: sp.seasonality,
      primaryEmotion: sp.primary_emotion, secondaryEmotion: sp.secondary_emotion,
      wheelSector: sp.wheel_sector, textureArchetype: sp.texture_archetype,
      isRegisterGap: 0,
    });
  }
}
for (const gap of canon.register_gaps || []) {
  inventory.push({
    sku: 'GAP-' + slugify(gap).toUpperCase(), canonId: null, species: gap,
    colorName: null, primaryRole: null, qtyOnHand: 0, recommendedQty24in: null,
    unitPrice: null, seasonality: null, primaryEmotion: null, secondaryEmotion: null,
    wheelSector: null, textureArchetype: null, isRegisterGap: 1,
  });
}

/* ------------------------------------------------------------------ *
 * Editable site copy — the headline strings the admin owns
 * ------------------------------------------------------------------ */
const indexHtml = read('index.html');
const siteContent = [
  {
    contentKey: 'home.hero',
    label: 'Homepage hero',
    heading: text(grab(indexHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/)) || 'Moodoor',
    body: text(grab(indexHtml, /<p class="h-lede">([\s\S]*?)<\/p>/)) ||
      text(grab(indexHtml, /<p class="lede">([\s\S]*?)<\/p>/)) || '',
  },
  {
    contentKey: 'site.footer',
    label: 'Footer note',
    heading: 'Moodoor',
    body: 'Memory-matched faux botanical wreaths, built 1:1 to a scored blueprint.',
  },
];

/* ------------------------------------------------------------------ */
const seed = { products, bundles, territories, drops, inventory, siteContent };
fs.writeFileSync(path.join(ROOT, 'data/seed.json'), JSON.stringify(seed, null, 1));

const counts = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.length]));
console.log('seed.json', counts);

for (const [k, v] of Object.entries(seed)) {
  if (!v.length) throw new Error(`seed extraction produced no ${k} — the page markup changed`);
}
for (const b of bundles) if (!b.name || !b.trioHtml) throw new Error(`bundle "${b.slug}" incomplete`);
for (const t of territories) if (!t.name || !t.visualSvg) throw new Error(`territory "${t.slug}" incomplete`);
for (const d of drops) if (!d.title || !d.timingLabel) throw new Error(`drop "${d.slug}" incomplete`);
console.log('all extracted records complete');
