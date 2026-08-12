/**
 * Engine tests. Two jobs:
 *  1. prove the rebuilt engine consumes the TEN REAL blueprints shipped in
 *     wreaths-data.js without error, since those are the ground truth;
 *  2. prove composeDreamBlueprint emits the same schema, deterministically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Load the browser globals the same way a page does. */
const sandbox = { window: {}, console, module: undefined };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/inventory.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/wreaths-data.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/evercrafted-engine.js'), 'utf8'), sandbox);

const EC = sandbox.EC;
const EverInventory = sandbox.window.EverInventory;
const WREATHS = sandbox.window.MOODOOR_WREATHS;

/* Bind inventory exactly as studio.html's wireInventory() does. */
EC.data.inventory = {
  items: EverInventory.map((f) => ({
    item_id: f.id,
    name: f.name,
    mjSpecies: (f.mjSpecies || f.name || '').toLowerCase(),
    color_hex: f.hex,
    color_family: f.colorFamily,
    colorName: f.colorName,
    bloom_diameter_in: { typical: f.bloomIn > 0 ? f.bloomIn : f.visualWeight === 'heavy' ? 5.5 : f.visualWeight === 'light' ? 2.2 : 3.6 },
    role: f.engineType || f.role,
    price: f.price,
  })),
};

const SLUGS = Object.keys(WREATHS);

/* ------------------------------------------------------------------ *
 * Geometry — ported behaviour must match the placement engine's spec
 * ------------------------------------------------------------------ */

test('angle convention: 0=12 o clock, 90=3 o clock, clockwise on screen', () => {
  const top = EC.polar(10, 0, 0, 0);
  assert.ok(Math.abs(top.x) < 1e-9 && Math.abs(top.y + 10) < 1e-9, 'y is up-negative at 0deg');
  const right = EC.polar(10, 90, 0, 0);
  assert.ok(Math.abs(right.x - 10) < 1e-9 && Math.abs(right.y) < 1e-9, '90deg is +x');
});

test('degToClock formats for display, degToClockNum stays numeric', () => {
  assert.equal(EC.degToClock(0), '12:00');
  assert.equal(EC.degToClock(225), '7:30');
  assert.equal(EC.degToClock(270), '9:00');
  assert.equal(EC.degToClockNum(0), 12);
  assert.equal(EC.degToClockNum(225), 7.5);
});

test('subtractArc carves a hole and survives the 0/360 seam', () => {
  const out = EC.geometry.subtractArc({ start: 350, span: 40 }, { start: 355, span: 10 });
  assert.equal(out.length, 2);
  const total = out.reduce((a, r) => a + r.span, 0);
  assert.ok(Math.abs(total - 30) < 1e-6, `expected 30deg surviving, got ${total}`);
});

test('complementRanges of a full circle is empty; of nothing is the circle', () => {
  // Compared through JSON: the engine builds its arrays inside a vm realm, so
  // deepStrictEqual would fail on prototype identity rather than on value.
  assert.equal(JSON.stringify(EC.geometry.complementRanges([{ start: 0, span: 360 }])), '[]');
  assert.equal(JSON.stringify(EC.geometry.complementRanges([])), '[{"start":0,"span":360}]');
});

test('wgsBaseWidthIn matches every shipped canvas exactly', () => {
  for (const slug of SLUGS) {
    const c = WREATHS[slug].blueprint.canvas;
    assert.equal(EC.wgsBaseWidthIn(c.diameter_in), c.base_width_in,
      `${slug}: ${c.diameter_in}" should give base ${c.base_width_in}`);
  }
  assert.equal(EC.wgsBaseWidthIn(22), 4.5, "studio.html's own 22\" fallback");
});

/* ------------------------------------------------------------------ *
 * The ten real blueprints must flow through every consumer
 * ------------------------------------------------------------------ */

test('all ten shipped blueprints score, cost, list, prompt and draw', () => {
  assert.equal(SLUGS.length, 10);
  for (const slug of SLUGS) {
    const bp = WREATHS[slug].blueprint;

    const score = EC.scoreBlueprint(bp);
    assert.equal(score.overall_max, 120);
    assert.ok(score.overall_score >= 0 && score.overall_score <= 120, `${slug} score in range`);
    assert.equal(Object.keys(score.dimension_scores).length, 6, `${slug} has 6 dimensions`);
    for (const d of Object.values(score.dimension_scores)) {
      assert.equal(d.max, 20);
      assert.ok(typeof d.label === 'string' && d.label.length);
      assert.ok(Array.isArray(d.issues));
      assert.ok(d.score >= 0 && d.score <= 20);
    }
    assert.ok('ABCDF'.includes(score.overall_grade));

    const guide = EC.buildConstructionGuide(bp);
    assert.ok(guide.total_purchase > 0, `${slug} purchases stems`);
    assert.ok(guide.total_purchase >= guide.total_placed, `${slug} buys at least what it places`);
    assert.ok(guide.steps.length >= 5);

    const listing = EC.commerceListing(bp, {});
    assert.ok(listing.price_estimate >= 120, `${slug} priced`);
    assert.ok(Array.isArray(listing.description) && listing.description.length >= 3);
    assert.ok(Array.isArray(listing.tags) && listing.tags.length);
    assert.ok(typeof listing.title === 'string' && listing.title.length);

    const prompt = EC.editorialPrompt(bp);
    assert.match(prompt, /--style raw --v 7/, `${slug} carries v7 params`);
    assert.ok(!prompt.includes('::'), `${slug} uses no v6 weighting`);
    assert.ok(!prompt.includes('--q '), `${slug} uses no --q`);

    const svg = EC.generateOmniSVG(bp);
    assert.match(svg, /^<svg /, `${slug} svg opens`);
    assert.match(svg, /<\/svg>$/, `${slug} svg closes`);
    assert.ok(!svg.includes('NaN'), `${slug} svg has no NaN`);
    assert.ok(!svg.includes('undefined'), `${slug} svg has no undefined`);
    assert.ok(svg.length > 2000, `${slug} svg has real content`);
  }
});

test('editorialPrompt never suppresses a material the wreath actually uses', () => {
  for (const slug of SLUGS) {
    const prompt = EC.editorialPrompt(WREATHS[slug].blueprint);
    const [body, negatives = ''] = prompt.split('--no ');
    for (const neg of negatives.split(',').map((s) => s.trim()).filter(Boolean)) {
      // A negative may legitimately appear in the fixed style clauses; what must
      // not happen is banning a species the piece is built from.
      const usedAsMaterial = body.split(', ').slice(1, 6).join(' ').toLowerCase().includes(neg);
      assert.ok(!usedAsMaterial, `${slug}: "--no ${neg}" bans a material it uses`);
    }
  }
});

test('every item_id in the shipped blueprints resolves to a named material', () => {
  const unresolved = new Set();
  for (const slug of SLUGS) {
    const bp = WREATHS[slug].blueprint;
    for (const c of bp.clusters || []) {
      for (const s of c.stems || []) if (!EC.inventoryItem(s.item_id)) unresolved.add(s.item_id);
    }
    for (const f of bp.foliage_sweeps || []) if (!EC.inventoryItem(f.item_id)) unresolved.add(f.item_id);
  }
  assert.deepEqual([...unresolved], [], 'legacy ids must all be aliased in inventory.js');
});

/* ------------------------------------------------------------------ *
 * composeDreamBlueprint
 * ------------------------------------------------------------------ */

function sampleSpec(overrides = {}) {
  const pick = (role) => EverInventory.find((i) => i.engineType === role).id;
  return {
    formula: 'Crescent',
    emotional_tags: ['nostalgia', 'warmth'],
    florals: [
      { item_id: pick('focal'), role: 'focal', qty: 7 },
      { item_id: pick('secondary'), role: 'secondary', qty: 9 },
      { item_id: pick('filler'), role: 'filler', qty: 12 },
      { item_id: pick('accent'), role: 'accent', qty: 3 },
    ],
    foliage: EverInventory.filter((i) => i.engineType === 'foliage').slice(0, 2).map((i) => i.id),
    seed: EC.seedFromText('a september porch, cedar and cold coffee'),
    ...overrides,
  };
}

test('composed blueprint carries every field the shipped ones do', () => {
  const shippedKeys = Object.keys(WREATHS['september-porch'].blueprint);
  const { blueprint } = EC.composeDreamBlueprint(sampleSpec(), {
    diameter_in: 18, base_width_in: EC.wgsBaseWidthIn(18), tier: 'GARDEN',
  });
  for (const k of shippedKeys) {
    assert.ok(k in blueprint, `composed blueprint is missing "${k}"`);
  }
  assert.equal(blueprint.canvas.diameter_in, 18);
  assert.equal(blueprint.canvas.base_width_in, 3.5);
  assert.equal(blueprint.canvas.depth_bands, 3);
  assert.equal(blueprint.coverage_tier, 'Garden');
  assert.equal(blueprint.ribbons.length, 1);
});

test('composition is deterministic for a given seed', () => {
  const a = EC.composeDreamBlueprint(sampleSpec(), { diameter_in: 24, tier: 'GARDEN' }).blueprint;
  const b = EC.composeDreamBlueprint(sampleSpec(), { diameter_in: 24, tier: 'GARDEN' }).blueprint;
  assert.deepEqual(a, b, 'same seed must give the same design');

  const c = EC.composeDreamBlueprint(sampleSpec({ seed: 999 }), { diameter_in: 24, tier: 'GARDEN' }).blueprint;
  assert.notDeepEqual(a.clusters, c.clusters, 'a different seed must move something');
});

test('composed values stay inside the ranges the real blueprints use', () => {
  const RANGE = { focal: [0.60, 0.92], secondary: [0.67, 0.85], accent: [0.78, 0.85], filler: [0.67, 0.76] };
  for (const formula of Object.keys(EC.FORMULAS)) {
    for (const tier of ['EDITORIAL', 'GARDEN', 'LUSH']) {
      const { blueprint: bp } = EC.composeDreamBlueprint(
        sampleSpec({ formula, seed: EC.seedFromText(formula + tier) }),
        { diameter_in: 24, tier }
      );
      const where = `${formula}/${tier}`;
      assert.ok(bp.clusters.length > 0, `${where}: has clusters`);
      for (const c of bp.clusters) {
        const r = RANGE[c.type];
        assert.ok(r, `${where}: unknown cluster type ${c.type}`);
        assert.ok(c.radius_norm >= r[0] - 1e-9 && c.radius_norm <= r[1] + 1e-9,
          `${where}: ${c.type} radius_norm ${c.radius_norm} outside ${r}`);
        assert.ok(c.angle_deg >= 0 && c.angle_deg < 360, `${where}: angle in range`);
        assert.ok([1, 2, 3, 4].includes(c.band), `${where}: band in range`);
        assert.equal(c.stems.length, 1);
        assert.equal(c.stems[0].qty, 1, `${where}: shipped blueprints use qty 1 per cluster`);
      }
      assert.ok(bp.silence_arcs.length >= 1, `${where}: every journey needs a moment of rest`);
      assert.ok(bp.foliage_sweeps.length >= 1, `${where}: greenery architecture exists`);
      for (const f of bp.foliage_sweeps) {
        assert.ok([16, 20, 24].includes(f.step_deg), `${where}: step_deg ${f.step_deg} off-canon`);
        assert.equal(f.flow, 'cw');
      }
      assert.ok(bp.balance.mag >= 0 && bp.balance.mag <= 1);

      // and it must survive the whole downstream chain
      const svg = EC.generateOmniSVG(bp);
      assert.ok(!svg.includes('NaN'), `${where}: svg has NaN`);
      assert.ok(EC.scoreBlueprint(bp).overall_score > 0, `${where}: scores`);
      assert.ok(EC.commerceListing(bp, {}).price_estimate > 0, `${where}: prices`);
    }
  }
});

test('every composed design passes the composition gate it is scored against', () => {
  const failures = [];
  for (const formula of Object.keys(EC.FORMULAS)) {
    const { blueprint } = EC.composeDreamBlueprint(
      sampleSpec({ formula, seed: EC.seedFromText(formula) }),
      { diameter_in: 24, tier: 'GARDEN' }
    );
    const s = EC.scoreBlueprint(blueprint);
    if (s.overall_score < 84) failures.push(`${formula}: ${s.overall_grade} ${s.overall_score}/120 — ` +
      Object.values(s.dimension_scores).flatMap((d) => d.issues).join('; '));
  }
  assert.deepEqual(failures, [], 'the engine must not ship its own designs below grade C');
});

test('all twelve formulas hold their grade across many seeds', () => {
  // Not one lucky seed: 40 each. A formula that only composes well sometimes is
  // a formula that will embarrass someone in the Studio.
  const weak = [];
  for (const formula of Object.keys(EC.FORMULAS)) {
    let worst = Infinity;
    for (let s = 0; s < 40; s++) {
      const { blueprint } = EC.composeDreamBlueprint(
        sampleSpec({ formula, seed: s * 7919 }), { diameter_in: 24, tier: 'GARDEN' }
      );
      worst = Math.min(worst, EC.scoreBlueprint(blueprint).overall_score);
    }
    if (worst < 84) weak.push(`${formula}: worst ${worst}/120 over 40 seeds`);
  }
  assert.deepEqual(weak, [], 'every formula must stay at grade C or better on every seed');
});

test('every formula composes to a visually distinct design', () => {
  // Twelve names that render as eight designs is a lie in the UI. This caught
  // Wild Asymmetry sitting on top of Diagonal Flow and Corner Cluster.
  const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  const signatures = Object.keys(EC.FORMULAS).map((formula) => {
    const { blueprint } = EC.composeDreamBlueprint(
      sampleSpec({ formula, seed: 0 }), { diameter_in: 24, tier: 'GARDEN' }
    );
    const focal = blueprint.clusters.filter((c) => c.type === 'focal');
    return {
      formula,
      focalAt: focal.length ? focal[Math.floor(focal.length / 2)].angle_deg : 0,
      balanceDir: blueprint.balance.deg,
    };
  });

  const collisions = [];
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      const a = signatures[i], b = signatures[j];
      // Two formulas are the same design if the focal mass sits in the same
      // place AND the weight leans the same way.
      if (angleGap(a.focalAt, b.focalAt) < 12 && angleGap(a.balanceDir, b.balanceDir) < 12) {
        collisions.push(`${a.formula} is indistinguishable from ${b.formula}`);
      }
    }
  }
  assert.deepEqual(collisions, []);
});

test('coverage tier changes density in the direction it claims', () => {
  const stems = (tier) => {
    const { blueprint } = EC.composeDreamBlueprint(sampleSpec(), { diameter_in: 24, tier });
    return blueprint.clusters.length;
  };
  assert.ok(stems('EDITORIAL') < stems('GARDEN'), 'editorial is sparser than garden');
  assert.ok(stems('GARDEN') < stems('LUSH'), 'lush is fuller than garden');
});

test('seedFromText is stable and well distributed', () => {
  assert.equal(EC.seedFromText('hello'), EC.seedFromText('hello'));
  assert.notEqual(EC.seedFromText('hello'), EC.seedFromText('hellp'));
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(EC.seedFromText('memory ' + i));
  assert.equal(seen.size, 500, 'no collisions across 500 nearby inputs');
});

test('inventory covers every role the Studio shortlist asks for', () => {
  const need = { focal: 16, secondary: 16, filler: 10, accent: 10, foliage: 10 };
  for (const [role, n] of Object.entries(need)) {
    const have = EverInventory.filter((i) => i.engineType === role).length;
    assert.ok(have >= n, `only ${have} ${role} items, shortlist wants ${n}`);
  }
});

test('no register-gap species leaked into the sellable inventory', () => {
  const gaps = sandbox.window.EverInventoryMeta.registerGaps;
  assert.ok(gaps.length > 0);
  for (const gap of gaps) {
    assert.ok(!EverInventory.some((i) => i.species === gap), `${gap} is out of stock and must not be offered`);
  }
});
