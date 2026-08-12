/**
 * patch-pages.mjs — the storefront edits, applied deterministically.
 *
 * The pages arrived as standalone HTML files with no shared layer. Rather than
 * hand-editing ten files (and diverging them further), every change is scripted
 * and idempotent, so it can be re-run against a fresh copy of the archive.
 *
 * Changes:
 *   1. load moodoor-runtime.js on every page (supplies window.claude + hydration)
 *   2. wrap each page's card list in a [data-hydrate] container
 *   3. give every page the same navigation — "Drops" was missing from five of
 *      eight, and nothing linked to the Studio or the Reveal at all
 *   4. repoint links that pointed at files not in this build
 *   5. add the run-state hook to the catalog grid
 *
 * Run: node tools/patch-pages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');

const STOREFRONT = [
  'index.html', 'signature-wreaths.html', 'collection-bundles.html',
  'digital-blueprints.html', 'how-matching-works.html', 'territories.html',
  'upcoming-drops.html', 'checkout.html', 'moodoor-product-page.html',
];

const changes = [];
const note = (file, what) => changes.push(`${file}: ${what}`);

function edit(file, fn) {
  const p = path.join(PUB, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before, file);
  if (after !== before) fs.writeFileSync(p, after);
  return after !== before;
}

/* ------------------------------------------------------------------ *
 * 1. runtime script on every page
 * ------------------------------------------------------------------ */
const RUNTIME_TAG = '<script src="moodoor-runtime.js" defer></script>';

for (const file of STOREFRONT.concat(['studio.html'])) {
  edit(file, (html) => {
    if (html.includes('moodoor-runtime.js')) return html;
    note(file, 'load moodoor-runtime.js');
    // studio.html needs window.claude before its own inline script runs, so it
    // goes in <head>; everywhere else it may defer to the end of <body>.
    if (file === 'studio.html') {
      return html.replace('</head>', `${RUNTIME_TAG}\n</head>`);
    }
    return html.replace('</body>', `${RUNTIME_TAG}\n</body>`);
  });
}

/* ------------------------------------------------------------------ *
 * 2. hydration containers
 * ------------------------------------------------------------------ */

/** Wrap the span from the first to the last <article class="cls"> in a div. */
function wrapArticles(html, cls, kind) {
  if (html.includes(`data-hydrate="${kind}"`)) return html;
  const open = new RegExp(`<article class="${cls}[^"]*"`, 'g');
  const first = open.exec(html);
  if (!first) return html;
  let last = first, m;
  while ((m = open.exec(html))) last = m;

  // Find the </article> that closes the last one.
  const closeIdx = html.indexOf('</article>', last.index);
  if (closeIdx < 0) return html;
  const end = closeIdx + '</article>'.length;

  return html.slice(0, first.index) +
    `<div data-hydrate="${kind}">\n  ` +
    html.slice(first.index, end) +
    `\n</div>` +
    html.slice(end);
}

edit('collection-bundles.html', (h) => {
  const out = wrapArticles(h, 'bundle', 'bundles');
  if (out !== h) note('collection-bundles.html', 'bundles list is now admin-driven');
  return out;
});
edit('territories.html', (h) => {
  const out = wrapArticles(h, 'terr', 'territories');
  if (out !== h) note('territories.html', 'territories list is now admin-driven');
  return out;
});
edit('upcoming-drops.html', (h) => {
  const out = wrapArticles(h, 'drop', 'drops');
  if (out !== h) note('upcoming-drops.html', 'drops list is now admin-driven');
  return out;
});

/* ------------------------------------------------------------------ *
 * 3. one navigation everywhere
 *
 * Every page ships the same <ul class="nav-links"> shape. Five of eight were
 * missing Drops; none linked the Studio. Rewriting the list keeps each page's
 * own CSS and its `nav-cta` styling untouched.
 * ------------------------------------------------------------------ */

const NAV_ITEMS = [
  ['signature-wreaths.html', 'Wreaths'],
  ['digital-blueprints.html', 'Blueprints'],
  ['collection-bundles.html', 'Bundles'],
  ['territories.html', 'Territories'],
  ['upcoming-drops.html', 'Drops'],
  ['how-matching-works.html', 'How it works'],
];

for (const file of STOREFRONT) {
  edit(file, (html) => {
    const re = /<ul class="nav-links">[\s\S]*?<\/ul>/;
    const current = html.match(re);
    if (!current) return html;

    // Preserve whatever call-to-action the page already ends its nav with.
    const cta = current[0].match(/<li><a class="nav-cta"[\s\S]*?<\/a><\/li>/);
    const items = NAV_ITEMS.map(([href, label]) => {
      const active = href === file ? ' class="is-current" aria-current="page"' : '';
      return `      <li><a href="${href}"${active}>${label}</a></li>`;
    }).join('\n');

    const rebuilt = '<ul class="nav-links">\n' + items + '\n' +
      (cta ? '      ' + cta[0] + '\n' : '') + '    </ul>';

    if (rebuilt === current[0]) return html;
    note(file, 'navigation unified' + (current[0].includes('upcoming-drops') ? '' : ' (Drops link added)'));
    return html.replace(re, rebuilt);
  });
}

/* ------------------------------------------------------------------ *
 * 4. links that pointed at files not in this build
 * ------------------------------------------------------------------ */

edit('checkout.html', (h) => {
  if (!h.includes('moodoor-launch-site.html')) return h;
  note('checkout.html', 'moodoor-launch-site.html -> index.html (same page, one canonical name)');
  return h.replace(/moodoor-launch-site\.html/g, 'index.html');
});

// The three bundle CTAs all pointed at the product page with no ?w=, so every
// one of them landed on September Porch. Point each at its own lead design.
edit('collection-bundles.html', (h) => {
  const LEAD = {
    'Autumn Memories': 'september-porch',
    'Gathered Grace': 'gathered-grace',
    'Legacy Garden': 'legacy-garden',
  };
  let out = h;
  let changed = false;
  for (const [name, slug] of Object.entries(LEAD)) {
    const re = new RegExp(
      `(<h2>${name}</h2>[\\s\\S]*?class="b-cta" href=")moodoor-product-page\\.html(")`,
    );
    if (re.test(out)) { out = out.replace(re, `$1moodoor-product-page.html?w=${slug}$2`); changed = true; }
  }
  if (changed) note('collection-bundles.html', 'each bundle CTA now opens its own lead design');
  return out;
});

/**
 * digital-blueprints.html carried the same bare product link on all thirteen of
 * its cards.
 *
 * An earlier revision of this script pointed every one of them at
 * `?w=september-porch`, which was worse than leaving them bare: clicking
 * "Legacy Garden" silently showed a different wreath. Each card now links to
 * its own design, matched on the card's own <h3>.
 *
 * Three of the thirteen — Kept Letters, Last Bonfire, Sunday Bread — have no
 * entry in the catalog at all. That is not an error: the page says the library
 * holds far more designs than are available finished, so these are
 * blueprint-only. They link to the catalog rather than to a product page that
 * would show somebody else's wreath.
 */
edit('digital-blueprints.html', (h) => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed.json'), 'utf8'))
    .products.reduce((map, p) => ((map[p.name.replace(/&/g, '&amp;')] = p.slug), map), {});

  let out = h;
  let mapped = 0;
  let blueprintOnly = [];

  // Each card is <a class="bp-card" … href="…"> … <h3>Name</h3>
  out = out.replace(
    /(<a class="bp-card[^"]*"[^>]*?href=")([^"]*)("[^>]*>[\s\S]*?<h3>([^<]+)<\/h3>)/g,
    (full, before, href, after, name) => {
      const slug = catalog[name.trim()];
      const target = slug ? `moodoor-product-page.html?w=${slug}` : 'signature-wreaths.html';
      if (slug) mapped += 1; else blueprintOnly.push(name.trim());
      return before + target + after;
    }
  );

  if (out !== h) {
    note('digital-blueprints.html',
      `${mapped} blueprint cards link to their own design; ` +
      `${blueprintOnly.length} with no finished product (${blueprintOnly.join(', ')}) link to the catalog`);
  }
  return out;
});

/* ------------------------------------------------------------------ *
 * 4b. the product page must not overwrite a curated price
 *
 * The page recomputed `w.price` from the engine's commerceListing on the
 * grounds that a live figure beats hand-typed copy. That holds for the stem
 * count and the grade, but not for price: across the ten shipped designs the
 * real price barely tracks stem count — a 51-stem Remembrance piece lists at
 * $425 while a 67-stem Comfort one lists at $315. Price is an editorial
 * decision, and it is now an admin-editable field. The engine's number is kept
 * as a cost estimate rather than shown as the sticker.
 * ------------------------------------------------------------------ */

edit('moodoor-product-page.html', (h) => {
  const OLD = 'w.price = _listing.price_estimate;';
  // The replacement text legitimately contains OLD as a substring, so the
  // guard checks for the marker the replacement introduces, not for OLD.
  if (h.includes('_estimatedPrice') || !h.includes(OLD)) return h;
  note('moodoor-product-page.html', 'curated price kept; engine figure becomes a cost estimate');
  return h.replace(OLD,
    '/* The listed price is editorial and owner-set; the engine supplies the\n' +
    '         cost floor beside it, not the sticker. */\n' +
    '      w._estimatedPrice = _listing.price_estimate;\n' +
    '      if (w.price == null) w.price = _listing.price_estimate;');
});

// cart.js builds the empty-cart message in JavaScript and links to
// moodoor-launch-site.html, which is not a page in this build. Only the
// rendered-DOM pass catches this one — it does not exist in any HTML file.
edit('cart.js', (h) => {
  if (!h.includes('moodoor-launch-site.html')) return h;
  note('cart.js', 'empty-cart link pointed at a page that is not in this build');
  return h.replace(/moodoor-launch-site\.html/g, 'index.html');
});

/* ------------------------------------------------------------------ *
 * 4c. the Studio's geometry-only path
 *
 * The Studio's only route to a blueprint was `window.claude.complete()`, so with
 * no ANTHROPIC_API_KEY the whole page did nothing. But the AI never places
 * anything — the page's own comment says so: "AI interprets, geometry decides.
 * EC.composeDreamBlueprint owns every coordinate." The model picks content
 * (formula, florals, density, tags); the engine does the rest, and the engine is
 * entirely local.
 *
 * This adds a second button that picks that content deterministically from the
 * memory text — seeded, so the same memory always yields the same design — and
 * hands it to the same renderResult() the AI path uses. It is labelled as
 * geometry-only and does not pretend to be an emotional reading.
 * ------------------------------------------------------------------ */

edit('studio.html', (h) => {
  if (h.includes('id="composeBtn"')) return h;

  const BUTTON = `      <button class="btn-analyse" id="composeBtn" disabled
        style="margin-top:10px;background:transparent;color:var(--green);border:1px solid var(--border2)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>
        Compose without AI &mdash; geometry only
      </button>
`;
  const anchor = '        Run EVS analysis &amp; generate prompt\n      </button>\n';
  if (!h.includes(anchor)) return h;

  const SCRIPT = `
/* ---- geometry-only composition -------------------------------------------
   Same engine, same renderResult(); only the CONTENT choice differs. Where the
   AI path asks a model to choose formula, florals and density, this derives
   them from a seed seeded by the memory itself, so it is deterministic and
   needs no network. Everything downstream — coordinates, silence arcs, score,
   prompt, catalog record — is identical, because none of it was ever the AI's
   to decide. ------------------------------------------------------------- */
var composeBtn = $i('composeBtn');

function composeLocally(){
  var memory = mem.value.trim();
  if (!memory || memory.split(/\\s+/).length < 5) return;
  var client = $i('clientName').value.trim() || 'Client';

  wireInventory();
  var shortlist = floralShortlist();
  var seed = (window.EC && window.EC.seedFromText) ? window.EC.seedFromText(memory + client) : 1;
  var rand = (window.EC && window.EC.rngFrom) ? window.EC.rngFrom(seed) : Math.random;
  var pickOne = function(list){ return list.length ? list[Math.floor(rand() * list.length)].split(' ')[0] : null; };

  var FORMULAS = Object.keys((window.EC && window.EC.FORMULAS) || {});
  var EMOTIONS = (window.EC && window.EC.WGS_EMOTIONS) || ['peace'];
  var TERRS = ['Comfort','Celebration','Remembrance','Renewal','Connection','Seasonal Nostalgia'];
  var DIMS = ['Nostalgia','Warmth','Intimacy','Valence','Restraint','Energy'];

  var dims = {};
  DIMS.forEach(function(d){ dims[d] = Math.round((0.28 + rand() * 0.62) * 100) / 100; });

  var densities = ['light','medium','lush'];
  var density = densities[Math.floor(rand() * 3)];

  renderResult({
    dims: dims,
    territory: TERRS[Math.floor(rand() * TERRS.length)],
    matchScore: 0,
    narrative: 'Composed by geometry alone \\u2014 the engine placed every stem from a seed taken '
      + 'from this memory, so the same words always produce the same design. No emotional '
      + 'reading was made; add an API key to the server for the EVS analysis.',
    palette: [],
    diameter_in: [16,18,20,24][Math.floor(rand() * 4)],
    coverage_tier: ['EDITORIAL','GARDEN','LUSH'][Math.floor(rand() * 3)],
    formula: FORMULAS[Math.floor(rand() * FORMULAS.length)] || 'Crescent',
    emotional_tags: [EMOTIONS[Math.floor(rand() * EMOTIONS.length)]],
    florals: {
      focal:     { item_id: pickOne(shortlist.focal),     density: density },
      secondary: { item_id: pickOne(shortlist.secondary), density: density },
      filler:    { item_id: pickOne(shortlist.filler),    density: density },
      accent:    { item_id: pickOne(shortlist.accent),    density: density }
    },
    foliage: [pickOne(shortlist.foliage)].filter(Boolean)
  }, client, $i('clientEmail').value.trim(), $i('orderType').value,
     parseInt($i('deadline').value) || 510, memory);

  toast('Composed by geometry \\u2014 no model involved.');
}

composeBtn.addEventListener('click', composeLocally);

/* The engine needs no key; keep this button in step with the memory field. */
mem.addEventListener('input', function(){
  composeBtn.disabled = mem.value.trim().split(/\\s+/).filter(Boolean).length < 5;
});
composeBtn.disabled = mem.value.trim().split(/\\s+/).filter(Boolean).length < 5;

/* Say up front whether a live analysis is even possible. */
if (window.claude && window.claude.status) {
  window.claude.status().then(function(s){
    if (!s.configured) {
      btn.title = 'The server has no ANTHROPIC_API_KEY, so the EVS analysis is unavailable. '
        + 'Compose without AI still runs the full geometry engine.';
      composeBtn.style.background = 'var(--green)';
      composeBtn.style.color = '#fff';
      composeBtn.style.borderColor = 'var(--green)';
    }
  }).catch(function(){});
}
</script>`;

  note('studio.html', 'added a geometry-only composition path (the engine needs no API key)');
  return h.replace(anchor, anchor + BUTTON).replace(/<\/script>\s*<\/body>/, SCRIPT + '\n</body>');
});

/* ------------------------------------------------------------------ *
 * 4b-ii. an unknown design must not silently become September Porch
 *
 * The product page did `if (!slug || !DB[slug]) slug = 'september-porch'`, so
 * any wrong or stale link rendered a different wreath under the requested
 * name's URL — with the right price, the right story, and no indication
 * anything was wrong. That is what hid thirteen mis-pointed blueprint links:
 * every one of them "worked".
 *
 * No slug at all still defaults, which is reasonable for a bare link. A slug
 * that names nothing now goes to the 404 page, which already says the right
 * thing for a design that isn't there and offers the library.
 * ------------------------------------------------------------------ */

edit('moodoor-product-page.html', (h) => {
  const OLD = "if (!slug || !DB[slug]) slug = 'september-porch';";
  if (!h.includes(OLD)) return h;
  note('moodoor-product-page.html', 'an unknown ?w= no longer renders a different design under its name');
  return h.replace(OLD,
    "if (!slug) slug = 'september-porch';\n" +
    "  if (!DB[slug]) { location.replace('404.html?design=' + encodeURIComponent(slug)); return; }");
});

/* ------------------------------------------------------------------ *
 * 4c-ii. bound the Studio's output panels
 *
 * `.out-box` sets a min-height and no max-height. That was harmless while the
 * engine was missing and every panel held a one-line placeholder. Now that the
 * catalog record carries a full EC_WR_V2 blueprint — 33 clusters, pretty-printed
 * — the panel runs to tens of thousands of pixels and the page becomes
 * unscrollable in practice. The neighbouring `.bp-json` block already solves
 * this the same way; this brings `.out-box` in line with it.
 * ------------------------------------------------------------------ */

edit('studio.html', (h) => {
  const OLD = 'white-space:pre-wrap;word-break:break-word}';
  if (!h.includes(OLD) || h.includes('max-height:420px')) return h;
  note('studio.html', 'output panels scroll instead of running to 27,000px');
  return h.replace(OLD, 'white-space:pre-wrap;word-break:break-word;max-height:420px;overflow-y:auto}');
});

/* ------------------------------------------------------------------ *
 * 4c-iii. stop the engine blocking first paint
 *
 * `inventory.js` (226 KB) and `evercrafted-engine.js` sat in <head> with no
 * defer, so the browser stopped parsing and painted nothing until both had
 * downloaded and executed. Measured on the product page: five scripts ahead of
 * first paint, FCP 388ms, of which these two were ~145ms.
 *
 * They cannot simply be deferred, because each page's own inline <script> is
 * not deferred and would then run first, before window.EC existed. Moving them
 * down to immediately before that consumer keeps execution order identical
 * while letting the head-parsed CSS paint.
 * ------------------------------------------------------------------ */

const ENGINE_TAGS = '<script src="inventory.js"></script>\n<script src="evercrafted-engine.js"></script>';
const HEAD_TAGS = /<script src="\.\.\/inventory\.js"><\/script>\s*<script src="\.\.\/evercrafted-engine\.js"><\/script>\s*/;

for (const [file, anchor] of [
  // The product page's own script reads MOODOOR_WREATHS, so the engine goes
  // immediately before the catalog data it is paired with.
  ['moodoor-product-page.html', '<script src="wreaths-data.js"></script>'],
  // The Studio has one inline script, opening with its queue key.
  ['studio.html', "<script>\nvar QUEUE_KEY = 'moodoor_studio_queue_v1';"],
]) {
  edit(file, (h) => {
    if (!HEAD_TAGS.test(h)) return h;
    if (!h.includes(anchor)) return h;
    const stripped = h.replace(HEAD_TAGS, '');
    note(file, 'engine scripts moved out of <head> so they no longer block first paint');
    return stripped.replace(anchor, `${ENGINE_TAGS}\n${anchor}`);
  });
}

/* ------------------------------------------------------------------ *
 * 3b. the storefront had no navigation on a phone
 *
 * Every page carries:
 *
 *   @media (max-width: 768px) { .nav-links li:not(:last-child) { display: none } }
 *
 * The intent is to collapse to just the call-to-action on a narrow screen. It
 * does not work, because `cart.js` builds its cart button at runtime and
 * appends it to the same <ul> — so the cart becomes the last child and the rule
 * hides everything else *including* the CTA. Measured at 390px: all seven items
 * `display: none`, leaving a wordmark and a bag icon and no way to reach
 * Wreaths, Blueprints, Bundles, Territories, Drops or How it works.
 *
 * This predates the merge — it needs both the archive's CSS and the archive's
 * cart script to happen, and neither was touched here.
 *
 * Rather than restore "CTA only", the links become a horizontally scrollable
 * row, which is what the pages added in this build already do
 * (moodoor-chrome.css) and leaves the site navigable on the device most people
 * will open it on. Appended after the page's own styles so it wins on
 * specificity without editing rules inline.
 * ------------------------------------------------------------------ */

const MOBILE_NAV_CSS = `<style id="moodoor-mobile-nav">
/* See tools/patch-pages.mjs — the page's own rule hides the whole menu on a
   phone because cart.js appends the cart button as the last child. */
@media (max-width: 768px) {
  .nav-links li:not(:last-child) { display: block; }
  .nav-links {
    display: flex;
    align-items: center;
    gap: 14px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex: 1 1 auto;
    min-width: 0;
    margin-left: 12px;
  }
  .nav-links::-webkit-scrollbar { display: none; }
  .nav-links li { flex: 0 0 auto; }
  .nav-links a { white-space: nowrap; font-size: 12.5px; }
  .nav-links .nav-cta { padding: 7px 13px; }
}
</style>`;

for (const file of STOREFRONT) {
  edit(file, (html) => {
    if (html.includes('id="moodoor-mobile-nav"')) return html;
    if (!/\.nav-links li:not\(:last-child\)/.test(html)) return html;
    note(file, 'navigation is reachable on a phone again (it was entirely hidden)');
    return html.replace('</head>', `${MOBILE_NAV_CSS}\n</head>`);
  });
}

/* ------------------------------------------------------------------ *
 * 3c. the bundle cards had no mobile treatment at all
 *
 * `.trio`, `.b-price` and `.save` are matched by no media query in the page —
 * they carry desktop sizes at every width. Measured at 390px:
 *
 *   .b-price and .save overlap by 45px  (both absolute, top-left / top-right,
 *                                        in a 326px box holding ~330px of pills)
 *   .trio is 444px wide in a 326px box  (3 x 148px cards; .b-visual clips, so
 *                                        the outer two designs lose their names)
 *
 * Pre-existing: the trio is three fixed-width cards and the badges are pinned to
 * opposite corners, neither of which was ever given a narrow-screen size.
 *
 * The trio is scaled rather than re-laid-out, because the fan — the rotation and
 * overlap of the three cards — *is* the design. Scaling keeps it exactly and
 * just makes it fit. The badges move to opposite corners vertically instead of
 * horizontally, which is the same information in the space available.
 * ------------------------------------------------------------------ */

const BUNDLE_MOBILE_CSS = `<style id="moodoor-bundle-mobile">
/* See tools/patch-pages.mjs — the bundle card carried desktop-only sizes. */
@media (max-width: 560px) {
  /* Selectors match the page's own \`.b-visual .save\` specificity (0,2,0) —
     a bare \`.save\` loses to it however late it appears. */
  .b-visual .b-price { left: 12px; top: 12px; right: auto; font-size: 11px; padding: 5px 11px; }
  .b-visual .save { top: auto; bottom: 12px; right: 12px; left: auto; font-size: 10px; padding: 5px 11px; }
  .b-visual .trio { transform: scale(0.7); transform-origin: center center; }
}
</style>`;

edit('collection-bundles.html', (html) => {
  if (html.includes('id="moodoor-bundle-mobile"')) return html;
  if (!html.includes('.trio{display:flex')) return html;
  note('collection-bundles.html', 'bundle cards fit a phone (badges overlapped by 45px, trio clipped by 118px)');
  return html.replace('</head>', `${BUNDLE_MOBILE_CSS}\n</head>`);
});

/* ------------------------------------------------------------------ *
 * 3d. the product hero's two badges collided on a phone
 *
 * `.badge-run` and `.badge-bp` are both absolute at `top: 20px`, pinned to
 * opposite corners, with no media query anywhere. At 390px the container is
 * 326px and the two pills need 382px, so they overlapped by 98x31px — the run
 * count sat behind the blueprint code and could not be read.
 *
 * Half pre-existing, half mine, and worth being exact about which. The
 * corner-pinned layout with no narrow-screen rule is the archive's. But the
 * badge used to read "BP-EC-0417 · v2" at roughly 130px, which fit; the engine
 * built here appends the live grade ("· grade A · 110/120"), taking it to
 * 251px. The layout was fragile, and this build is what broke it.
 *
 * Stacked on mobile: the run count stays top-left, the blueprint code sits
 * directly beneath it.
 * ------------------------------------------------------------------ */

const PRODUCT_BADGE_CSS = `<style id="moodoor-product-badges">
/* See tools/patch-pages.mjs — both badges are pinned to opposite top corners
   with no mobile rule, and the engine's live grade made the right one wider. */
@media (max-width: 560px) {
  /* The hero at 390px is 326x340 with five floating labels. Mapping them, the
     only free zone is bottom-left, and the badge has to stay under ~168px wide
     to clear the "warmth" tag — so it wraps rather than stretching across.
     Moving it to top-left at y=50 instead lands it on the "seasonal" tag. */
  .badge-run { top: 14px; left: 14px; right: auto; }
  .badge-bp  {
    top: auto; bottom: 14px; left: 14px; right: auto;
    max-width: 150px; white-space: normal; line-height: 1.45;
    border-radius: 10px; text-align: left;
  }
}
</style>`;

edit('moodoor-product-page.html', (html) => {
  if (html.includes('id="moodoor-product-badges"')) return html;
  if (!html.includes('.badge-run{position:absolute')) return html;
  note('moodoor-product-page.html', 'hero badges stack on a phone (they overlapped by 98px)');
  return html.replace('</head>', `${PRODUCT_BADGE_CSS}\n</head>`);
});

/* ------------------------------------------------------------------ *
 * 4d. footer links that went nowhere, and the new pages
 * ------------------------------------------------------------------ */

for (const file of STOREFRONT) {
  edit(file, (html) => {
    let out = html;
    // "Evercrafted Studio" and "Become a beta maker" were both href="#".
    out = out.replace('<li><a href="#">Evercrafted Studio</a></li>',
      '<li><a href="studio.html">Moodoor Studio</a></li>');
    out = out.replace('<li><a href="#">Become a beta maker</a></li>',
      '<li><a href="index.html#memory">Begin a memory</a></li>');
    // Surface the story archive, which had no public entry point at all.
    if (!out.includes('stories.html')) {
      out = out.replace('<li><a href="upcoming-drops.html">Upcoming drops</a></li>',
        '<li><a href="upcoming-drops.html">Upcoming drops</a></li>\n          <li><a href="stories.html">Stories</a></li>');
    }
    // Most pages carry a one-line footer with no link columns, so the story
    // archive would only ever be reachable from the homepage. Give those a link
    // too, in the same compact style they already use.
    if (!out.includes('stories.html')) {
      // Some compact footers style their link inline rather than in CSS, so a
      // bare <a> next to one of those falls back to the browser's underline and
      // reads as a different kind of link. Carry the neighbour's style across.
      const sibling = out.match(/<div class="wrap foot-base">[\s\S]{0,400}?<a [^>]*?(style="[^"]*")/);
      const styleAttr = sibling ? ' ' + sibling[1] : '';
      out = out.replace(
        /(<span>&copy; 2026 Evercrafted, Inc\.)( &middot;| ·)?/,
        `$1 &middot; <a href="stories.html"${styleAttr}>Stories</a>$2`
      );
    }
    // Repair pass, for pages patched before the styling rule above existed.
    const footBase = out.match(/<div class="wrap foot-base">[\s\S]{0,500}?<\/span>/);
    if (footBase && /<a href="stories\.html">/.test(footBase[0])) {
      const styled = footBase[0].match(/<a [^>]*?(style="[^"]*")/);
      if (styled) {
        const fixed = footBase[0].replace('<a href="stories.html">', `<a href="stories.html" ${styled[1]}>`);
        out = out.replace(footBase[0], fixed);
        note(file, 'Stories link now matches its neighbour instead of falling back to a default underline');
      }
    }

    if (out !== html) note(file, 'footer links resolved (Studio, memory intake, Stories)');
    return out;
  });
}

/* ------------------------------------------------------------------ *
 * 5. run-state hook on the catalog cards
 * ------------------------------------------------------------------ */

edit('signature-wreaths.html', (h) => {
  // Repair first: an earlier revision of this script used a stateful global
  // regex for its own guard and could stamp the attribute twice.
  let out = h.replace(/(\sdata-product="[a-z-]+")\1+/g, '$1');

  if (!out.includes('data-product=')) {
    out = out.replace(
      /<a([^>]*?)href="moodoor-product-page\.html\?w=([a-z-]+)"/g,
      (full, attrs, slug) => `<a${attrs}href="moodoor-product-page.html?w=${slug}" data-product="${slug}"`
    );
    if (out !== h) note('signature-wreaths.html', 'catalog cards read live run state');
  } else if (out !== h) {
    note('signature-wreaths.html', 'removed a duplicated data-product attribute');
  }
  return out;
});

/* ------------------------------------------------------------------ */

console.log(changes.length ? changes.map((c) => '  ' + c).join('\n') : '  (nothing to change)');
console.log(`\n${changes.length} edit(s) applied.`);
