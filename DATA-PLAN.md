# Data Plan

## Context provenance
- `My wife's favorite game is lego loco. It is a very old early windows lego themed city building game. Can you help me build a 3d clone of it using three.js?` (verbatim user request; defines the game to clone and the three.js requirement)
- `1 but i do like train focus so make sure to replicate train portion along side town building` (verbatim user selection; chooses option 1 Classic Loco loop — grid town, roads/houses/shops, track loop, train runs, minifigs walk, save town — with extra emphasis on trains)
- Assistant proposal accepted: `Classic Loco loop: grid town, place roads / houses / shops, lay a train track loop, train runs around it, minifigs walk, save your town` (assistant proposal explicitly accepted by the current request via choice '1')

## Tested sources
No external HTTP/API data sources. All town content is procedural 3D built with three.js primitives in the client — no feeds, prices, or web data to probe. The only external dependency is the `three` npm package, installed via `bun add three` + `@types/three` per the web3d reference, imported from `three` and `three/addons/...` so the audit renders offline. Town persistence uses the artifact's own `ctx.db` (single saved-town row storing the tile grid as JSON).

## Long-term data behavior
- **Refresh policy**: No scheduled refresh. Town loads once on open via `getTown`; saves are explicit (Save button + autosave debounce after edits).
- **Growth**: One town slot (id=1) overwritten on save; grid fixed at 24x24 tiles so payload stays small (~576 cells).
- **Ordering**: Grid stored row-major (z then x); train/minifig runtime state is client-only and never persisted.
- **Time semantics**: `updated_at` is a creation/update instant rendered viewer-local; no event times.

## Imagery
Imagery not needed: every visual is a procedural three.js mesh (brick buildings with studs, track pieces, locomotive, minifigs) — the game itself is the imagery; no photos or generated images serve the build/demolish/run-train workflow.

## Rejected approaches
- **Tried**: Considering a free-brick sandbox (option 2) or train-only backdrop town (option 3)
  **Why rejected**: User explicitly chose option 1 (classic loop) with train focus layered on top, so town building and trains are co-equal systems.
- **Tried**: Considering CDN three.js
  **Why rejected**: Web3d reference forbids it — audit browser cannot reach a CDN; npm `three` import is the supported path for server-backed builds.
