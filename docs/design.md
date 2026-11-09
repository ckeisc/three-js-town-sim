# three-js-town-sim — Design Doc

"Brickton": a 3D LEGO Loco-inspired town sim. Build a brick town on a
studded baseplate and run trains around it. This doc is the handover
note for picking the project up again; every claim is grounded in the
code as pushed. See `README.md` for how to run it.

## 1. Goal and scope

A playable clone of LEGO Loco (1998, early-Windows LEGO city builder),
v1 scope decided by the owner: the **classic town loop** — grid town,
place roads / houses / shops, lay a train track loop, train runs,
minifigs walk, save the town — with a **strong train focus** (track
laying and trains are co-equal with town building, not a backdrop).

Style rule: **true 3D LEGO-like characters and buildings** built from
three.js geometry (brick blocks, studs, minifig heads/torsos/legs).
The original Loco people were 2D sprites; this clone uses none — no
flat people anywhere. All visuals are procedural meshes; there are no
image assets (the one `icon.webp` in the artifact is the host's app
icon, not game art, and is not in this repo).

## 2. Stack and running it

- Runtime: Bun 1.3.10 (`packageManager: bun@1.3.10`), TypeScript
  strict (`tsconfig.base.json`, `noUncheckedIndexedAccess` on).
- Client: React 19, `three@^0.187.0`, `@tanstack/react-query` 5,
  Tailwind CSS 4 (`client/src/theme.css`, display font "Baloo 2").
- Server: `drizzle-orm` 0.45.2 + SQLite, `zod` 4, actions via
  `@hatch/space-sdk` (typed RPC, no codegen — `client/src/api.ts`).
- This repo is a snapshot of a Hatch TypeScript space (`space.json`:
  runtime `typescript`, entry `client/dist/index.html`). The
  `@hatch/space-sdk` dependency is a `file:` reference to a path on
  the Hatch VM (`/opt/hatch/skills/spaces/ts-runtime/...`), so a
  plain `bun install` outside that VM will fail on that package —
  decoupling the game from the space SDK is an open job (see §9).

```sh
bun install
bun run typecheck   # tsc --noEmit for client + server
bun run build       # build:server (bun build, --target=bun) + build:client (SDK buildClient)
```

There is no dev-server script; `client/build.mjs` just calls the
SDK's `buildClient()`. Do not hand-edit anything under `client/dist/`
or `server/dist/` — they are build outputs and are not in this repo.

## 3. Directory layout

| Path | What lives there |
| --- | --- |
| `client/src/App.tsx` | UI shell: top bar, stats, train panel, palette; all game state |
| `client/src/api.ts` | Typed RPC client (`createActionClient<typeof Actions>`) |
| `client/src/main.tsx` | React root; must keep `QueryClientProvider` + `hatch-space-root` |
| `client/src/game/types.ts` | Grid model, tile codes, starter town, tools, stats |
| `client/src/game/trackPath.ts` | Track route computation (loop vs line, station stops) |
| `client/src/game/Scene.tsx` | Three.js scene, painting, train + minifig animation, whistle |
| `client/src/game/builders.ts` | All procedural meshes (buildings, track, train, minifigs) |
| `server/src/actions.ts` | `getTown` / `saveTown` / `clearTown` (zod-validated) |
| `server/src/schema.ts` | `towns` table (single row, id = 1) |
| `drizzle/0001_initial.sql` | Legacy `entries` table (superseded, kept for history) |
| `drizzle/0002_town_storage.sql` | Current schema: drops `entries`, creates `towns` |

## 4. Grid / town model

- Grid is 24×24 (`N = 24`), one character per tile, row-major
  (`idx = z * N + x`), `CELL = 2` world units per tile.
- Tile codes (`types.ts`): `.` grass, `R` road, `H` house, `S` shop,
  `O` office, `P` park, `T` track, `D` station (track + platform).
- `starterGrid()`: track loop rectangle x 3..20, z 4..19; station
  tiles at (11,19) and (12,19) on the south straight; a road cross
  plus an inner ring; houses/shops/offices/parks inside; a few
  houses/parks outside the loop for sprawl. Building colours vary
  deterministically per cell (`cellHash`), so a town looks the same
  on every load.
- `townStats()`: counts buildings/track/stations/roads; residents
  are derived, not stored — house +4, shop +2, office +6.
- Painting: a tool maps to a tile (`TOOL_TILE` in `App.tsx`); the
  `look` tool paints nothing. Painting is raycast onto an invisible
  pick plane at tile-top height; pointer drag paints continuously,
  OrbitControls are disabled while painting. Changed tiles are
  rebuilt incrementally (`syncGrid(false)` rebuilds the changed tile
  plus its 4 neighbours, since road/track art depends on neighbours).

## 5. Track / train model

`buildTrackRoute(grid)` (`trackPath.ts`) decides what the train runs:

- Track cells are grouped into 4-connected components; dead-end
  branches are pruned (`pruneToCycle`). If a component contains a
  pure cycle (every cell has exactly 2 track neighbours) the
  **largest closed loop** wins; otherwise the **longest open run**
  wins and the train shuttles back and forth.
- The route is a `THREE.CatmullRomCurve3` through the cell centres
  (`closed` flag, `length` in world units). Corners are real curves:
  `builders.ts` draws them with `TorusGeometry` arcs; straights are
  steel rails on sleepers over a ballast plate.
- Station stops (`stationUs`, arc-length params 0..1): every `D`
  cell on the route is located by sampling the curve (1200 samples).
  **Stations within ~1.2 cells of each other merge into one stop**
  at the group midpoint, including a wrap-around fold for a platform
  straddling the closed-loop seam — adjacent station tiles are one
  platform, not two stops.
- Train state (`Scene.tsx`, `animate` loop): arc distance `s`,
  direction `dir` (+1/−1), base speed `3.4 * speedSlider`
  (slider 0.4–2.6). Dwell is **2.4 s** at a station, **0.7 s** at a
  shuttle endpoint. Loco + wagons: `carCount` 1–6, wagons trail at
  offsets `1.83 + i * 1.68` behind the loco, colours cycle through
  blue/green/orange/purple/yellow. Wheel spin is derived from speed.
- Station detection is a **crossing check, not proximity**: if the
  frame's travel carries the train over a station's arc position
  (`0 < d <= stepDist`, `d` measured along travel direction, wrapped
  for closed loops), the train snaps to the station, dwells, and
  whistles. A big step (high speed, slow frame) can no longer jump
  past a station. `lastStation` re-arms once the train is >2 units
  clear. Status reported to the UI: `running` / `station` /
  `stopped` / `no-track`.

## 6. Minifigs

- Count is derived from roads: `0` with no roads, otherwise
  `min(9, 3 + floor(roads / 6))`. Each fig walks road cells only,
  picking a random non-backtracking neighbour, at 1.15 units/s.
- Built by `buildMinifig()` (`builders.ts`): trapezoid torso
  extruded from a 2D profile, hip block, two separate swinging legs,
  angled arms with cylinder hands, yellow cylinder head with a stud
  and two eyes (face is −z). Legs/arms swing with
  `sin(time * 9 + phase)`; figs stranded off-road (road bulldozed)
  are removed.

## 7. Save system

- One saved town: `towns` row `id = 1`, `grid` = 576-char string,
  `updated_at` = ms timestamp. Runtime state (train position,
  minifigs, camera) is client-only and never persisted.
- Actions: `getTown` (null grid = never saved), `saveTown`
  (upsert, grid must match `/^[.RHSOPTD]+$/` and be 576 chars),
  `clearTown` (deletes the row so the starter town returns).
- Client (`App.tsx`): on load, saved town if present, else
  `starterGrid()`. Edits schedule an autosave after a **1200 ms**
  debounce; "Save town" saves immediately; "Starter town" restores
  the starter grid (and saves it); "Clear all" empties the grid
  (two-tap confirm); "Forget save" deletes the saved row.

## 8. Rendering and controls

- `Scene.tsx`: `WebGLRenderer` (antialias, pixel ratio capped at
  1.75, PCF soft shadows 1024, ACES tone mapping, exposure 1.06),
  `RoomEnvironment` for reflections, hemisphere + directional sun
  light, fog, a canvas-textured green baseplate with stud dots,
  backdrop hills, drifting clouds, and trees outside the plate.
- Camera: `PerspectiveCamera` FOV 46 (62 on portrait phones),
  home position (24, 27, 24). `OrbitControls` with damping,
  polar angle capped at 1.38, distance 9–95. "Follow" lerps the
  camera target to the loco; "⌂ View" resets the camera.
- Whistle: lazily created `AudioContext` in `whistle()`, three
  triangle oscillators (311 / 370 / 466 Hz) with a 0.8 s gain
  envelope. It fires on station arrival and on the whistle button
  (`whistleNonce`). **Caveat:** the context is created on station
  arrival, not on a user gesture, so the first automatic whistle
  may start suspended/silent in Chrome until the player interacts;
  the button (a gesture) should sound.
- Top bar shows save state (`Starter town` / `Unsaved changes` /
  `Saving…` / `Town saved` / `Save failed`); stats chips show
  buildings / track / stations / residents. Runtime errors surface
  as a dismissible banner instead of a black canvas.

## 9. Station fix (2026-11-09) and known issues

- **Station fix, applied 2026-11-09** (in this snapshot — verified
  in `trackPath.ts` and `Scene.tsx`): the starter town's two
  adjacent station tiles (11,19) and (12,19) used to produce a
  double stop — 2.4 s dwell, ~0.6 s creep, 2.4 s dwell again
  (~5.4 s stopped for one platform, status flipping
  station → running → station). They now merge into one stop, and
  proximity-only detection (`dd < 0.08`) was replaced by the
  crossing check in §5, so 2.6× speed / slow frames can't skip a
  station. Note: at snapshot time the artifact's edit builder was
  still running its audit; the fix was confirmed present in the
  pushed source files by direct read, but the audit itself had not
  finished — treat the fix as code-verified, not playtest-verified.
- **Explicitly UNVERIFIED at delivery (2026-11-07):** tap/drag
  canvas painting, follow-camera tracking, station dwell timing,
  and whistle audio were never verified — the builder's audit
  harness was killed at its 180 s limit on every run. Live probes
  that did pass: train stop/start, adding a wagon (4 cars), House
  tool selection, save-town server round-trip, clean desktop +
  phone renders, zero console errors. **The owner's playtest is the
  acceptance test.**
- Other notes: `drizzle/0001_initial.sql` is dead history; the
  `entries` table it creates is dropped by 0002. No tests exist in
  this repo. No analytics, no auth, no multiplayer — one town per
  deployment, one player.

## 10. Open next steps (short)

1. Playtest on desktop + phone: painting, follow-cam, dwell timing,
   whistle (including first automatic whistle after load).
2. Decouple from the Hatch space SDK (`@hatch/space-sdk` file: dep,
   `space.json`, `main.tsx` root contract) so the game runs
   standalone with `bun install && bun run build`, or document the
   Hatch-only path explicitly.
3. Add a smoke test: `buildTrackRoute` on the starter grid (one
   merged station stop; closed loop), plus a save/load round-trip
   against `saveTown`/`getTown`.
4. Only then consider gameplay: money/population goals, more train
   control (signals, multiple trains), sound beyond the whistle.
