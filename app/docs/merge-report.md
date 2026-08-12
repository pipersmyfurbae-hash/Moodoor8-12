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

## 6g. Seventh pass — the storefront had no navigation on a phone

The mobile screenshots were the one set never actually examined. Measuring the
nav at 390px:

```
index.html  hidden: [Wreaths, Blueprints, Bundles, Territories,
                     Drops, How it works, Begin a memory]
```

**All seven items `display: none`.** On a phone the storefront was a wordmark
and a bag icon, with no way to reach any section — and no way to begin a memory,
which is the site's single call to action.

Cause, and it takes two archive files to produce it. Every page carries:

```css
@media (max-width: 768px) { .nav-links li:not(:last-child) { display: none } }
```

The intent is to collapse to just the call-to-action. It cannot work, because
`cart.js` builds the cart button at runtime and appends it to the same `<ul>`,
taking the last-child slot — so the rule hides every link *and* the CTA. This
predates the merge: it needs the archive's CSS and the archive's cart script,
and neither was modified here. It is invisible in the source of either file
alone, which is presumably why it shipped.

The links are now a horizontally scrollable row on narrow screens, matching what
the pages added in this build already do. Verified across all ten storefront
pages: every item visible and reachable, and the page itself still does not
scroll sideways (the two are easy to trade against each other, so both are
asserted).

`verify.mjs` now checks the mobile menu on eight pages rather than three.

## 6h. Eighth pass — the bundle cards on a phone

Continuing through the mobile screenshots. At 390px the bundle cards showed two
faults, measured:

```
.b-price and .save overlap 45 x 33px   (both absolute, pinned to opposite
                                        top corners of a 326px box that has
                                        ~330px of pills to place)
.trio is 444px wide in a 326px box     (3 x 148px cards; .b-visual clips, so
                                        the outer two designs lost their names)
```

`grep` for a media query touching `.trio`, `.b-price` or `.save`: **none**. They
carry desktop sizes at every width. Pre-existing.

The trio is *scaled* rather than re-laid-out, because the fan — the rotation and
overlap of the three cards — is the design; scaling keeps it exactly and makes it
fit. The badges move to opposite corners vertically instead of horizontally.

Two things worth recording about getting there:

**A first fix silently did nothing.** The page's rule is `.b-visual .save`
(specificity 0,2,0); mine was `.save` (0,1,0), so it lost regardless of source
order — and because `top: 20px` survived alongside my `bottom: 12px`, the badge
stretched to 306px tall instead of moving. My earlier `grep` had printed the rule
as `.save{…}` because the pattern started at `.save{`, hiding the descendant
prefix. Reading the whole selector, not the part that matched, would have caught
it immediately.

**A first measurement lied.** The probe compared only horizontal extents, so it
reported "45px overlap" both before and after — two boxes at opposite ends of the
same column overlap on the x-axis and touch nowhere. Rectangles need both axes.

Also checked and *not* changed: the product page's sticky order bar looked like
it was showing text through itself in a screenshot. Measured — 96% opaque at
z-index 90, and nothing is trapped beneath it at the end of the page. No defect;
left alone.

`verify.mjs` now checks, on eight pages at 390px, that nothing is painted outside
an `overflow: hidden` ancestor and that no two absolutely-positioned siblings
intersect on both axes.

**That check found two more faults on its first run**, one of them in a
screenshot already reviewed and missed:

- `Product (mobile): span.badge-run overlaps span.badge-bp by 98x31px` — the same
  corner-pinned pattern as the bundle badges, and the run count sat unreadable
  behind the blueprint code. Half pre-existing, half this build's: the layout had
  no narrow-screen rule, but the badge read "BP-EC-0417 · v2" at ~130px until the
  engine here started appending the live grade, taking it to 251px. The layout
  was fragile; this build is what broke it. Stacked on mobile.
- `Homepage (mobile): svg clipped 29px by a.terr` — **a false positive.** The
  territory cards deliberately bleed a decorative wreath outline off the card
  edge; the clipped part carries no text and every word on the card is visible.
  The check now only reports clipping of elements that actually contain text,
  because losing a *word* is the failure it exists to catch.

Worth noting the shape of that: a new check earns its keep by finding something,
and it earns trust by being narrowed until what it reports is real. One run
produced one of each.

The badge fix then took two attempts, which is the more useful detail. Moving
`.badge-bp` to `top: 50px` cleared `.badge-run` and landed it on the "seasonal"
orbit tag — the check caught that too. Mapping every absolutely-positioned child
of the 326x340 hero showed the real constraint:

```
badge-run    y  15- 46   x  15-146
orbit ot2    y  62- 94   x 187-312
orbit ot1    y 211-243   x  20-152
orbit ot3    y 273-305   x 168-280
```

The only free zone is bottom-left, and anything placed there has to stay under
about 168px wide to clear `ot3` — so the badge wraps instead of stretching. Five
floating labels in a 326px box is a layout with no slack; guessing at a position
was always going to take two tries, and measuring the whole set first would have
taken one.

## 6i. Ninth pass — accessibility

Never examined until now, so audited from scratch across all thirteen pages: 32
findings.

The archive's markup turned out sound on the fundamentals — **no missing `alt`,
no unnamed button or link, one unlabelled form field in total**. The problems
were structural:

| finding | fix |
|---|---|
| 149 decorative `<svg>` announced as unlabelled graphics | `aria-hidden` at source |
| 5 pages with no main landmark | `role="main"` on the existing container |
| 9 pages whose heading outline skipped a level | `aria-level` |
| `studio.html`: no `<h1>`, unlabelled memory field | hidden heading + `aria-label` |

32 -> 0.

Two things this pass is worth remembering for:

**The runtime is a second surface.** Patching the HTML files fixed 125 of the
149 graphics. The remaining 24 are injected at runtime — nine by `cart.js`, and
fifteen from markup stored in the database and re-inserted by the hydration
templates. Anything that generates markup has to be fixed where it generates it,
not where it lands.

**The checker was less reliable than the code.** Three of its findings were its
own faults: it looked for a literal `<main>` and missed `role="main"`, counted a
hidden success-state `<h1>` as a duplicate, and read heading tags while ignoring
`aria-level`. Each looked like a real defect until checked. Where a measurement
and the code disagree, the measurement is not automatically right — that has now
happened four times across these passes (this three, plus the single-axis
overlap probe).

`npm run check:a11y` is now a gate, and it was verified to fail by reintroducing
a regression rather than assumed to work.

## 6j. Tenth pass — security

The test suite covered authorisation on admin routes, path traversal and the
write allow-list from early on, so this pass enumerated *every* declared route
rather than sampling. One was wrong:

```
POST /api/ai/complete    *** PUBLIC ***
```

That route forwards to the Anthropic API using a key from the server's
environment. Open, it lets anyone who can reach the host run inference on the
owner's account, unmetered — as sensitive as an admin write, and it costs money
rather than just leaking.

**It survived because a test asserted it.** The original AI test called the
route with `{ anon: true }` and checked for a 503, so the suite encoded the
vulnerability as expected behaviour. A test can pin a bug in place as firmly as
it pins a feature.

Fixed: the route is owner-only. The Studio loses nothing structural — its
geometry pipeline is entirely client-side, so "Compose without AI" still
produces a full graded blueprint with no session at all, and the runtime now
explains that the analysis needs the owner signed in rather than surfacing a
bare 401.

Also from this pass:

- The session cookie was `HttpOnly; SameSite=Lax` but never `Secure`, so behind
  a TLS proxy it would travel in clear. It is now `Secure` when the request
  arrived over TLS (directly or via `X-Forwarded-Proto`) and not otherwise,
  because hard-coding it breaks a plain-HTTP dev server silently.

- Two new tests. One asserts the AI route rejects anonymous callers before it
  reads the body. The other **enumerates every route the server declares** and
  fails if any non-GET route lacks `requireAdmin`, excepting the login/logout
  handshake — so a future route cannot be added unguarded without the suite
  noticing. Both were verified by removing the guard and watching them fail.

Known and accepted: an admin can store HTML (`trioHtml`, `visualSvg`, story
bodies) that the storefront inserts with `innerHTML`, so a hostile owner could
script their own site. That is inherent to letting an owner author markup, the
data is admin-authored by construction, and no unauthenticated path writes those
fields — the enumerator above is what keeps that true.

## 7. Open items

The extrapolated formula angles are no longer open — see 6d. What remains is
listed in the README under *Known limits*. In brief: no payment processing, no
image uploads, the Studio's job queue is still `localStorage` as shipped, and
the canon's `hex` / `primary_role` columns are synthetic in the source (worked
around and documented rather than silently consumed).
