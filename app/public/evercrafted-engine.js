/* =============================================================================
 * evercrafted-engine.js — window.EC
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * studio.html and moodoor-product-page.html both load `../evercrafted-engine.js`
 * and `../inventory.js`. Neither file was present in any supplied archive, so the
 * Studio's whole blueprint pipeline and the product page's live blueprint panel
 * were dead code. This is that engine, rebuilt from the material that *is* in the
 * archive:
 *
 *   - the polar arc algebra is ported from the Evercrafted Placement Engine's
 *     `src/core/geometry.js` (Sprint-1 source, shipped in the placement-engine
 *     zip), keeping its angle convention byte-for-byte: degrees only, clockwise
 *     from 12 o'clock, screen projection x = cx + r·sin θ, y = cy − r·cos θ;
 *   - the canon rule ids and their text come from `src/core/canon.js` and the
 *     EC-COMP-001 / EC-GRN-001 / EC-DOS-001 / Placement Engine Spec documents;
 *   - the EC_WR_V2 blueprint schema is taken from the ten *real* engine-produced
 *     blueprints shipped inside wreaths-data.js — field names, value ranges,
 *     band assignment, sweep step, silence-arc spans and balance vector are all
 *     read off that data, not invented (see tools/calibration.md);
 *   - materials resolve against window.EverInventory, generated from the EFS-1.0
 *     canon by tools/build-inventory.mjs.
 *
 * WHAT IS NOT CLAIMED
 * -------------------
 * The original generator is gone, so `composeDreamBlueprint` does not reproduce
 * the original's exact coordinates. It produces a *schema-identical,
 * deterministic, canon-compliant* blueprint: same fields, same ranges, same
 * conventions, same seed→output stability. The ten shipped blueprints still load
 * and render unchanged, because every consumer here reads the schema rather than
 * regenerating it.
 *
 * Pure: no DOM, no network, no state beyond EC.data. Runs in the browser as a
 * global and in Node (module.exports) so the test suite can drive it directly.
 * ============================================================================= */
(function (root, factory) {
  var EC = factory();
  if (typeof module === 'object' && module.exports) module.exports = EC;
  if (root) root.EC = EC;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* =========================================================================
   * 1. GEOMETRY — ported from placement-engine src/core/geometry.js
   * ========================================================================= */

  var DEG_PER_HOUR = 30;
  var EPS = 1e-9;

  function normDeg(deg) { var d = deg % 360; return d < 0 ? d + 360 : d; }

  function signedDelta(a, b) {
    var d = normDeg(b) - normDeg(a);
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
  }

  function clockToDeg(hour) { return normDeg(hour * DEG_PER_HOUR); }

  /**
   * Degrees -> "7:30" style label.
   *
   * NOTE ON THE NAME: the placement engine's `degToClock` returns a *number*
   * in (0,12] and has a separate `formatClock` for the string. Both callers of
   * EC.degToClock here (studio.html buildCatalogRecord, product page anatomy)
   * concatenate the result straight into prose — `degToClock(a) + ' · ' + name`,
   * `degToClock(from) + ' – ' + degToClock(to) + ' preserved'` — so on this
   * surface the display string is what the call site wants. `EC.degToClockNum`
   * exposes the numeric form for anyone who needs it.
   */
  function degToClock(deg) {
    var raw = normDeg(deg) / DEG_PER_HOUR;
    var hours = Math.floor(raw);
    var minutes = Math.round((raw - hours) * 60);
    if (minutes === 60) { minutes = 0; hours += 1; }
    if (hours === 0 || hours === 12) hours = 12; else hours = hours % 12;
    return hours + ':' + String(minutes).padStart(2, '0');
  }

  function degToClockNum(deg) {
    var h = normDeg(deg) / DEG_PER_HOUR;
    return h === 0 ? 12 : h;
  }

  function clampSpan(span) {
    if (!isFinite(span) || span <= 0) return 0;
    return Math.min(span, 360);
  }

  function rangeEnd(r) { return normDeg(r.start + r.span); }

  function rangeFromCenter(centerDeg, spanDeg) {
    var span = clampSpan(spanDeg);
    return { start: normDeg(centerDeg - span / 2), span: span };
  }

  function angleInRange(deg, range) {
    if (range.span >= 360) return true;
    if (range.span <= 0) return false;
    return normDeg(deg - range.start) <= range.span + EPS;
  }

  function rangeOverlap(a, b) {
    if (a.span <= 0 || b.span <= 0) return 0;
    if (a.span >= 360) return b.span;
    if (b.span >= 360) return a.span;
    var rel = normDeg(b.start - a.start);
    var total = 0;
    [rel, rel - 360].forEach(function (bStart) {
      var lo = Math.max(0, bStart);
      var hi = Math.min(a.span, bStart + b.span);
      if (hi > lo) total += hi - lo;
    });
    return total;
  }

  function subtractArc(range, hole) {
    if (!range || range.span <= 0) return [];
    if (!hole || hole.span <= 0) return [{ start: range.start, span: range.span }];
    if (hole.span >= 360) return [];

    var rel = normDeg(hole.start - range.start);
    var cuts = [[rel, rel + hole.span], [rel - 360, rel + hole.span - 360]];
    var segments = [[0, range.span]];

    cuts.forEach(function (cut) {
      var holeLo = cut[0], holeHi = cut[1], next = [];
      segments.forEach(function (seg) {
        var lo = seg[0], hi = seg[1];
        if (holeHi <= lo + EPS || holeLo >= hi - EPS) { next.push([lo, hi]); return; }
        if (holeLo > lo + EPS) next.push([lo, Math.min(holeLo, hi)]);
        if (holeHi < hi - EPS) next.push([Math.max(holeHi, lo), hi]);
      });
      segments = next;
    });

    return segments.filter(function (s) { return s[1] - s[0] > EPS; })
      .map(function (s) { return { start: normDeg(range.start + s[0]), span: s[1] - s[0] }; });
  }

  function subtractArcs(range, holes) {
    var result = [{ start: range.start, span: range.span }];
    (holes || []).forEach(function (hole) {
      var next = [];
      result.forEach(function (seg) { next = next.concat(subtractArc(seg, hole)); });
      result = next;
    });
    return result;
  }

  function mergeRanges(ranges) {
    var live = (ranges || []).filter(function (r) { return r && r.span > EPS; });
    if (!live.length) return [];
    if (live.some(function (r) { return r.span >= 360 - EPS; })) return [{ start: 0, span: 360 }];

    var flat = [];
    live.forEach(function (r) {
      var start = normDeg(r.start), end = start + r.span;
      if (end <= 360 + EPS) flat.push([start, Math.min(end, 360)]);
      else { flat.push([start, 360]); flat.push([0, end - 360]); }
    });
    flat.sort(function (a, b) { return a[0] - b[0]; });

    var merged = [];
    flat.forEach(function (f) {
      var last = merged[merged.length - 1];
      if (last && f[0] <= last[1] + EPS) last[1] = Math.max(last[1], f[1]);
      else merged.push([f[0], f[1]]);
    });

    if (merged.length > 1 && merged[0][0] <= EPS && merged[merged.length - 1][1] >= 360 - EPS) {
      var first = merged.shift();
      merged[merged.length - 1][1] += first[1];
    }
    if (merged.length === 1 && merged[0][1] - merged[0][0] >= 360 - EPS) return [{ start: 0, span: 360 }];
    return merged.map(function (m) { return { start: normDeg(m[0]), span: m[1] - m[0] }; });
  }

  function complementRanges(ranges) {
    var covered = mergeRanges(ranges);
    if (!covered.length) return [{ start: 0, span: 360 }];
    if (covered.length === 1 && covered[0].span >= 360 - EPS) return [];
    var gaps = [];
    for (var i = 0; i < covered.length; i++) {
      var cur = covered[i], nxt = covered[(i + 1) % covered.length];
      var gapStart = rangeEnd(cur);
      var gapSpan = normDeg(nxt.start - gapStart);
      if (gapSpan > EPS) gaps.push({ start: gapStart, span: gapSpan });
    }
    return gaps;
  }

  function polar(radius, deg, cx, cy) {
    cx = cx || 0; cy = cy || 0;
    var rad = (normDeg(deg) * Math.PI) / 180;
    return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
  }

  function fmt(n) { return Number(n.toFixed(3)); }

  function annulusSectorPath(rInner, rOuter, range, cx, cy) {
    cx = cx || 0; cy = cy || 0;
    var span = clampSpan(range.span);
    if (span <= 0) return '';
    if (span >= 360 - EPS) {
      return annulusSectorPath(rInner, rOuter, { start: range.start, span: 180 }, cx, cy) + ' ' +
        annulusSectorPath(rInner, rOuter, { start: normDeg(range.start + 180), span: 180 }, cx, cy);
    }
    var start = normDeg(range.start), end = normDeg(start + span);
    var large = span > 180 ? 1 : 0;
    var o1 = polar(rOuter, start, cx, cy), o2 = polar(rOuter, end, cx, cy);
    var i2 = polar(rInner, end, cx, cy), i1 = polar(rInner, start, cx, cy);
    return 'M ' + fmt(o1.x) + ' ' + fmt(o1.y) +
      ' A ' + fmt(rOuter) + ' ' + fmt(rOuter) + ' 0 ' + large + ' 1 ' + fmt(o2.x) + ' ' + fmt(o2.y) +
      ' L ' + fmt(i2.x) + ' ' + fmt(i2.y) +
      ' A ' + fmt(rInner) + ' ' + fmt(rInner) + ' 0 ' + large + ' 0 ' + fmt(i1.x) + ' ' + fmt(i1.y) + ' Z';
  }

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /**
   * Tapering ribbon following the ring — the primary sweep.
   * EC-GRN-001 GRN-B02: "Thin, readable gesture; never a hedge of greenery."
   */
  function sweepRibbonPath(opts, cx, cy) {
    cx = cx || 0; cy = cy || 0;
    var span = clampSpan(opts.arcDeg);
    var thickness = opts.thickness;
    if (span <= 0 || thickness <= 0) return '';

    var rInner = opts.rInner, rOuter = opts.rOuter;
    var ringWidth = rOuter - rInner;
    var baseRadius = rInner + clamp01(opts.radialPosition == null ? 0.5 : opts.radialPosition) * ringWidth;
    var bowAmplitude = ringWidth * 0.5;
    var curvature = opts.curvature || 0;
    var taper = clamp01(opts.taper || 0);
    var count = Math.max(8, Math.round(opts.samples || 96));

    var outer = [], inner = [];
    for (var i = 0; i <= count; i++) {
      var t = i / count;
      var deg = opts.startDeg + span * t;
      var bow = curvature * bowAmplitude * Math.sin(Math.PI * t);
      var halfWidth = (thickness * (1 - taper * t)) / 2;
      var radius = baseRadius + bow;
      radius = Math.min(Math.max(radius, rInner + halfWidth), rOuter - halfWidth);
      outer.push(polar(radius + halfWidth, deg, cx, cy));
      inner.push(polar(radius - halfWidth, deg, cx, cy));
    }

    var parts = ['M ' + fmt(outer[0].x) + ' ' + fmt(outer[0].y)];
    for (var a = 1; a < outer.length; a++) parts.push('L ' + fmt(outer[a].x) + ' ' + fmt(outer[a].y));
    for (var b = inner.length - 1; b >= 0; b--) parts.push('L ' + fmt(inner[b].x) + ' ' + fmt(inner[b].y));
    parts.push('Z');
    return parts.join(' ');
  }

  var Geometry = {
    DEG_PER_HOUR: DEG_PER_HOUR, normDeg: normDeg, signedDelta: signedDelta,
    clockToDeg: clockToDeg, degToClock: degToClock, degToClockNum: degToClockNum,
    clampSpan: clampSpan, rangeEnd: rangeEnd, rangeFromCenter: rangeFromCenter,
    angleInRange: angleInRange, rangeOverlap: rangeOverlap, subtractArc: subtractArc,
    subtractArcs: subtractArcs, mergeRanges: mergeRanges, complementRanges: complementRanges,
    polar: polar, annulusSectorPath: annulusSectorPath, sweepRibbonPath: sweepRibbonPath,
    clamp01: clamp01, clamp: clamp,
  };

  /* =========================================================================
   * 2. CANON — rule ids + text, from placement-engine src/core/canon.js
   * ========================================================================= */

  var CANON = {
    'COMP.L1':  'Every design establishes a clear emotional anchor.',
    'COMP.L4':  'Every journey contains moments of rest.',
    'COMP.L5':  'Negative space is an active design element.',
    'COMP.L6':  'Greenery creates architecture; flowers inhabit that architecture.',
    'COMP.L7':  'Flowers reinforce movement that already exists instead of inventing it independently.',
    'COMP.L9':  'Every element must earn its place.',
    'COMP.L12': 'A design is not complete merely because every area is filled.',
    'COMP.BALANCE': 'Is visual weight balanced without requiring mirror symmetry?',
    'GRN.L1':   'Greenery architecture is established before floral placement.',
    'GRN.L2':   'Greenery defines movement; florals reinforce it.',
    'GRN.L7':   'Use only the material needed to make the structural gesture readable.',
    'GRN.B02':  'Carry the eye laterally around the wreath form and connect zones. Thin, readable gesture; never a hedge of greenery.',
    'SPEC.ANCHOR':   'Default test location: approximately 7-9 o\'clock. It must remain the dominant visual mass.',
    'SPEC.ECHO':     'It balances the anchor without becoming a second equal focal area. It should be visibly lighter/smaller than the anchor.',
    'SPEC.BALANCE':  'Asymmetry still requires balanced visual weight. Avoid an unresolved "half-moon" effect unless that formula is intentionally selected.',
    'SPEC.DOMINANT': 'Anchor remains visually dominant. Secondary echo never rivals anchor weight.',
    'SPEC.NEGSPACE': 'Negative space remains intentional.',
    'TICKET.FLEX':   'The 7-9 anchor and 5 o\'clock echo are the first canonical test composition. The architecture must remain flexible enough for later composition formulas.',
  };

  /** The 20 canonical WGS emotion slugs (studio.html carries the same list). */
  var WGS_EMOTIONS = ['grief', 'gratitude', 'warmth', 'nostalgia', 'joy', 'celebration',
    'peace', 'hope', 'love', 'strength', 'remembrance', 'renewal', 'comfort', 'wonder',
    'wild', 'tender', 'melancholy', 'reverence', 'playful', 'bold'];

  /**
   * The twelve canonical composition formulas (studio.html FORMULAS).
   *
   * `anchor` is the centre of the focal mass in degrees clockwise from 12.
   * `arc` is how far the focal mass travels. `echo` is the secondary mass centre.
   * `model` is the balance model recorded on the blueprint.
   *
   * Values for Crescent, Diagonal Flow, Bottom Heavy, Top Cluster, Classic
   * Balanced, Half Ring, Twin Cluster and Side Sweep are read off the ten real
   * blueprints in wreaths-data.js (first focal cluster angle and focal arc).
   * Spiral Flow, Corner Cluster, Wild Asymmetry and Garden Scatter do not appear
   * in that sample; they follow SPEC.ANCHOR's 7-9 o'clock reserved zone
   * (210-270 deg) with the variation their names describe, which TICKET.FLEX
   * explicitly permits.
   */
  var FORMULAS = {
    'Crescent':         { anchor: 225, arc: 92,  echo: 105, model: 'triangular', silence: 2 },
    'Side Sweep':       { anchor: 185, arc: 96,  echo: 20,  model: 'diagonal',   silence: 3 },
    'Bottom Heavy':     { anchor: 190, arc: 100, echo: 25,  model: 'triangular', silence: 2 },
    'Diagonal Flow':    { anchor: 225, arc: 104, echo: 45,  model: 'diagonal',   silence: 1 },
    'Twin Cluster':     { anchor: 180, arc: 76,  echo: 0,   model: 'triangular', silence: 2 },
    'Corner Cluster':   { anchor: 240, arc: 64,  echo: 60,  model: 'diagonal',   silence: 2 },
    'Wild Asymmetry':   { anchor: 232, arc: 118, echo: 40,  model: 'diagonal',   silence: 3 },
    'Half Ring':        { anchor: 135, arc: 168, echo: 315, model: 'triangular', silence: 2 },
    'Top Cluster':      { anchor: 165, arc: 84,  echo: 340, model: 'triangular', silence: 2 },
    'Spiral Flow':      { anchor: 216, arc: 132, echo: 72,  model: 'diagonal',   silence: 2 },
    'Classic Balanced': { anchor: 150, arc: 120, echo: 330, model: 'triangular', silence: 1 },
    'Garden Scatter':   { anchor: 210, arc: 148, echo: 30,  model: 'diagonal',   silence: 1 },
  };

  var TIERS = {
    EDITORIAL: { key: 'Editorial', density: 0.72, sweeps: 3, taper: 0.45 },
    GARDEN:    { key: 'Garden',    density: 1.00, sweeps: 3, taper: 0.35 },
    LUSH:      { key: 'Lush',      density: 1.28, sweeps: 2, taper: 0.25 },
  };

  /* =========================================================================
   * 3. INVENTORY BINDING
   * ========================================================================= */

  var data = { inventory: null };

  /** Resolve an item_id against EC.data.inventory, then window.EverInventory. */
  function inventoryItem(id) {
    if (!id) return null;
    var items = data.inventory && data.inventory.items;
    if (items) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].item_id === id || items[i].id === id) return items[i];
      }
    }
    var ever = (typeof window !== 'undefined' && window.EverInventory) ||
      (typeof globalThis !== 'undefined' && globalThis.EverInventory);
    if (ever) {
      for (var j = 0; j < ever.length; j++) if (ever[j].id === id) return ever[j];
    }
    return null;
  }

  /** Display colour for an item, with a neutral fallback that is never garish. */
  function itemHex(id) {
    var it = inventoryItem(id);
    if (!it) return '#C8C2B6';
    return it.color_hex || it.hex || '#C8C2B6';
  }

  function itemName(id) {
    var it = inventoryItem(id);
    return (it && it.name) || id || '—';
  }

  /** Typical bloom diameter in inches, matching studio.html's own `diaFor`. */
  function itemBloomIn(id) {
    var it = inventoryItem(id);
    if (!it) return 3.6;
    if (it.bloom_diameter_in && typeof it.bloom_diameter_in.typical === 'number') {
      return it.bloom_diameter_in.typical;
    }
    if (typeof it.bloomIn === 'number' && it.bloomIn > 0) return it.bloomIn;
    var w = it.visualWeight;
    return w === 'heavy' ? 5.5 : w === 'light' ? 2.2 : 3.6;
  }

  function itemPrice(id) {
    var it = inventoryItem(id);
    return (it && typeof it.price === 'number') ? it.price : null;
  }

  /* =========================================================================
   * 4. DETERMINISM — seeded RNG
   * ========================================================================= */

  /** FNV-1a over the text, so the same memory always yields the same design. */
  function seedFromText(text) {
    var h = 0x811c9dc5;
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % 1000000000;
  }

  /** mulberry32 — small, fast, and stable across engines. */
  function rngFrom(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Base ring width for a given outer diameter, in inches.
   * Exact fit to the shipped blueprints: 16"→3.0, 18"→3.5, 20"→4.0, and
   * studio.html's own fallback of 4.5 for a 22" form. base = diameter/4 − 1.
   */
  function wgsBaseWidthIn(diameterIn) {
    var d = Number(diameterIn) || 24;
    return Math.round((d / 4 - 1) * 2) / 2;
  }

  /* =========================================================================
   * 5. COMPOSE — spec (content) -> EC_WR_V2 blueprint (geometry)
   *
   * "AI interprets. Geometry places." The caller supplies formula, emotional
   * tags, item ids and quantities; every coordinate below is computed.
   * ========================================================================= */

  var BAND_FOR = { filler: 1, focal: 2, secondary: 2, accent: 3 };
  var RADIUS_FOR = { focal: [0.60, 0.92], secondary: [0.67, 0.85], accent: [0.78, 0.85], filler: [0.67, 0.76] };

  function composeDreamBlueprint(spec, opts) {
    spec = spec || {};
    opts = opts || {};

    var formulaName = FORMULAS[spec.formula] ? spec.formula : 'Crescent';
    var F = FORMULAS[formulaName];
    var tierKey = String(opts.tier || 'GARDEN').toUpperCase();
    var tier = TIERS[tierKey] || TIERS.GARDEN;

    var diameter = Number(opts.diameter_in) || 24;
    var baseWidth = Number(opts.base_width_in) || wgsBaseWidthIn(diameter);
    var depthBands = diameter >= 20 ? 4 : 3;

    var seed = Number.isFinite(spec.seed) ? spec.seed : seedFromText(formulaName + diameter);
    var rand = rngFrom(seed);
    var jitter = function (amount) { return (rand() - 0.5) * 2 * amount; };

    /* -- florals, normalised ------------------------------------------- */
    var florals = (spec.florals || []).filter(function (f) { return f && f.item_id; });
    var byRole = {};
    florals.forEach(function (f) { byRole[f.role || 'filler'] = f; });
    var foliageIds = (spec.foliage || []).filter(Boolean);

    var scale = tier.density;
    function qtyFor(role, fallback) {
      var f = byRole[role];
      var q = f && Number.isFinite(f.qty) ? f.qty : fallback;
      return Math.max(0, Math.round(q * scale));
    }

    /* -- 1. anchor: the focal mass (COMP.L1, SPEC.ANCHOR) ---------------- */
    var clusters = [];
    var clusterN = 0;
    var groupN = 0;

    function placeGroup(role, itemId, count, centerDeg, arcDeg) {
      if (!itemId || count <= 0) return null;
      groupN += 1;
      var gid = 'C' + groupN;
      var band = BAND_FOR[role] || 2;
      var rr = RADIUS_FOR[role] || [0.68, 0.82];
      var start = centerDeg - arcDeg / 2;
      var step = count > 1 ? arcDeg / (count - 1) : 0;

      for (var i = 0; i < count; i++) {
        var t = count > 1 ? i / (count - 1) : 0.5;
        // Radius rises through the mass then settles, so the group reads as a
        // gesture rather than a row of beads on a wire.
        var shaped = rr[0] + (rr[1] - rr[0]) * (0.35 + 0.65 * Math.sin(Math.PI * t));
        clusterN += 1;
        clusters.push({
          type: role,
          band: band,
          group_id: gid,
          radius_norm: Math.round(clamp(shaped + jitter(0.015), rr[0], rr[1]) * 100) / 100,
          stems: [{ item_id: itemId, name: itemName(itemId), qty: 1 }],
          angle_deg: normDeg(start + step * i + jitter(1.2)),
          cluster_id: 'C' + clusterN,
        });
      }
      return { center: normDeg(centerDeg), arc: arcDeg, gid: gid };
    }

    var focalId = byRole.focal && byRole.focal.item_id;
    var focalCount = qtyFor('focal', 7);
    var anchor = placeGroup('focal', focalId, focalCount, F.anchor, F.arc);

    /* -- 2. echo: lighter than the anchor, never its mirror (SPEC.ECHO) -- */
    var secondaryId = byRole.secondary && byRole.secondary.item_id;
    var secondaryCount = qtyFor('secondary', 9);
    // SPEC.DOMINANT: the echo must not rival the anchor. Cap its arc so its
    // angular footprint stays below the anchor's.
    var echoArc = Math.min(F.arc * 0.82, 132);
    var echo = placeGroup('secondary', secondaryId, secondaryCount, F.echo, echoArc);

    /* -- 3. accent: the small bright note, outermost band ---------------- */
    var accentId = byRole.accent && byRole.accent.item_id;
    var accentCount = qtyFor('accent', 3);
    var accentCenter = normDeg(F.anchor + (F.model === 'diagonal' ? 150 : 118));
    var accent = placeGroup('accent', accentId, accentCount, accentCenter, Math.max(28, accentCount * 14));

    /* -- 4. filler: inner band, threading anchor into echo (GRN.L5) ------ */
    var fillerId = byRole.filler && byRole.filler.item_id;
    var fillerCount = qtyFor('filler', 12);
    var fillerCenter = normDeg(F.anchor + signedDelta(F.anchor, F.echo) / 2);
    var filler = placeGroup('filler', fillerId, fillerCount, fillerCenter, Math.max(56, fillerCount * 13));

    /* -- 5. silence arcs: rest, chosen from what the masses left bare ----
     * COMP.L4 / COMP.L5 / SPEC.NEGSPACE. Negative space is not "whatever is
     * left over" — it is selected from the true gaps, widest first, and it is
     * what the foliage sweeps are then told to avoid. */
    function gapsAtPadding(pad) {
      var occupied = [];
      if (anchor) occupied.push(rangeFromCenter(anchor.center, anchor.arc + pad + 8));
      if (echo) occupied.push(rangeFromCenter(echo.center, echo.arc + pad + 6));
      if (accent) occupied.push(rangeFromCenter(accent.center, accent.arc + pad + 4));
      if (filler) occupied.push(rangeFromCenter(filler.center, filler.arc + pad));
      return complementRanges(occupied)
        .filter(function (g) { return g.span >= 14; })
        .sort(function (a, b) { return b.span - a.span; });
    }

    // COMP.L4 "Every journey contains moments of rest" is not conditional: a
    // composition whose masses happen to tile the whole ring still owes the eye
    // somewhere to land. Relax the breathing room around each mass until a real
    // gap appears, and only then fall back to carving one.
    var gaps = [];
    for (var pad = 14; pad >= -10 && !gaps.length; pad -= 6) gaps = gapsAtPadding(pad);

    if (!gaps.length) {
      // Nothing opened up. Reserve the arc opposite the visual weight — the
      // quietest part of the composition — and evict whatever sits inside it,
      // because a declared silence arc that still carries stems is a lie
      // (COMP.L5: negative space is an active design element).
      var provisional = balanceOf(clusters);
      var restCenter = normDeg(provisional.deg + 180);
      var restSpan = 26;
      var rest = rangeFromCenter(restCenter, restSpan);
      clusters = clusters.filter(function (c) { return !angleInRange(c.angle_deg, rest); });
      gaps = [rest];
    }

    var wantSilence = Math.max(1, Math.min(F.silence, gaps.length));
    var silenceRanges = gaps.slice(0, wantSilence).map(function (g) {
      // Trim a little off each end so a sweep can still stitch past the rest.
      var trim = Math.min(8, g.span * 0.12);
      return { start: normDeg(g.start + trim), span: Math.max(14, g.span - trim * 2) };
    });

    var silence_arcs = silenceRanges.map(function (r) {
      return { from_deg: Math.round(r.start), to_deg: Math.round(rangeEnd(r)) };
    });

    /* -- 6. foliage sweeps: architecture first (GRN.L1, GRN.L2, GRN.B02) -
     * The full ring minus the silence arcs, split into readable gestures. */
    var sweepable = subtractArcs({ start: 0, span: 360 }, silenceRanges)
      .filter(function (r) { return r.span >= 20; })
      .sort(function (a, b) { return b.span - a.span; });

    var foliage_sweeps = [];
    var sweepBudget = Math.min(tier.sweeps, Math.max(1, sweepable.length + 1));
    var fi = 0;

    sweepable.forEach(function (r) {
      if (foliage_sweeps.length >= sweepBudget) return;
      var id = foliageIds[fi % Math.max(1, foliageIds.length)] || foliageIds[0];
      if (!id) return;
      fi += 1;
      foliage_sweeps.push({
        sweep_id: 'F' + (foliage_sweeps.length + 1),
        item_id: id,
        arc_from: Math.round(r.start),
        arc_to: Math.round(rangeEnd(r)),
        // Step values observed in the shipped blueprints: 16 / 20 / 24.
        step_deg: [16, 20, 24][foliage_sweeps.length % 3],
        radius_norm: [0.80, 0.76, 0.78][foliage_sweeps.length % 3],
        flow: 'cw',
      });
    });

    // A second species laid over the widest arc, when one was supplied — the
    // layered reading the shipped blueprints show (F1 broad, F2 narrower on top).
    if (foliageIds.length > 1 && sweepable.length && foliage_sweeps.length < 3) {
      var wide = sweepable[0];
      var inset = Math.min(16, wide.span * 0.12);
      foliage_sweeps.push({
        sweep_id: 'F' + (foliage_sweeps.length + 1),
        item_id: foliageIds[1],
        arc_from: Math.round(normDeg(wide.start + inset)),
        arc_to: Math.round(normDeg(rangeEnd(wide) - inset)),
        step_deg: 24,
        radius_norm: 0.76,
        flow: 'cw',
      });
    }

    /* -- 7. balance vector (COMP.BALANCE, SPEC.BALANCE) ------------------ */
    var balance = balanceOf(clusters);

    /* -- 8. ribbon: hardware sits with the anchor (SPEC.HARDWARE) -------- */
    var ribbonHex = focalId ? itemHex(focalId) : '#9C7A86';
    var ribbons = [{
      ribbon_id: 'R1',
      angle_deg: Math.round(anchor ? anchor.center : F.anchor),
      color_hex: ribbonHex,
      color_name: (inventoryItem(focalId) || {}).colorName
        ? String((inventoryItem(focalId) || {}).colorName).toLowerCase() + ' velvet'
        : 'dusty mauve velvet',
      style: 'loose velvet bow',
      tail: tierKey === 'EDITORIAL' ? 'short' : 'long',
    }];

    var blueprint = {
      blueprint_id: 'EC_WR_V2_' + seed,
      blueprint_name: 'Dream Wreath',
      formula: formulaName,
      coverage_tier: tier.key,
      seed: seed,
      emotional_tags: (spec.emotional_tags || []).filter(function (t) {
        return WGS_EMOTIONS.indexOf(t) !== -1;
      }),
      dream_brief: spec.dream_brief || '',
      balance_model: F.model,
      balance_emotion: null,
      atmosphere: spec.atmosphere || null,
      palette_name: spec.palette_name || null,
      negative_space: null,
      accent: { side: F.model === 'diagonal' ? 'both' : 'right' },
      balance_target: { mag: balance.mag, dir_deg: balance.deg, tol: 0.14 },
      canvas: { type: 'polar', diameter_in: diameter, base_width_in: baseWidth, depth_bands: depthBands },
      silence_arcs: silence_arcs,
      foliage_sweeps: foliage_sweeps,
      clusters: clusters,
      ribbons: ribbons,
      balance: { mag: balance.mag, deg: balance.deg },
    };

    return { blueprint: blueprint, formula: F, tier: tier };
  }

  /**
   * Visual-weight centroid of the cluster set, expressed as a polar vector.
   * mag is normalised: 0 is perfectly distributed, 1 is all weight at one angle.
   */
  function balanceOf(clusters) {
    var WEIGHT = { focal: 3.0, secondary: 1.6, accent: 1.0, filler: 0.7 };
    var x = 0, y = 0, total = 0;
    (clusters || []).forEach(function (c) {
      var qty = (c.stems || []).reduce(function (a, s) { return a + (s.qty || 1); }, 0);
      var w = (WEIGHT[c.type] || 1) * qty * (c.radius_norm || 0.75);
      var p = polar(1, c.angle_deg);
      x += p.x * w; y += p.y * w; total += w;
    });
    if (!total) return { mag: 0, deg: 0 };
    x /= total; y /= total;
    var mag = Math.hypot(x, y);
    var deg = normDeg((Math.atan2(x, -y) * 180) / Math.PI);
    return { mag: Math.round(mag * 1000) / 1000, deg: Math.round(deg) };
  }

  /* =========================================================================
   * 6. SCORE — six dimensions, 20 points each, 120 total
   *
   * The shape is fixed by studio.html's renderScoreGate: it reads
   * `overall_grade`, `overall_score`, and `dimension_scores[k] = {label, score,
   * max, issues[]}`, treats `score < 14` as a warning row, and prints the total
   * out of 120.
   * ========================================================================= */

  function scoreBlueprint(bp) {
    bp = bp || {};
    var clusters = bp.clusters || [];
    var sweeps = bp.foliage_sweeps || [];
    var silence = bp.silence_arcs || [];
    var dims = {};

    function dim(key, label, score, issues, rules) {
      dims[key] = {
        label: label,
        score: Math.max(0, Math.min(20, Math.round(score))),
        max: 20,
        issues: issues.filter(Boolean),
        canon: rules || [],
      };
    }

    var byType = {};
    clusters.forEach(function (c) {
      var q = (c.stems || []).reduce(function (a, s) { return a + (s.qty || 1); }, 0);
      byType[c.type] = (byType[c.type] || 0) + q;
    });
    var totalStems = Object.keys(byType).reduce(function (a, k) { return a + byType[k]; }, 0);

    /* --- 1. Focal clarity (COMP.L1, SPEC.DOMINANT) --------------------- */
    var focal = byType.focal || 0;
    var secondary = byType.secondary || 0;
    var i1 = [];
    var s1 = 20;
    if (!focal) { s1 = 4; i1.push('no focal mass — the eye has nowhere to land'); }
    else {
      var ratio = secondary ? focal / secondary : 3;
      if (ratio < 0.55) { s1 -= 7; i1.push('secondary mass rivals the anchor'); }
      else if (ratio < 0.75) { s1 -= 3; i1.push('anchor dominance is narrow'); }
      var focalSpread = angularSpread(clusters.filter(function (c) { return c.type === 'focal'; }));
      if (focalSpread > 150) { s1 -= 5; i1.push('focal mass is spread too wide to read as one anchor'); }
    }
    dim('focal', 'Focal clarity', s1, i1, ['COMP.L1', 'SPEC.DOMINANT']);

    /* --- 2. Balance (COMP.BALANCE, SPEC.BALANCE) ----------------------- */
    var bal = bp.balance || balanceOf(clusters);
    var i2 = [];
    var s2 = 20;
    if (bal.mag > 0.55) { s2 -= 10; i2.push('unresolved half-moon — weight collapses to one side'); }
    else if (bal.mag > 0.42) { s2 -= 5; i2.push('weight leans hard at ' + degToClock(bal.deg)); }
    else if (bal.mag < 0.08) { s2 -= 4; i2.push('near-mirror symmetry — asymmetry is the house language'); }
    dim('balance', 'Balance', s2, i2, ['COMP.BALANCE', 'SPEC.BALANCE']);

    /* --- 3. Negative space (COMP.L4, COMP.L5, SPEC.NEGSPACE) ----------- */
    var silenceTotal = silence.reduce(function (a, s) { return a + normDeg(s.to_deg - s.from_deg); }, 0);
    var i3 = [];
    var s3 = 20;
    if (!silence.length) { s3 = 6; i3.push('no silence arc — every journey needs a moment of rest'); }
    else if (silenceTotal < 20) { s3 -= 8; i3.push('rest is too narrow to read'); }
    else if (silenceTotal > 170) { s3 -= 6; i3.push('over half the ring is bare'); }
    dim('space', 'Negative space', s3, i3, ['COMP.L4', 'COMP.L5', 'SPEC.NEGSPACE']);

    /* --- 4. Greenery architecture (GRN.L1, GRN.L2, GRN.B02) ------------ */
    var i4 = [];
    var s4 = 20;
    if (!sweeps.length) { s4 = 5; i4.push('no greenery architecture — florals have nothing to inhabit'); }
    else {
      var sweepSpan = sweeps.reduce(function (a, f) { return a + normDeg(f.arc_to - f.arc_from); }, 0);
      if (sweepSpan < 120) { s4 -= 6; i4.push('sweeps do not connect the composition'); }
      if (sweeps.length > 4) { s4 -= 4; i4.push('too many sweeps — a hedge, not a gesture'); }
      // A sweep running through a declared silence arc contradicts it.
      var breach = sweeps.some(function (f) {
        return silence.some(function (s) {
          return rangeOverlap(
            { start: f.arc_from, span: normDeg(f.arc_to - f.arc_from) },
            { start: s.from_deg, span: normDeg(s.to_deg - s.from_deg) }
          ) > 8;
        });
      });
      if (breach) { s4 -= 5; i4.push('a sweep runs through a silence arc'); }
    }
    dim('greenery', 'Greenery architecture', s4, i4, ['GRN.L1', 'GRN.L2', 'GRN.B02']);

    /* --- 5. Colour harmony -------------------------------------------- */
    var families = {};
    var ids = {};
    clusters.forEach(function (c) {
      (c.stems || []).forEach(function (s) {
        ids[s.item_id] = 1;
        var it = inventoryItem(s.item_id);
        var fam = (it && (it.colorFamily || it.color_family)) || 'unknown';
        families[fam] = (families[fam] || 0) + (s.qty || 1);
      });
    });
    var famKeys = Object.keys(families).filter(function (k) { return k !== 'unknown'; });
    var i5 = [];
    var s5 = 20;
    if (famKeys.length > 4) { s5 -= 7; i5.push(famKeys.length + ' colour families competing'); }
    else if (famKeys.length === 1 && Object.keys(ids).length > 2) { s5 -= 3; i5.push('single colour family — little tonal movement'); }
    if (Object.keys(ids).length < 2) { s5 -= 5; i5.push('one material only'); }
    dim('color', 'Colour harmony', s5, i5, ['COMP.L10']);

    /* --- 6. Buildability (COMP.L9, GRN.L7) ----------------------------- */
    var dia = (bp.canvas && bp.canvas.diameter_in) || 24;
    // Stems the form can carry before it stops reading as a wreath and starts
    // reading as a hedge: scales with circumference, not diameter.
    var capacity = Math.round((Math.PI * dia) / 1.9);
    var i6 = [];
    var s6 = 20;
    if (!totalStems) { s6 = 0; i6.push('no stems placed'); }
    else if (totalStems > capacity * 1.25) { s6 -= 8; i6.push('over-packed for a ' + dia + '" form (' + totalStems + ' stems vs ~' + capacity + ')'); }
    else if (totalStems < capacity * 0.35) { s6 -= 6; i6.push('too sparse to hold the form (' + totalStems + ' stems vs ~' + capacity + ')'); }
    if (!bp.canvas || !bp.canvas.base_width_in) { s6 -= 3; i6.push('no base width recorded'); }
    dim('build', 'Buildability', s6, i6, ['COMP.L9', 'GRN.L7']);

    var overall = Object.keys(dims).reduce(function (a, k) { return a + dims[k].score; }, 0);
    var pct = overall / 120;
    var grade = pct >= 0.9 ? 'A' : pct >= 0.8 ? 'B' : pct >= 0.7 ? 'C' : pct >= 0.6 ? 'D' : 'F';

    return {
      overall_score: overall,
      overall_max: 120,
      overall_grade: grade,
      dimension_scores: dims,
      total_stems: totalStems,
    };
  }

  /** Angular spread of a cluster group, in degrees. */
  function angularSpread(clusters) {
    if (!clusters || clusters.length < 2) return 0;
    var angles = clusters.map(function (c) { return normDeg(c.angle_deg); }).sort(function (a, b) { return a - b; });
    var biggestGap = normDeg(angles[0] - angles[angles.length - 1]);
    for (var i = 1; i < angles.length; i++) {
      biggestGap = Math.max(biggestGap, angles[i] - angles[i - 1]);
    }
    return 360 - biggestGap;
  }

  /* =========================================================================
   * 7. CONSTRUCTION GUIDE
   * ========================================================================= */

  function buildConstructionGuide(bp) {
    bp = bp || {};
    var lines = {};
    var order = [];

    function tally(id, qty, role) {
      if (!id) return;
      if (!lines[id]) { lines[id] = { item_id: id, name: itemName(id), role: role, placed: 0 }; order.push(id); }
      lines[id].placed += qty;
    }

    (bp.clusters || []).forEach(function (c) {
      (c.stems || []).forEach(function (s) { tally(s.item_id, s.qty || 1, c.type); });
    });

    // A sweep is a run of stems set every `step_deg` along its arc.
    (bp.foliage_sweeps || []).forEach(function (f) {
      var span = normDeg(f.arc_to - f.arc_from) || 360;
      var step = f.step_deg || 20;
      tally(f.item_id, Math.max(1, Math.round(span / step)), 'foliage');
    });

    var totalPlaced = 0;
    var totalPurchase = 0;
    var materials = order.map(function (id) {
      var l = lines[id];
      // Buy 15% over placed count, minimum one spare — stems break on the wire.
      var purchase = Math.max(l.placed + 1, Math.ceil(l.placed * 1.15));
      var unit = itemPrice(id);
      totalPlaced += l.placed;
      totalPurchase += purchase;
      return {
        item_id: id, name: l.name, role: l.role,
        placed: l.placed, purchase: purchase,
        unit_price: unit,
        line_cost: unit == null ? null : Math.round(unit * purchase * 100) / 100,
      };
    });

    var known = materials.filter(function (m) { return m.line_cost != null; });
    var materialCost = known.reduce(function (a, m) { return a + m.line_cost; }, 0);

    var dia = (bp.canvas && bp.canvas.diameter_in) || 24;
    var steps = [
      'Mount the ' + dia + '" grapevine base and mark ' +
        ((bp.silence_arcs || []).map(function (s) { return degToClock(s.from_deg) + '–' + degToClock(s.to_deg); }).join(', ') || 'no') +
        ' as reserved bare arc. Nothing goes there.',
      'Lay the greenery architecture first — ' + (bp.foliage_sweeps || []).length +
        ' sweep' + ((bp.foliage_sweeps || []).length === 1 ? '' : 's') +
        ', thin and readable, never a hedge (EC-GRN-001 GRN-B02).',
      'Set the focal mass at ' + (anchorClock(bp) || '—') + ' and let it stay the dominant weight.',
      'Add the secondary echo, then the accent note. The echo supports; it never mirrors.',
      'Thread filler last, only where the eye needs a bridge between masses.',
      'Tie the bow at ' + ((bp.ribbons || [])[0] ? degToClock(bp.ribbons[0].angle_deg) : '—') + ' and re-check the bare arc is still bare.',
    ];

    return {
      total_purchase: totalPurchase,
      total_placed: totalPlaced,
      materials: materials,
      material_cost: Math.round(materialCost * 100) / 100,
      material_cost_known: known.length === materials.length,
      steps: steps,
      base: dia + '" exposed grapevine',
    };
  }

  function anchorClock(bp) {
    var focal = (bp.clusters || []).filter(function (c) { return c.type === 'focal'; });
    if (!focal.length) return null;
    return degToClock(focal[Math.floor(focal.length / 2)].angle_deg);
  }

  /* =========================================================================
   * 8. COMMERCE LISTING
   * ========================================================================= */

  function commerceListing(bp, opts) {
    bp = bp || {};
    opts = opts || {};
    var guide = buildConstructionGuide(bp);
    var score = scoreBlueprint(bp);
    var dia = (bp.canvas && bp.canvas.diameter_in) || 24;

    /* Price: a cost-plus ESTIMATE — materials, bench time, form and packaging,
     * times the house margin. Rounded to the nearest $5.
     *
     * CALIBRATION. The rates below are fitted to the ten shipped catalog
     * designs, whose real prices run $285–$425 (see tools/calibration.md). An
     * earlier model priced the same ten at $825–$1455, roughly 3.4x high,
     * because it costed every stem at the canon's per-SKU price — those are
     * pack prices, not per-stem wholesale, and the catalog's real prices are
     * not derived from them. STEM_RATE is a blended per-stem wholesale figure
     * instead. This model reproduces the ten at $260–$430.
     *
     * This is an estimate, not the sticker. A design's actual price is an
     * editorial decision the owner sets in the admin console — across the ten
     * real designs, price barely tracks stem count at all (a 51-stem
     * Remembrance piece lists higher than a 67-stem Comfort one). Callers
     * should treat `price_estimate` as the cost floor to price against.
     */
    var STEM_RATE = 2.10;        // blended faux-stem wholesale, per stem
    var BENCH_RATE = 38;         // per bench hour
    var MARGIN = 1.5;

    var materialCost = guide.total_placed * STEM_RATE;
    var benchHours = 0.6 + guide.total_placed * 0.02;
    var labour = benchHours * BENCH_RATE;
    var base = 18 + dia * 1.1;                    // form, wire, ribbon, packaging
    var raw = (materialCost + labour + base) * MARGIN;
    var price = Math.max(120, Math.round(raw / 5) * 5);

    var focal = (bp.clusters || []).filter(function (c) { return c.type === 'focal'; })[0];
    var focalName = focal ? itemName(focal.stems[0].item_id) : 'a single anchor bloom';
    var species = [];
    (bp.clusters || []).forEach(function (c) {
      (c.stems || []).forEach(function (s) {
        var n = itemName(s.item_id);
        if (species.indexOf(n) === -1) species.push(n);
      });
    });
    (bp.foliage_sweeps || []).forEach(function (f) {
      var n = itemName(f.item_id);
      if (species.indexOf(n) === -1) species.push(n);
    });

    var sa = (bp.silence_arcs || [])[0];
    var silenceLine = sa
      ? 'The bare grapevine between ' + degToClock(sa.from_deg) + ' and ' + degToClock(sa.to_deg) +
        ' is part of the design, not an accident — negative space is an active element here.'
      : 'Every arc of the form carries material; the rest is held in the depth of the layering rather than in bare grapevine.';

    var tags = []
      .concat(bp.emotional_tags || [])
      .concat([String(bp.formula || '').toLowerCase().replace(/\s+/g, '-')])
      .concat([String(bp.coverage_tier || '').toLowerCase()])
      .concat([dia + '-inch', 'faux-botanical', 'wreath'])
      .filter(Boolean);

    var title = (bp.blueprint_name && bp.blueprint_name !== 'Dream Wreath' ? bp.blueprint_name + ' — ' : '') +
      dia + '" ' + (bp.formula || 'Crescent') + ' wreath';

    return {
      title: title,
      price_estimate: price,
      price_breakdown: {
        materials: Math.round(materialCost * 100) / 100,
        labour: Math.round(labour * 100) / 100,
        base: Math.round(base * 100) / 100,
        margin_multiplier: MARGIN,
        stem_rate: STEM_RATE,
        estimated: true,
      },
      description: [
        'Built 1:1 to its scored blueprint — a ' + dia + '" exposed grapevine base, ' +
          (bp.formula || 'Crescent').toLowerCase() + ' composition, ' + guide.total_placed +
          ' stems set to the degree, anchored on ' + focalName.toLowerCase() + '.',
        silenceLine,
        'Grade ' + score.overall_grade + ' · ' + score.overall_score + '/120 on the Evercrafted composition gate. ' +
          'Materials: ' + species.slice(0, 6).join(', ') + (species.length > 6 ? ', and more.' : '.'),
      ],
      tags: tags,
      species: species,
      grade: score.overall_grade,
      score: score.overall_score,
      stems: guide.total_placed,
    };
  }

  /* =========================================================================
   * 9. EDITORIAL PROMPT — Midjourney v7
   *
   * Rules carried over from moodoor-studio-src/README.md's render engine notes:
   * v7 syntax only (no `::`, no `--q`); dominance by word order with the focal
   * named first; named colours locked; negatives cleaned so a material the piece
   * actually uses is never suppressed.
   * ========================================================================= */

  function editorialPrompt(bp) {
    bp = bp || {};
    var dia = (bp.canvas && bp.canvas.diameter_in) || 24;
    var clusters = bp.clusters || [];

    function group(type) {
      var of = clusters.filter(function (c) { return c.type === type; });
      if (!of.length) return null;
      var id = of[0].stems[0].item_id;
      var qty = of.reduce(function (a, c) {
        return a + c.stems.reduce(function (x, s) { return x + (s.qty || 1); }, 0);
      }, 0);
      var it = inventoryItem(id);
      return {
        name: (it && (it.mjSpecies || it.name)) || itemName(id),
        color: (it && it.colorName) ? String(it.colorName).toLowerCase() : null,
        qty: qty % 2 === 0 ? qty + 1 : qty,     // odd stem counts only
        deg: of[Math.floor(of.length / 2)].angle_deg,
      };
    }

    var focal = group('focal'), secondary = group('secondary'),
        accent = group('accent'), filler = group('filler');

    var foliageNames = [];
    (bp.foliage_sweeps || []).forEach(function (f) {
      var it = inventoryItem(f.item_id);
      var n = (it && (it.mjSpecies || it.name)) || itemName(f.item_id);
      if (foliageNames.indexOf(n) === -1) foliageNames.push(n);
    });

    function phrase(g) {
      if (!g) return null;
      return g.qty + ' ' + (g.color ? g.color + ' ' : '') + g.name +
        ' clustered at ' + degToClock(g.deg);
    }

    var parts = [];
    parts.push('editorial product photograph of a ' + dia + ' inch faux botanical wreath on an exposed grapevine base');
    if (focal) parts.push(phrase(focal) + ' as the single dominant focal mass');
    if (secondary) parts.push(phrase(secondary) + ' echoing lighter');
    if (accent) parts.push(phrase(accent) + ' as the accent note');
    if (filler) parts.push(phrase(filler) + ' threaded as filler');
    if (foliageNames.length) parts.push(foliageNames.join(' and ') + ' sweeping around the form as the greenery architecture');

    var sa = (bp.silence_arcs || [])[0];
    if (sa) parts.push('bare grapevine deliberately preserved from ' + degToClock(sa.from_deg) + ' to ' + degToClock(sa.to_deg));

    parts.push((bp.formula || 'Crescent').toLowerCase() + ' composition, asymmetric, ' +
      String(bp.coverage_tier || 'Garden').toLowerCase() + ' coverage');
    parts.push('soft directional north light, shallow depth of field, hung flat against a warm plaster wall');
    parts.push('matte silk-petal texture, visible wired stems, no plastic sheen');

    /* Negatives, cleaned per piece: never suppress a material the wreath uses. */
    var materialWords = [];
    [focal, secondary, accent, filler].forEach(function (g) { if (g) materialWords.push(g.name); });
    foliageNames.forEach(function (n) { materialWords.push(n); });
    var haystack = materialWords.join(' ').toLowerCase();

    var negatives = ['bouquet', 'vase', 'text', 'watermark', 'plastic shine', 'craft store',
      'mirror symmetry', 'centered blob', 'dried flowers', 'ivy', 'baby breath']
      .filter(function (n) { return haystack.indexOf(n) === -1; });

    var ow = Math.min(100, 40 + Math.round((bp.clusters || []).length * 1.2));

    return parts.join(', ') + ' --style raw --v 7 --ow ' + ow + ' --ar 1:1 --no ' + negatives.join(', ');
  }

  /* =========================================================================
   * 10. generateOmniSVG — the blueprint diagram
   *
   * This is what the Studio's blueprint stage and the product page hero render.
   * Drawn in inches, scaled by the viewBox, so a 16" and a 24" form are drawn to
   * the same page size but keep their true internal proportions.
   * ========================================================================= */

  function generateOmniSVG(bp, opts) {
    bp = bp || {};
    opts = opts || {};
    var dia = (bp.canvas && bp.canvas.diameter_in) || 24;
    var baseWidth = (bp.canvas && bp.canvas.base_width_in) || wgsBaseWidthIn(dia);

    var SIZE = 560;
    var cx = SIZE / 2, cy = SIZE / 2;
    var margin = 46;
    // Inches -> user units. The bloom heads overhang the ring, hence the margin.
    var scale = (SIZE / 2 - margin) / (dia / 2);

    var rOuter = (dia / 2) * scale;
    var rInner = rOuter - baseWidth * scale;
    var rMid = (rOuter + rInner) / 2;

    var uid = 'ec' + (bp.seed || 0);
    var out = [];

    out.push('<svg viewBox="0 0 ' + SIZE + ' ' + SIZE + '" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="Polar blueprint of a ' + dia + ' inch ' + (bp.formula || '') + ' wreath" ' +
      'style="width:100%;height:auto;display:block">');

    out.push('<defs>' +
      '<radialGradient id="' + uid + 'paper" cx="50%" cy="42%" r="72%">' +
        '<stop offset="0%" stop-color="#FDFCFA"/><stop offset="100%" stop-color="#F2EFE9"/>' +
      '</radialGradient>' +
      '<filter id="' + uid + 'soft" x="-30%" y="-30%" width="160%" height="160%">' +
        '<feGaussianBlur stdDeviation="2.4"/>' +
      '</filter>' +
      '<filter id="' + uid + 'lift" x="-40%" y="-40%" width="180%" height="180%">' +
        '<feDropShadow dx="0" dy="1.6" stdDeviation="2.2" flood-color="#1A1A1A" flood-opacity="0.16"/>' +
      '</filter>' +
    '</defs>');

    out.push('<rect width="' + SIZE + '" height="' + SIZE + '" fill="url(#' + uid + 'paper)"/>');

    /* --- clock ticks --------------------------------------------------- */
    var ticks = [];
    for (var h = 0; h < 12; h++) {
      var deg = h * 30;
      var a = polar(rOuter + 12, deg, cx, cy);
      var b = polar(rOuter + (h % 3 === 0 ? 24 : 18), deg, cx, cy);
      ticks.push('<line x1="' + fmt(a.x) + '" y1="' + fmt(a.y) + '" x2="' + fmt(b.x) + '" y2="' + fmt(b.y) +
        '" stroke="#C9C2B4" stroke-width="' + (h % 3 === 0 ? 1.4 : 0.8) + '"/>');
      if (h % 3 === 0) {
        var t = polar(rOuter + 36, deg, cx, cy);
        ticks.push('<text x="' + fmt(t.x) + '" y="' + fmt(t.y + 4) + '" text-anchor="middle" ' +
          'font-family="DM Mono, ui-monospace, monospace" font-size="11" fill="#A49B8C">' +
          (h === 0 ? 12 : h) + '</text>');
      }
    }
    out.push('<g>' + ticks.join('') + '</g>');

    /* --- grapevine base ------------------------------------------------ */
    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + fmt(rMid) + '" fill="none" ' +
      'stroke="#B9A489" stroke-width="' + fmt(baseWidth * scale) + '" opacity="0.30"/>');
    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + fmt(rOuter) + '" fill="none" stroke="#A8916F" stroke-width="1.1" opacity="0.55"/>');
    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + fmt(rInner) + '" fill="none" stroke="#A8916F" stroke-width="1.1" opacity="0.55"/>');
    // Grapevine weave: a dashed twist reading as bound vine, not a plain ring.
    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + fmt(rMid) + '" fill="none" stroke="#967F5E" ' +
      'stroke-width="0.9" opacity="0.42" stroke-dasharray="14 6 8 7" stroke-linecap="round"/>');

    /* --- silence arcs: drawn as absence, marked at the edge ------------- */
    (bp.silence_arcs || []).forEach(function (s) {
      var span = normDeg(s.to_deg - s.from_deg) || 0;
      if (span <= 0) return;
      var r = { start: s.from_deg, span: span };
      out.push('<path d="' + annulusSectorPath(rInner - 1, rOuter + 1, r, cx, cy) + '" fill="#FBFAF7" opacity="0.92"/>');
      out.push('<path d="' + annulusSectorPath(rOuter + 5, rOuter + 8, r, cx, cy) + '" fill="#C4922A" opacity="0.55"/>');
      var mid = polar(rInner - 20, normDeg(s.from_deg + span / 2), cx, cy);
      out.push('<text x="' + fmt(mid.x) + '" y="' + fmt(mid.y) + '" text-anchor="middle" ' +
        'font-family="DM Mono, ui-monospace, monospace" font-size="9.5" fill="#B8912F" opacity="0.9">rest</text>');
    });

    /* --- foliage sweeps: architecture, drawn under the blooms ---------- */
    (bp.foliage_sweeps || []).forEach(function (f, idx) {
      var span = normDeg(f.arc_to - f.arc_from) || 0;
      if (span <= 0) return;
      var hex = itemHex(f.item_id);
      var d = sweepRibbonPath({
        startDeg: f.arc_from,
        arcDeg: span,
        rInner: rInner,
        rOuter: rOuter,
        radialPosition: (f.radius_norm != null ? f.radius_norm : 0.78),
        curvature: idx % 2 === 0 ? 0.22 : -0.18,
        thickness: (rOuter - rInner) * (idx === 0 ? 0.62 : 0.44),
        taper: 0.4,
      }, cx, cy);
      out.push('<path d="' + d + '" fill="' + hex + '" opacity="' + (idx === 0 ? 0.42 : 0.32) + '" filter="url(#' + uid + 'soft)"/>');
      out.push('<path d="' + d + '" fill="none" stroke="' + hex + '" stroke-width="0.7" opacity="0.5"/>');

      // Individual stem ticks along the sweep, at the recorded step.
      var step = f.step_deg || 20;
      var marks = [];
      for (var a2 = 0; a2 <= span; a2 += step) {
        var rr = rInner + (rOuter - rInner) * (f.radius_norm != null ? f.radius_norm : 0.78);
        var p1 = polar(rr - 5, f.arc_from + a2, cx, cy);
        var p2 = polar(rr + 5, f.arc_from + a2, cx, cy);
        marks.push('<line x1="' + fmt(p1.x) + '" y1="' + fmt(p1.y) + '" x2="' + fmt(p2.x) + '" y2="' + fmt(p2.y) + '"/>');
      }
      out.push('<g stroke="' + hex + '" stroke-width="0.85" opacity="0.55" stroke-linecap="round">' + marks.join('') + '</g>');
    });

    /* --- clusters: blooms, drawn largest first so small ones stay visible */
    var drawOrder = { filler: 0, accent: 1, secondary: 2, focal: 3 };
    var sorted = (bp.clusters || []).slice().sort(function (a, b) {
      return (drawOrder[a.type] || 0) - (drawOrder[b.type] || 0);
    });

    sorted.forEach(function (c) {
      var id = (c.stems && c.stems[0] && c.stems[0].item_id) || null;
      var hex = itemHex(id);
      var bloom = itemBloomIn(id);
      // A bloom is drawn at its true size, floored so a 1" berry is still a mark.
      var r = Math.max(4.5, (bloom / 2) * scale * 0.82);
      var rr = rInner + (rOuter - rInner) * (c.radius_norm != null ? c.radius_norm : 0.75);
      var p = polar(rr, c.angle_deg, cx, cy);

      if (c.type === 'focal' || c.type === 'secondary') {
        // Petalled head: a ring of soft lobes, then a centre.
        var petals = [];
        var n = c.type === 'focal' ? 8 : 6;
        for (var k = 0; k < n; k++) {
          var pd = (k / n) * 360;
          var pp = polar(r * 0.52, pd, p.x, p.y);
          petals.push('<circle cx="' + fmt(pp.x) + '" cy="' + fmt(pp.y) + '" r="' + fmt(r * 0.55) + '"/>');
        }
        out.push('<g fill="' + hex + '" opacity="0.9" filter="url(#' + uid + 'lift)">' + petals.join('') + '</g>');
        out.push('<circle cx="' + fmt(p.x) + '" cy="' + fmt(p.y) + '" r="' + fmt(r * 0.42) + '" fill="' + hex + '"/>');
        out.push('<circle cx="' + fmt(p.x) + '" cy="' + fmt(p.y) + '" r="' + fmt(r * 0.2) + '" fill="#FBF8F1" opacity="0.72"/>');
      } else if (c.type === 'accent') {
        // Berry cluster: three small beads.
        var beads = [];
        for (var m = 0; m < 3; m++) {
          var bp2 = polar(r * 0.42, m * 120 + 20, p.x, p.y);
          beads.push('<circle cx="' + fmt(bp2.x) + '" cy="' + fmt(bp2.y) + '" r="' + fmt(r * 0.46) + '"/>');
        }
        out.push('<g fill="' + hex + '" opacity="0.95">' + beads.join('') + '</g>');
      } else {
        out.push('<circle cx="' + fmt(p.x) + '" cy="' + fmt(p.y) + '" r="' + fmt(r * 0.7) + '" fill="' + hex + '" opacity="0.7"/>');
      }
    });

    /* --- balance vector ------------------------------------------------ */
    var bal = bp.balance || balanceOf(bp.clusters || []);
    if (bal && bal.mag > 0.02) {
      var tip = polar(rInner * 0.74 * Math.min(1, bal.mag / 0.5), bal.deg, cx, cy);
      out.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + fmt(tip.x) + '" y2="' + fmt(tip.y) +
        '" stroke="#4A6741" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.55"/>');
      out.push('<circle cx="' + fmt(tip.x) + '" cy="' + fmt(tip.y) + '" r="3" fill="#4A6741" opacity="0.7"/>');
      out.push('<circle cx="' + cx + '" cy="' + cy + '" r="2.4" fill="none" stroke="#4A6741" stroke-width="1" opacity="0.5"/>');
    }

    /* --- ribbon -------------------------------------------------------- */
    (bp.ribbons || []).forEach(function (rb) {
      var p = polar(rOuter + 2, rb.angle_deg, cx, cy);
      var hex = rb.color_hex || '#9C7A86';
      var tail = polar(rOuter + (rb.tail === 'long' ? 34 : 22), rb.angle_deg, cx, cy);
      out.push('<line x1="' + fmt(p.x) + '" y1="' + fmt(p.y) + '" x2="' + fmt(tail.x) + '" y2="' + fmt(tail.y) +
        '" stroke="' + hex + '" stroke-width="2.6" opacity="0.65" stroke-linecap="round"/>');
      var l1 = polar(9, rb.angle_deg - 90, p.x, p.y);
      var l2 = polar(9, rb.angle_deg + 90, p.x, p.y);
      out.push('<g fill="' + hex + '" opacity="0.85">' +
        '<ellipse cx="' + fmt(l1.x) + '" cy="' + fmt(l1.y) + '" rx="8" ry="5.4" transform="rotate(' + fmt(rb.angle_deg) + ' ' + fmt(l1.x) + ' ' + fmt(l1.y) + ')"/>' +
        '<ellipse cx="' + fmt(l2.x) + '" cy="' + fmt(l2.y) + '" rx="8" ry="5.4" transform="rotate(' + fmt(rb.angle_deg) + ' ' + fmt(l2.x) + ' ' + fmt(l2.y) + ')"/>' +
        '<circle cx="' + fmt(p.x) + '" cy="' + fmt(p.y) + '" r="3.4"/></g>');
    });

    /* --- caption ------------------------------------------------------- */
    if (opts.caption !== false) {
      out.push('<text x="' + cx + '" y="' + (SIZE - 14) + '" text-anchor="middle" ' +
        'font-family="DM Mono, ui-monospace, monospace" font-size="10.5" fill="#A49B8C" letter-spacing="0.08em">' +
        escapeXml((bp.formula || 'Composition') + ' · ' + dia + '" · ' + (bp.coverage_tier || '') +
          ' · ' + (bp.blueprint_id || '')) + '</text>');
    }

    out.push('</svg>');
    return out.join('');
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* =========================================================================
   * 11. EXPORT
   * ========================================================================= */

  var EC = {
    version: '2.0.0',
    data: data,

    /* inventory */
    inventoryItem: inventoryItem,
    itemHex: itemHex,
    itemName: itemName,
    itemBloomIn: itemBloomIn,

    /* determinism */
    seedFromText: seedFromText,
    rngFrom: rngFrom,
    wgsBaseWidthIn: wgsBaseWidthIn,

    /* canon */
    WGS_EMOTIONS: WGS_EMOTIONS,
    FORMULAS: FORMULAS,
    TIERS: TIERS,
    CANON: CANON,

    /* pipeline */
    composeDreamBlueprint: composeDreamBlueprint,
    scoreBlueprint: scoreBlueprint,
    buildConstructionGuide: buildConstructionGuide,
    commerceListing: commerceListing,
    editorialPrompt: editorialPrompt,
    generateOmniSVG: generateOmniSVG,
    balanceOf: balanceOf,

    /* geometry (also exposed flat, as the call sites use them) */
    geometry: Geometry,
    degToClock: degToClock,
    degToClockNum: degToClockNum,
    normDeg: normDeg,
    polar: polar,
  };

  return EC;
});
