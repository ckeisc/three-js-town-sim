# three-js-town-sim (Brickton)

A 3D LEGO Loco-inspired town sim in Three.js: build a brick town on
a 24×24 studded baseplate — roads, houses, shops, offices, parks —
lay a train track loop, and run a red brick locomotive with wagons
around it while 3D LEGO-like minifigs stroll the roads. Your town
autosaves; save, reset to the starter town, or clear it from the top
bar.

Inspired by LEGO Loco (1998). All buildings, track, trains, and
minifigs are procedural three.js geometry — no 2D sprites, no image
assets.

## Run it

This snapshot comes from a Hatch TypeScript space, so it currently
only runs in full on that runtime: the `@hatch/space-sdk` dependency
is a `file:` reference to a path on the Hatch VM, and `space.json`
declares the space entry point. See `docs/design.md` §2 and §10 for
the decoupling job.

```sh
bun install
bun run typecheck   # tsc --noEmit, client + server
bun run build       # build:server + build:client
```

## How it plays

- Pick a brick from the bottom palette (Look, Road, House, Shop,
  Office, Park, Track, Station, Bulldoze) and tap or drag on the
  baseplate to build. Roads and track auto-connect to neighbours.
- Close a track loop and the train runs it; an open line shuttles
  back and forth. Stations pause the train for 2.4 s with a whistle.
- Train panel: start/stop, whistle, follow-camera, speed (0.4–2.6×),
  and wagon count (1–6 cars).
- Drag to orbit, pinch/scroll to zoom. Stats chips show buildings,
  track, stations, and residents.

## Layout

- `client/src/game/` — grid model (`types.ts`), track routing
  (`trackPath.ts`), three.js scene (`Scene.tsx`), procedural
  builders (`builders.ts`)
- `client/src/App.tsx` — UI shell and game state
- `server/src/` — `getTown` / `saveTown` / `clearTown` actions and
  the `towns` table schema (Drizzle + SQLite, migrations in
  `drizzle/`)

Read `docs/design.md` for the full handover: grid and train models,
the station fix, save system, and what's still unverified.
