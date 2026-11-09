// Grid model for the town. One character per tile, row-major (z * N + x).
// "." grass · "R" road · "H" house · "S" shop · "O" office · "P" park
// "T" track · "D" station (a track tile with a platform — trains stop there)

export const N = 24;
export const CELL = 2; // world units per tile
export type Tile = "." | "R" | "H" | "S" | "O" | "P" | "T" | "D";

export const idx = (x: number, z: number) => z * N + x;
export const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N;
export const isTrack = (t: Tile | undefined) => t === "T" || t === "D";

/** Deterministic 0..1 hash of a cell, for stable building color variants. */
export function cellHash(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export type Grid = Tile[];

export function emptyGrid(): Grid {
  return new Array<Tile>(N * N).fill(".");
}

/**
 * The starter town: a rectangular train loop around a small town centre,
 * with a station on the south straight, roads, houses, shops and a park.
 * Shown until the player saves their own town.
 */
export function starterGrid(): Grid {
  const g = emptyGrid();
  const set = (x: number, z: number, t: Tile) => {
    if (inBounds(x, z)) g[idx(x, z)] = t;
  };

  // Track loop: rectangle x 3..20, z 4..19
  for (let x = 3; x <= 20; x++) {
    set(x, 4, "T");
    set(x, 19, "T");
  }
  for (let z = 4; z <= 19; z++) {
    set(3, z, "T");
    set(20, z, "T");
  }
  // Station on the south straight
  set(11, 19, "D");
  set(12, 19, "D");

  // Roads: a cross through the middle + a ring just inside the tracks
  for (let x = 5; x <= 18; x++) {
    set(x, 11, "R");
    set(x, 6, "R");
    set(x, 17, "R");
  }
  for (let z = 6; z <= 17; z++) {
    set(5, z, "R");
    set(18, z, "R");
    set(11, z, "R");
  }

  // Houses in the blocks
  const houses: Array<[number, number]> = [
    [7, 8], [8, 8], [13, 8], [15, 8], [16, 8],
    [7, 14], [9, 14], [14, 14], [16, 14],
    [7, 9], [15, 9], [8, 15], [13, 15],
    [6, 13], [17, 13], [9, 7], [14, 7],
  ];
  for (const [x, z] of houses) set(x, z, "H");

  // Shops + offices near the centre cross
  set(10, 10, "S");
  set(12, 10, "S");
  set(10, 12, "S");
  set(12, 12, "O");
  set(13, 12, "O");

  // Parks
  const parks: Array<[number, number]> = [
    [8, 12], [15, 12], [16, 9], [7, 16], [16, 16], [13, 9],
  ];
  for (const [x, z] of parks) set(x, z, "P");

  // A few houses outside the loop for sprawl
  set(1, 8, "H");
  set(1, 15, "H");
  set(22, 9, "H");
  set(22, 14, "P");
  set(8, 2, "P");
  set(15, 21, "H");
  set(9, 21, "P");

  return g;
}

export function gridToString(g: Grid): string {
  return g.join("");
}

export function stringToGrid(s: string): Grid | null {
  if (s.length !== N * N) return null;
  const out: Grid = new Array<Tile>(N * N);
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (!".RHSOPTD".includes(c)) return null;
    out[i] = c as Tile;
  }
  return out;
}

export type Tool =
  | "look" | "road" | "house" | "shop" | "office"
  | "park" | "track" | "station" | "erase";

export type TrainStatus = "running" | "station" | "stopped" | "no-track";

export interface TownStats {
  buildings: number;
  houses: number;
  trackPieces: number;
  stations: number;
  roads: number;
  residents: number;
}

export function townStats(g: Grid): TownStats {
  let buildings = 0, houses = 0, trackPieces = 0, stations = 0, roads = 0, residents = 0;
  for (const t of g) {
    if (t === "H") { buildings++; houses++; residents += 4; }
    else if (t === "S") { buildings++; residents += 2; }
    else if (t === "O") { buildings++; residents += 6; }
    else if (t === "T") trackPieces++;
    else if (t === "D") { trackPieces++; stations++; }
    else if (t === "R") roads++;
  }
  return { buildings, houses, trackPieces, stations, roads, residents };
}
