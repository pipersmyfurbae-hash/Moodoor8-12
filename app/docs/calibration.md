# Engine calibration

Where every number in `public/evercrafted-engine.js` came from. Nothing here is
a guess about data that exists somewhere else — each value is either read off an
archive file or derived and marked as such.

## The ground truth

`public/wreaths-data.js` ships **ten real `EC_WR_V2` blueprints**, produced by the
original engine before it was lost. They are the specification.

| slug | formula | tier | Ø | base | bands | clusters | sweeps | silence | balance |
|---|---|---|---|---|---|---|---|---|---|
| september-porch | Crescent | Garden | 18 | 3.5 | 3 | 33 | 3 | 2 | .243 @ 177° |
| cider-house | Diagonal Flow | Lush | 18 | 3.5 | 3 | 33 | 2 | 1 | .200 @ 227° |
| linen-cedar | Bottom Heavy | Editorial | 16 | 3.0 | 3 | 33 | 3 | 3 | .282 @ 170° |
| quiet-hearth | Bottom Heavy | Garden | 18 | 3.5 | 3 | 33 | 2 | 1 | .304 @ 179° |
| first-light | Top Cluster | Garden | 18 | 3.5 | 3 | 33 | 2 | 1 | .448 @ 153° |
| gathered-grace | Classic Balanced | Lush | 20 | 4.0 | 4 | 43 | 2 | 1 | .272 @ 217° |
| legacy-garden | Half Ring | Editorial | 18 | 3.5 | 3 | 33 | 3 | 2 | .278 @ 168° |
| white-hour | Half Ring | Editorial | 18 | 3.5 | 3 | 27 | 3 | 2 | .482 @ 179° |
| long-table | Twin Cluster | Garden | 18 | 3.5 | 3 | 33 | 2 | 1 | .401 @ 194° |
| green-morning | Side Sweep | Editorial | 16 | 3.0 | 3 | 27 | 3 | 4 | .409 @ 176° |

## Values read directly off that data

| Constant | Value | Evidence |
|---|---|---|
| `wgsBaseWidthIn(d)` | `d / 4 − 1` | Fits 16→3.0, 18→3.5, 20→4.0 exactly, and reproduces studio.html's own hard-coded 4.5 fallback for a 22" form. |
| `depth_bands` | 3 below 20", 4 at 20"+ | Only the 20" design has 4. |
| `BAND_FOR` | filler 1, focal 2, secondary 2, accent 3 | Every cluster in all ten. |
| `RADIUS_FOR` | focal .60–.92, secondary .67–.85, accent .78–.85, filler .67–.76 | Min/max across all ten; asserted in the test suite. |
| sweep `step_deg` | 16 / 20 / 24 | The only three values that occur. |
| sweep `radius_norm` | .76 / .78 / .80 | The only three values that occur. |
| sweep `flow` | `cw` | Always. |
| stem `qty` | always 1 | One cluster per stem; asserted in the test suite. |
| ribbon count | exactly 1 | All ten. |
| `balance_model` | `triangular` \| `diagonal` | The only two values that occur. |

## Formula anchor angles

Eight of the twelve canonical formulas appear in the sample, and their anchor
angle is taken from the first focal cluster and the focal arc. The four that do
not appear — **Spiral Flow, Corner Cluster, Wild Asymmetry, Garden Scatter** —
follow the Placement Engine Spec's reserved 7–9 o'clock anchor zone (210–270°)
with the variation their names describe. `TICKET.FLEX` explicitly authorises
this: *"the 7-9 anchor and 5 o'clock echo are the first canonical test
composition… the architecture must remain flexible enough for later composition
formulas."*

## Pricing

`commerceListing().price_estimate` is a cost-plus **estimate**, calibrated
against the ten shipped retail prices.

| slug | real | estimate | delta |
|---|---|---|---|
| september-porch | $345 | $355 | +3% |
| cider-house | $365 | $380 | +4% |
| linen-cedar | $295 | $315 | +7% |
| quiet-hearth | $315 | $380 | +21% |
| first-light | $335 | $350 | +4% |
| gathered-grace | $395 | $430 | +9% |
| legacy-garden | $425 | $310 | −27% |
| white-hour | $375 | $295 | −21% |
| long-table | $355 | $355 | 0% |
| green-morning | $285 | $260 | −9% |

Mean absolute error **10.5%**, max 27%.

Two things worth stating plainly:

1. **A first attempt priced these ten at $825–$1455** — about 3.4× high — because
   it costed each stem at the canon's per-SKU `price`. Those are pack prices, and
   the catalog's real prices are not derived from them. `STEM_RATE` is a blended
   per-stem wholesale figure instead.

2. **Real price does not track stem count.** The two largest misses are the
   Remembrance pieces, and they miss in the direction that says so: legacy-garden
   is the *third-sparsest* design in the library and the *most expensive*.
   Pricing is an editorial decision. That is why `moodoor-product-page.html` was
   changed to keep the owner-set price as the sticker and treat the engine's
   figure as the cost floor beside it, rather than overwriting the price as the
   page originally did.

## Deliberately not claimed

The original generator is gone. `composeDreamBlueprint` does **not** reproduce its
exact coordinates and does not pretend to. What it guarantees, and what the test
suite enforces across all 12 formulas × 3 tiers:

- the same schema, field for field, as the ten real blueprints
- every value inside the ranges measured above
- deterministic: one seed, one design, always
- at least one silence arc and one greenery sweep, always (`COMP.L4`, `GRN.L1`)
- a grade of C or better under the engine's own composition gate

## Inventory

See the header of `tools/build-inventory.mjs`. In short: the SKU list, species,
colour names, prices, quantities and seasonality are the real EFS-1.0 canon.
Two canon fields are **not** used, because measurement showed they carry noise
rather than data:

- **per-SKU `primary_role`** is uniformly random (Pine Bough is tagged `focal`
  five times; Blue Hydrangea has no `foliage` SKU at all). The archive's own
  `moodoor-studio-src/README.md` says the same thing and instructs deriving role
  from the species canon, which is what `build-inventory.mjs` does.
- **per-SKU `hex`** is likewise random — `color_name: "Ivory"` carries `#9e4fbf`,
  `#37aea8` and `#c74375` on different rows. `color_name` itself is a clean
  18-value vocabulary and *is* used; hex is derived from it, taking values from
  studio.html's own `COLOR_HEX` table where the name appears there.

The twelve `WW-*` / `PH-*` item ids used by the ten shipped blueprints predate
the canon and appear in no inventory file. They are aliased using the names the
blueprints themselves carry in `stems[].name`. Three foliage-sweep ids carry no
name in the source and use the generic label studio.html's own `resolveItem()`
fallback produces.
