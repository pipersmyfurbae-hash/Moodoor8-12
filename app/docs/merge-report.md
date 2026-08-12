# Merge report

What was in the three archives, what was taken, what was rejected, and how
confident each decision is.

## 1. What arrived

3 zips → 4 nested zips → 275 files. They contain **four different Moodoor
codebases** at different stages, heavily duplicated.

| Archive | Contains |
|---|---|
| `Website HTML and JavaScript File List (1).zip` | The newest storefront (11 HTML pages, `cart.js`, `wreaths-data.js`), plus the client half of a tRPC/React app, plus `Moodoorprojectfiles.zip` and `moodoorstudiosrc.zip` |
| `Evercrafted Web Builder Project Files 2.zip` | The server half of that same tRPC app, an older storefront copy, a Firebase/Gemini Moodoor variant, `Moodoor-Botanical-Ledger-static.zip` |
| `Finish Building the Placement Engine.zip` | The Placement Engine (vanilla ESM, tests, spec, canon documents) |

Duplication measured: `moodoor-launch-site.html` appears **7 times** in 2
versions; `collection-bundles.html` **6 times** in 2; `Moodoorprojectfiles.zip`
is byte-identical in two archives. In every case the largest copy was the newest
and was the one taken.

## 2. The decisive finding

`studio.html` and `moodoor-product-page.html` both load:

```html
<script src="../inventory.js"></script>
<script src="../evercrafted-engine.js"></script>
```

`grep -rl` across all 275 extracted files: **neither file exists anywhere.**

Consequence: `window.EC` was undefined, so the Studio's blueprint composition,
scoring, diagram, MJ prompt and catalog export were all dead — the page guards
with `if (!window.EC)` and shows placeholders, so it *looked* like a working app
while doing nothing. The product page fell back to a flat decorative motif and
hand-typed anatomy.

A second missing global: `studio.html` calls `window.claude.complete()`, provided
by the environment the page was authored in and absent everywhere else.

Both are now supplied. See §5.

## 3. Decisions

### Taken

| Decision | Confidence | Basis |
|---|---|---|
| Storefront = the newest copy from archive 1 | **High** | Largest of every duplicate set; `index.html` and `moodoor-launch-site.html` are byte-identical, so one canonical name |
| Geometry ported from `placement-engine/src/core/geometry.js` | **High** | Complete, unit-tested source; angle convention preserved verbatim |
| `EC_WR_V2` schema from the ten real blueprints in `wreaths-data.js` | **High** | Actual engine output — field names, ranges, band assignment all measured, not inferred |
| `base_width_in = Ø/4 − 1` | **High** | Fits all three shipped diameters exactly *and* reproduces studio.html's own 4.5 fallback for 22" |
| Admin data model ported from `schema.ts` | **High** | 11 tables, all column names preserved; only the SQL dialect changed |
| Inventory from the EFS-1.0 canon | **High** | Real file, 43 species / 551 SKUs |
| Species→role derived, not read from `primary_role` | **High** | The canon's per-SKU roles are uniformly random; the archive's own README instructs deriving from species |
| Hex derived from `color_name`, not from `hex` | **High** | `color_name:"Ivory"` carries `#9e4fbf`, `#37aea8`, `#c74375` — the column is noise |
| 12 legacy `WW-*` ids aliased from blueprint `stems[].name` | **Medium-high** | 9 of 12 carry a real name in the data; 3 foliage ids carry none and use studio.html's own generic fallback label |
| Anchor angles for 8 of 12 formulas | **High** | Read off the real blueprints |
| Anchor angles for the other 4 | **High**, after validation | Extrapolated, then checked over 40 seeds each for grade and pairwise distinctness — see 6d. One collision found and fixed |
| `EC.degToClock` returns a string | **Medium-high** | Both call sites concatenate it into prose; the numeric form is exposed as `degToClockNum` |
| Price model recalibrated | **Medium** | Fitted to the ten real prices, 10.5% mean error — but real price is editorial, so this is a cost floor, not a sticker (see below) |

### Rejected

**The tRPC/Drizzle/React application.** The largest body of code in the archives.
Not revived, for reasons that are structural rather than effort-related:

- It is split across two archives with **two conflicting versions** of
  `routers.ts` (112 vs 324 lines), `db.ts` (237 vs 296) and `schema.ts` (74 vs 288).
- ~15 imported modules exist in **no** archive: `@/components/ui/*` (button,
  input, textarea, sidebar, dropdown-menu, avatar, tooltip, sonner),
  `@/contexts/CartContext`, `@/components/WreathArt`, `@/pages/NotFound`,
  `./_core/llm`, `./localAuth`, `./vite`, `./storageProxy`,
  `./types/manusTypes`, `./components/ErrorBoundary`, `./contexts/ThemeContext`,
  `@/lib/utils`, `@shared/_core/errors`, `@/hooks/*`.
- It requires MySQL, a platform OAuth provider, a proprietary presigned-URL
  storage API, and three private Vite plugins (`vite-plugin-manus-runtime`,
  `@builder.io/vite-plugin-jsx-loc`, a Manus debug collector).

Reviving it would have meant **inventing fifteen modules and a hosting
platform**. Its data model was ported instead, which preserves what it actually
specified.

**The Firebase/Gemini variant** (`moodoor (1)`). A complete, smaller React app,
but a parallel product line — Firebase auth, Firestore, `@google/genai`, its own
`wreaths.ts`. It duplicates the storefront at lower fidelity and needs external
credentials. Superseded.

## 4. Storefront defects found and fixed

| Defect | Detected by |
|---|---|
| `evercrafted-engine.js` and `inventory.js` referenced but absent | source audit |
| `window.claude` referenced but absent | source audit |
| "Drops" missing from the nav on 5 of 8 pages | nav audit |
| `checkout.html` → `moodoor-launch-site.html`, not in this build | link checker |
| `cart.js` empty-cart link → `moodoor-launch-site.html` | **rendered-DOM pass only** — it is built in JavaScript and appears in no HTML file |
| All 3 bundle CTAs → the product page with no `?w=`, so every one opened September Porch | link audit |
| `digital-blueprints.html` had the same bare product link | link audit |
| Product page overwrote the curated price with the engine estimate | screenshot review — $1190 shown beside $365 related designs |
| Engine price model 3.4× too high | calibration against the ten real prices |
| Bundles / territories / drops pages had no data layer at all, so the admin could not affect them | architecture review |

## 5. What was built new

Only where something referenced was missing, or where the admin had nothing to
edit:

- `public/evercrafted-engine.js` — the missing `window.EC` (geometry ported,
  schema measured, canon cited)
- `public/inventory.js` — generated from the canon
- `public/moodoor-runtime.js` — `window.claude` over a server route, plus
  storefront hydration
- `server/` — the HTTP layer, SQLite schema ported from `schema.ts`, seeding
- `public/admin/` — the owner console
- `tools/` — inventory build, seed extraction, page patching, link checking,
  browser verification
- `test/` — 52 tests

## 6. Verification

| Gate | Result |
|---|---|
| `npm test` | 52/52 |
| `npm run check:links` | 22 pages, 0 broken references |
| `npm run verify` | every page renders clean, hydration confirmed, engine draws, admin edit reaches the storefront |

The engine test suite asserts against the **ten real blueprints** — they must
score, cost, list, prompt and draw without error — and against all 12 formulas ×
3 tiers for schema conformance, range conformance, determinism, and a grade of C
or better.

## 6b. Second pass — gaps found reviewing my own work

After the first commit, a self-audit against the goal ("no broken links, fully
working apps") turned up four more:

| Gap | Severity | Resolution |
|---|---|---|
| `server/index.js` served a `404.html` that **did not exist**, so a missing page returned a JSON blob to a browser | Real | `public/404.html`, in the storefront's own language |
| The AI-unavailable message told the operator to *"use Compose without AI"* — **a button that did not exist**. My own error text promised a feature I had not built | Real, and self-inflicted | Built it. The Studio now composes a full blueprint with no API key at all |
| Stories were authorable in the admin with **no public surface anywhere** | Real | `public/stories.html`, linked from every footer |
| The footer's "Evercrafted Studio" and "Become a beta maker" links were both `href="#"` | Real | Point at the Studio and the memory intake |
| The product page's six `href="#"` | **Not** a defect | They are add-to-cart anchors wired by `cart.js` with `preventDefault()` — correct progressive enhancement |

The second of these is the one worth naming. The Studio's whole architecture is
"AI interprets, geometry decides", and the geometry half is local — so gating the
entire page behind an API key was never necessary. `Compose without AI` seeds the
content choice from the memory text and runs the identical pipeline. Verified end
to end: it produces a graded blueprint, the diagram, the Midjourney prompt, the
blueprint JSON and the catalog record with no key configured.

The stories table was also seeded, from the editorial each design already carries
in `wreaths-data.js` (quote, attribution, two paragraphs) rather than from
invented copy — the archive's own audit requires public surfaces to avoid
"invented product claims or customer content".

## 6c. Third pass — performance

Measured, not guessed.

| Finding | Fix | Result |
|---|---|---|
| **Nothing was compressed.** Every asset is text; `inventory.js` alone was 226 KB on the wire | brotli/gzip via `node:zlib`, with compressed output cached by (path, mtime, encoding) | inventory −95%, catalog −89%, API −89%, HTML −69–76% |
| **The engine blocked first paint.** `inventory.js` + `evercrafted-engine.js` in `<head>` with no `defer`; five scripts ahead of first paint on the product page | moved to immediately before the inline script that consumes them, preserving execution order (they cannot be deferred — the consuming inline script isn't) | Product FCP 388→**248 ms**, Studio 232→**164 ms** |
| **`HEAD` 404'd on every API route** while `GET` returned 200 — found because `curl -I` reported a 51-byte body for a 92 KB resource | route `HEAD` as `GET`, suppress the body | `HEAD` now mirrors `GET` with the correct `Content-Length` and no body |
| Assets had a 5-minute `max-age` and no long-lived policy | one-day `max-age` + `stale-while-revalidate`, ETag revalidation; HTML stays `no-cache` so admin edits appear immediately | 304 on unchanged assets |

Locked in by tests rather than left to drift: `npm test` asserts the compression
ratio per asset, that an `identity` request gets no encoding, that small
responses are *not* compressed, that `HEAD` matches `GET`, that assets revalidate
to 304 while HTML does not cache, and that the engine scripts are out of `<head>`
but still ahead of the code reading `window.EC`. `npm run verify` enforces a
per-page byte and first-paint budget in a real browser.

## 6d. Fourth pass — validating the one thing that was extrapolated

The four formula anchor angles not present in the sample were the only values in
the engine not read off real data, so they were checked rather than trusted:
each formula composed over 40 seeds, scored, and every pair compared for whether
it actually renders a different design.

All twelve hold grade C or better on every seed, ten hold grade A on every seed
— the extrapolated four are not weaker than the measured eight.

The check did find a defect. `Wild Asymmetry` at 232 deg rendered
indistinguishably from both `Diagonal Flow` and `Corner Cluster` (same focal
position, same balance direction, within 12 deg of each). A search over the
entire reserved 7-9 o'clock zone found no parameters that are both distinct and
still grade A — with eleven compositions already placed there, the zone is
saturated. `Wild Asymmetry` is now the single formula anchored outside it, at
276 deg, which is precisely the case `TICKET.FLEX` exists for. Two new tests
prevent a recurrence. Full table in docs/calibration.md.

## 6e. Fifth pass — a layout bug the tests could not see

Reviewing the bundles screenshot: the copy column was clipped mid-word, headings
cut off ("Autumn Memori…"), the whole card squeezed into a third of its width.
Every gate was green at the time — 52 tests, no broken links, 43 browser checks.

Measured cause: `.b-copy` rendered **170 px wide inside a 536 px grid column**.
Comparing the page with JavaScript off and on isolated it immediately —

```
static    article children: b-visual[536]  b-copy[536]
hydrated  article children: b-visual[536]
```

— hydration was producing a card with one child instead of two.

The extraction was at fault. `tools/build-seed.mjs` lifted the bundle's trio
markup with a non-greedy regex:

```js
/<div class="trio">([\s\S]*?)<\/div>\s*<\/div>/
```

With three nested children that matches the *last child's* closing tag as the
first half of the terminator, so the capture ends one `</div>` short: 3 opens,
2 closes. The browser auto-closes the tag and absorbs the following sibling into
it — `.b-copy` ended up nested inside `.b-visual`.

Fixed by counting nesting instead of pattern-matching it (the same balanced walk
already used for `<article>`), and `build-seed.mjs` now **fails the build** on
any extracted fragment whose tags do not balance.

**Why nothing caught it.** Every existing check was satisfied by broken output:
the card count was right (3), the SVGs were present, the links resolved, the
page returned 200 and logged no console error. The card count in particular
stays correct precisely *because* the parser recovers.

The new check compares the rendered structure — child classes and widths — with
JavaScript off against on. Hydration now has to reproduce the markup it
replaces, not merely produce something that has the right number of cards.

## 6f. Sixth pass — links that resolved but lied

Reviewing the blueprints screenshot: thirteen cards, and **every one linked to
`?w=september-porch`**. Clicking "Legacy Garden" showed September Porch — right
price, right story, right URL bar, no error.

This was mine. An earlier revision of `patch-pages.mjs` replaced the page's bare
`moodoor-product-page.html` links with a single named slug, which is worse than
leaving them bare: a generic link is honest about being generic, a wrong
specific link is not.

**Why every gate passed it.** The link checker asks whether a URL returns 200 —
all thirteen did. `verify.mjs` re-checked every rendered-DOM link — all thirteen
resolved. Neither asks the only question that matters here: *does the page that
opens show the design the card named?*

The root cause is what made it invisible. The product page did:

```js
if (!slug || !DB[slug]) slug = 'september-porch';
```

so **any** wrong or stale link rendered a real wreath rather than an error. Now
a bare link still defaults, but a slug naming nothing goes to the 404 page,
which names the design it could not find.

Fixes:

- each blueprint card links to its own design, matched on the card's own `<h3>`
- three of the thirteen — Kept Letters, Last Bonfire, Sunday Bread — have no
  catalog entry at all, which is not an error: the page says the library holds
  far more designs than are sold finished. They link to the catalog instead of
  to somebody else's product page.
- `verify.mjs` now opens every product link across the catalog, blueprints and
  bundles pages and asserts the design shown is the design named, and that an
  unknown slug renders no wreath at all.

Three passes, three defects that a green test suite reported as fine, all three
found by looking at a screenshot. Worth stating plainly: on this codebase the
visual pass is load-bearing, not decorative.

## 7. Open items

The extrapolated formula angles are no longer open — see 6d. What remains is
listed in the README under *Known limits*. In brief: no payment processing, no
image uploads, the Studio's job queue is still `localStorage` as shipped, and
the canon's `hex` / `primary_role` columns are synthetic in the source (worked
around and documented rather than silently consumed).
