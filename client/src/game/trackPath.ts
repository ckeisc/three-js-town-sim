import * as THREE from "three";
import { CELL, N, idx, isTrack, type Grid } from "./types";

export interface TrackRoute {
  curve: THREE.CatmullRomCurve3;
  closed: boolean;
  length: number;
  /** Arc-length parameters (0..1) of station stops — the train pauses here.
      Station tiles within ~1 cell of each other are merged into one stop. */
  stationUs: number[];
  cellCount: number;
}

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function trackSet(grid: Grid): Set<number> {
  const s = new Set<number>();
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) if (isTrack(grid[idx(x, z)])) s.add(idx(x, z));
  return s;
}

function neighborsOf(set: Set<number>, i: number): number[] {
  const x = i % N;
  const z = Math.floor(i / N);
  const out: number[] = [];
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
    const ni = idx(nx, nz);
    if (set.has(ni)) out.push(ni);
  }
  return out;
}

function components(set: Set<number>): number[][] {
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const start of set) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of neighborsOf(set, cur)) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/** Iteratively strip dead-end branches; what remains (if anything) is pure cycle. */
function pruneToCycle(cells: number[]): Set<number> {
  const set = new Set(cells);
  let changed = true;
  while (changed && set.size > 2) {
    changed = false;
    for (const c of [...set]) {
      if (neighborsOf(set, c).length <= 1) {
        set.delete(c);
        changed = true;
      }
    }
  }
  return set;
}

function walkOrder(set: Set<number>): number[] {
  const start = set.values().next().value as number;
  const order: number[] = [start];
  const visited = new Set([start]);
  let prev = -1;
  let cur = start;
  for (let guard = 0; guard < set.size + 2; guard++) {
    const next = neighborsOf(set, cur).find((n) => n !== prev && !visited.has(n));
    if (next === undefined) break;
    order.push(next);
    visited.add(next);
    prev = cur;
    cur = next;
  }
  return order;
}

function cellCenter(i: number): THREE.Vector3 {
  const x = i % N;
  const z = Math.floor(i / N);
  return new THREE.Vector3((x - (N - 1) / 2) * CELL, 0.2, (z - (N - 1) / 2) * CELL);
}

/**
 * Work out the route the train runs: the largest closed loop if one exists,
 * otherwise the longest open run of track (the train shuttles back and forth).
 */
export function buildTrackRoute(grid: Grid): TrackRoute | null {
  const all = trackSet(grid);
  if (all.size < 2) return null;

  let bestLoop: number[] | null = null;
  let bestLine: number[] | null = null;

  for (const comp of components(all)) {
    const cycle = pruneToCycle(comp);
    if (cycle.size >= 4 && [...cycle].every((c) => neighborsOf(cycle, c).length === 2)) {
      const order = walkOrder(cycle);
      if (order.length === cycle.size && (!bestLoop || order.length > bestLoop.length)) {
        bestLoop = order;
      }
      continue;
    }
    const set = new Set(comp);
    // Start the walk at an endpoint when there is one.
    const endpoint = comp.find((c) => neighborsOf(set, c).length === 1) ?? comp[0]!;
    const order: number[] = [endpoint];
    const visited = new Set([endpoint]);
    let prev = -1;
    let cur = endpoint;
    for (let guard = 0; guard < comp.length + 2; guard++) {
      const next = neighborsOf(set, cur).find((n) => n !== prev && !visited.has(n));
      if (next === undefined) break;
      order.push(next);
      visited.add(next);
      prev = cur;
      cur = next;
    }
    if (order.length >= 2 && (!bestLine || order.length > bestLine.length)) {
      bestLine = order;
    }
  }

  const order = bestLoop ?? bestLine;
  if (!order || order.length < 2) return null;
  const closed = bestLoop !== null;

  const points = order.map(cellCenter);
  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.5);
  const length = curve.getLength();

  // Locate stations on the route by sampling for the nearest arc parameter.
  const stationCells = new Set(
    order.filter((i) => grid[i] === "D"),
  );
  const rawUs: number[] = [];
  if (stationCells.size > 0) {
    const samples = 1200;
    const pts = curve.getSpacedPoints(samples);
    for (const cell of stationCells) {
      const c = cellCenter(cell);
      let bestU = 0;
      let bestD = Infinity;
      for (let s = 0; s <= samples; s++) {
        const p = pts[s]!;
        const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
        if (d < bestD) {
          bestD = d;
          bestU = s / samples;
        }
      }
      rawUs.push(bestU);
    }
    rawUs.sort((a, b) => a - b);
  }

  // Merge stops that sit within about a cell of each other along the route:
  // adjacent station tiles form one platform, so the train stops once at the
  // group's midpoint instead of creeping tile-to-tile for a double stop.
  const mergeGap = (CELL * 1.2) / length;
  const groups: number[][] = [];
  for (const u of rawUs) {
    const g = groups[groups.length - 1];
    if (g && u - g[g.length - 1]! <= mergeGap) g.push(u);
    else groups.push([u]);
  }
  if (closed && groups.length > 1) {
    const first = groups[0]!;
    const last = groups[groups.length - 1]!;
    if (first[0]! + 1 - last[last.length - 1]! <= mergeGap) {
      // one platform straddling the route seam: fold the head into the tail
      const tail = groups.pop()!;
      const head = groups.shift()!;
      groups.push([...tail, ...head.map((u) => u + 1)]);
    }
  }
  const stationUs = groups.map((g) => {
    const mid = (g[0]! + g[g.length - 1]!) / 2;
    return mid >= 1 ? mid - 1 : mid;
  });
  stationUs.sort((a, b) => a - b);

  return { curve, closed, length, stationUs, cellCount: order.length };
}
