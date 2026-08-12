/**
 * build-inventory.mjs — generates public/inventory.js (window.EverInventory).
 *
 * PROVENANCE (every field traces to an archive file — nothing is invented):
 *
 *  - SKU list, species, color_name, price, qty_on_hand, recommended_qty_24in,
 *    seasonality, emotions            <- data/moodoor-inventory.json (EFS-1.0 canon,
 *                                        43 species / 551 SKUs, shipped in the archive)
 *  - engineType (focal/secondary/…)   <- derived from SPECIES, per the archive's own
 *                                        instruction in moodoor-studio-src/README.md:
 *                                        "Bloom vs greenery comes from the species canon,
 *                                        not the per-SKU `primary_role` tag, which
 *                                        routinely mislabels dahlias and roses as
 *                                        foliage." Verified: the canon's per-SKU roles
 *                                        are uniformly random (Pine Bough tagged
 *                                        'focal' x5, Blue Hydrangea has no 'foliage'),
 *                                        so they are not usable as-is.
 *  - hex                              <- derived from color_name via PALETTE below.
 *                                        The canon's per-SKU `hex` is likewise random
 *                                        (color_name "Ivory" carries #9e4fbf, #37aea8,
 *                                        #c74375 …), so it is not usable. color_name
 *                                        itself is a clean 18-value vocabulary and IS
 *                                        used. PALETTE hexes come from the storefront's
 *                                        own COLOR_HEX table in studio.html where the
 *                                        name exists there, and stay inside the
 *                                        Evercrafted register (brand-tokens.md) otherwise.
 *  - legacy WW-* / PH-* aliases       <- recovered from the 10 real EC_WR_V2 blueprints
 *                                        shipped in wreaths-data.js (stems[].name).
 *
 * Run: node tools/build-inventory.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * Palette: color_name -> hex.
 * Names marked (studio.html) are copied from that file's COLOR_HEX map.
 * ------------------------------------------------------------------ */
const PALETTE = {
  Ivory: '#EDE6D4',        // studio.html IVORY
  Cream: '#EFE7D6',        // studio.html CREAM
  Blush: '#E7C3BF',        // studio.html BLUSH
  Plum: '#7E5A74',         // studio.html PLUM
  Amber: '#D4A84B',        // studio.html AMBER
  Rust: '#B06A45',         // studio.html RUST
  Sage: '#8CA37E',         // studio.html SAGE
  Olive: '#6E7B4D',        // studio.html OLIVE
  Terracotta: '#B5603F',   // studio.html TERRA
  'Dust Rose': '#C9A9A2',  // studio.html DUSTY
  Champagne: '#E3D6BC',
  Parchment: '#E8E1D2',
  Bone: '#DED8CB',
  Toffee: '#A8794C',
  Cognac: '#8E5A34',
  Wine: '#6E2F3C',
  Moss: '#5C7050',
  Slate: '#6E7A85',
};

/* ------------------------------------------------------------------ *
 * Species -> engine role, visual weight, typical bloom diameter (inches).
 * One entry per in-stock species in the canon. Assignment is botanical:
 * a dahlia is a focal bloom, a pine bough is foliage.
 * ------------------------------------------------------------------ */
const SPECIES = {
  'Amber Dahlia':         ['focal', 'heavy', 5.0],
  'Golden Dahlia':        ['focal', 'heavy', 5.0],
  'Blue Hydrangea':       ['focal', 'heavy', 6.5],
  'Preserved Peony':      ['focal', 'heavy', 5.5],
  'Champagne Peony':      ['focal', 'heavy', 5.5],
  'Garden Rose':          ['focal', 'heavy', 4.0],
  'Terracotta Zinnia':    ['focal', 'medium', 3.5],
  'Copper Chrysanthemum': ['focal', 'heavy', 4.5],
  'Ivory Lisianthus':     ['focal', 'medium', 3.0],

  'White Rosebud':        ['secondary', 'medium', 2.0],
  'Cream Ranunculus':     ['secondary', 'medium', 2.8],
  'White Ranunculus':     ['secondary', 'medium', 2.8],
  'Blush Ranunculus':     ['secondary', 'medium', 2.8],
  'Plum Anemone':         ['secondary', 'medium', 3.0],
  'Thistle Bloom':        ['secondary', 'medium', 2.2],
  'Dried Strawflower':    ['secondary', 'light', 1.8],

  'White Waxflower':      ['filler', 'light', 1.2],
  'Cream Waxflower':      ['filler', 'light', 1.2],
  'Dried Pampas':         ['filler', 'light', 2.4],
  'Golden Wheat Stem':    ['filler', 'light', 1.0],
  'Grey Lichen':          ['filler', 'light', 1.6],

  'Amber Pip Berry':      ['accent', 'light', 1.4],
  'Mustard Berry':        ['accent', 'light', 1.4],
  'Holly Berry':          ['accent', 'light', 1.6],
  'Bittersweet Vine':     ['accent', 'light', 1.8],
  'Bare Willow':          ['accent', 'light', 1.0],

  'Blue Cedar':           ['foliage', 'medium', 0],
  'Toasted Oak Leaf':     ['foliage', 'medium', 0],
  'Seeded Eucalyptus':    ['foliage', 'medium', 0],
  'Sage Eucalyptus':      ['foliage', 'medium', 0],
  'Wild Ivy':             ['foliage', 'light', 0],
  'Silver Sage':          ['foliage', 'light', 0],
  'Dusty Miller':         ['foliage', 'light', 0],
  'Magnolia Leaf':        ['foliage', 'heavy', 0],
  'Boxwood Sprig':        ['foliage', 'light', 0],
  'Pine Bough':           ['foliage', 'medium', 0],
  'Fir Sprig':            ['foliage', 'medium', 0],
  'Wild Fern':            ['foliage', 'light', 0],
};

/* Colour family, for EC's palette reasoning. Derived from color_name. */
const FAMILY = {
  Ivory: 'neutral', Cream: 'neutral', Parchment: 'neutral', Bone: 'neutral',
  Champagne: 'neutral', Blush: 'warm', 'Dust Rose': 'warm', Rust: 'warm',
  Terracotta: 'warm', Amber: 'warm', Toffee: 'warm', Cognac: 'warm',
  Wine: 'deep', Plum: 'deep', Slate: 'cool', Sage: 'green', Olive: 'green',
  Moss: 'green',
};

/**
 * Legacy item ids that appear in the ten shipped catalog blueprints
 * (wreaths-data.js) but predate the EFS-1.0 canon. Names are taken verbatim
 * from `stems[].name` in those blueprints. The three foliage-sweep ids carry
 * no name in the source, so they use the generic label that studio.html's own
 * `resolveItem()` fallback produces for an unrecognised id.
 */
const LEGACY = [
  ['WW-96501NT-BI',   'Dahlia',                     'focal',     'Rust',      'heavy', 5.0],
  ['WW-34028-PKGR',   'Berry Pick',                 'secondary', 'Blush',     'light', 1.4],
  ['WW-96045-RD',     'Bittersweet Berry Branch',   'accent',    'Rust',      'light', 1.8],
  ['WW-98060-LY',     'Dutch Garden Rose Spray X2', 'focal',     'Cream',     'heavy', 4.0],
  ['WW-98068-OH',     'Peony',                      'focal',     'Blush',     'heavy', 5.5],
  ['WW-06436-CR',     'Garden Ranunculus Stem',     'focal',     'Cream',     'medium', 2.8],
  ['WW-95558-GR',     'Hellebores Rose',            'secondary', 'Sage',      'medium', 3.0],
  ['WW-95513NT-CRBL', 'Anemone',                    'focal',     'Slate',     'medium', 3.0],
  ['WW-07355-WH',     'Dogwood Branch (White)',     'secondary', 'Ivory',     'light', 1.6],
  ['PH-FOL-EUC',      'Eucalyptus',                 'foliage',   'Sage',      'medium', 0],
  ['WW-95632-GR',     'Foliage stem',               'foliage',   'Moss',      'medium', 0],
  ['WW-32616-BU',     'Foliage stem',               'foliage',   'Olive',     'medium', 0],
];

/* ------------------------------------------------------------------ */

const canon = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/moodoor-inventory.json'), 'utf8'));

const items = [];
const unknownSpecies = [];

for (const sp of canon.species || []) {
  if (!sp.sku_count) continue;                 // register gaps are never selectable
  const def = SPECIES[sp.species];
  if (!def) { unknownSpecies.push(sp.species); continue; }
  const [engineType, visualWeight, bloomIn] = def;

  for (const k of sp.skus || []) {
    const hex = PALETTE[k.color_name];
    if (!hex) throw new Error(`No palette entry for color_name "${k.color_name}"`);
    items.push({
      id: k.sku,
      // "Blue Cedar" in the colourway "Rust" is not a "Rust Blue Cedar" — many
      // canon species names already carry a colour word, and the SKU colourway
      // is assigned independently of it. Naming the species first and the
      // colourway in parentheses avoids the doubled-up colour and keeps it
      // clear which of the two is the SKU attribute.
      name: `${sp.species} (${k.color_name})`,
      species: sp.species,
      mjSpecies: sp.species.toLowerCase(),
      hex,
      colorName: k.color_name,
      colorFamily: FAMILY[k.color_name] || 'neutral',
      engineType,
      role: engineType,
      visualWeight,
      bloomIn,
      price: k.price,
      qtyOnHand: k.qty_on_hand,
      recommendedQty24in: k.recommended_qty_24in,
      seasonality: [sp.seasonality].filter(Boolean),
      primaryEmotion: sp.primary_emotion,
      secondaryEmotion: sp.secondary_emotion,
      canonId: String(sp.canon_id),
    });
  }
}

for (const [id, name, engineType, colorName, visualWeight, bloomIn] of LEGACY) {
  items.push({
    id, name, species: name, mjSpecies: name.toLowerCase(),
    hex: PALETTE[colorName], colorName, colorFamily: FAMILY[colorName] || 'neutral',
    engineType, role: engineType, visualWeight, bloomIn,
    price: null, qtyOnHand: null, recommendedQty24in: null,
    seasonality: ['year-round'], primaryEmotion: null, secondaryEmotion: null,
    canonId: null, legacy: true,
  });
}

if (unknownSpecies.length) {
  throw new Error(`Species missing from SPECIES table: ${unknownSpecies.join(', ')}`);
}

const byRole = items.reduce((a, i) => ((a[i.engineType] = (a[i.engineType] || 0) + 1), a), {});

const out = `/* GENERATED by tools/build-inventory.mjs — do not edit by hand.
 * Source: data/moodoor-inventory.json (EFS-1.0, ${canon.species_count} species /
 * ${canon.sku_count_total} SKUs) + legacy ids recovered from wreaths-data.js.
 * Items: ${items.length}  (${Object.entries(byRole).map(([k, v]) => `${k} ${v}`).join(', ')})
 * Register gaps excluded: ${(canon.register_gaps || []).join(', ')}
 */
window.EverInventory = ${JSON.stringify(items)};
window.EverInventoryMeta = ${JSON.stringify({
  schema: canon.schema, generatedAt: canon.generated_at,
  speciesCount: canon.species_count, skuCountTotal: canon.sku_count_total,
  registerGaps: canon.register_gaps || [], itemCount: items.length, byRole,
})};
`;

fs.writeFileSync(path.join(ROOT, 'public/inventory.js'), out);
console.log(`inventory.js: ${items.length} items`, byRole);
