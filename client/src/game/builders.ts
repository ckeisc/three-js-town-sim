import * as THREE from "three";
import { CELL } from "./types";

// ---------- shared materials / helpers ----------

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, roughness = 0.38, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    matCache.set(key, m);
  }
  return m;
}

const STEEL = () => mat(0xb9c0c7, 0.3, 0.85);

function box(
  parent: THREE.Object3D,
  w: number, h: number, d: number,
  color: number,
  x = 0, y = 0, z = 0,
  roughness = 0.38,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, roughness));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function plate(parent: THREE.Object3D, color: number, h = 0.07) {
  return box(parent, CELL, h, CELL, color, 0, h / 2, 0, 0.6);
}

/** Triangular-prism roof, ridge running along z. */
function prismRoof(parent: THREE.Object3D, w: number, h: number, d: number, color: number, y: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat(color, 0.42));
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function studs(parent: THREE.Object3D, y: number, color: number, nx = 3, nz = 3, spread = 0.9) {
  const geo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10);
  const inst = new THREE.InstancedMesh(geo, mat(color, 0.35), nx * nz);
  const M = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      M.setPosition(
        (i - (nx - 1) / 2) * (spread / Math.max(1, nx - 1 || 1)) * (nx > 1 ? 1 : 0),
        y,
        (j - (nz - 1) / 2) * (spread / Math.max(1, nz - 1 || 1)) * (nz > 1 ? 1 : 0),
      );
      inst.setMatrixAt(k++, M);
    }
  inst.castShadow = true;
  parent.add(inst);
}

// ---------- palette ----------

const WALLS = [0xf4f1e6, 0xe8d8b0, 0xcfe4f7, 0xf7d9c4, 0xd9ecd2, 0xf3c6d3];
const ROOFS = [0xd01012, 0x0055bf, 0xfe8a18, 0x237841, 0x6b3fa0, 0x8a5a2b];
const BRIGHT = [0xd01012, 0x0055bf, 0xf2cd37, 0x237841, 0xfe8a18, 0x00a3a2];
const pick = <T,>(arr: T[], r: number): T => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]!;

// ---------- roads ----------

export interface Neighbors { n: boolean; e: boolean; s: boolean; w: boolean }

export function buildRoad(nb: Neighbors): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0xb9bcbe, 0.06); // sidewalk slab
  box(g, CELL * 0.88, 0.05, CELL * 0.88, 0x3c4043, 0, 0.055, 0, 0.7); // asphalt
  const dash = (x: number, z: number, rot: boolean) =>
    box(g, rot ? 0.34 : 0.09, 0.02, rot ? 0.09 : 0.34, 0xf5f5f0, x, 0.09, z, 0.6);
  if (nb.e || nb.w) for (const dx of [-0.62, 0, 0.62]) dash(dx, 0, true);
  if (nb.n || nb.s) for (const dz of [-0.62, 0, 0.62]) dash(0, dz, false);
  if (!nb.n && !nb.e && !nb.s && !nb.w) dash(0, 0, true);
  return g;
}

// ---------- buildings ----------

export function buildHouse(r: number): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0xa8c686, 0.06);
  const wall = pick(WALLS, r);
  const roof = pick(ROOFS, (r * 7) % 1);
  box(g, 1.25, 0.85, 1.15, wall, 0, 0.49, 0);
  prismRoof(g, 1.45, 0.55, 1.35, roof, 0.92);
  box(g, 0.16, 0.34, 0.16, 0x8a5a2b, 0.36, 1.2, -0.3); // chimney
  box(g, 0.3, 0.52, 0.06, 0x6b3a1f, 0, 0.32, 0.6); // door
  const win = (x: number, z: number, ry = 0) => {
    const w = box(g, 0.26, 0.26, 0.05, 0x9fd8e8, x, 0.58, z, 0.15);
    w.rotation.y = ry;
  };
  win(-0.38, 0.6);
  win(0.38, 0.6);
  win(0, -0.6);
  // flower boxes
  box(g, 0.4, 0.1, 0.12, pick(BRIGHT, (r * 3) % 1), -0.38, 0.4, 0.63);
  box(g, 0.4, 0.1, 0.12, pick(BRIGHT, (r * 11) % 1), 0.38, 0.4, 0.63);
  return g;
}

function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 32;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? a : b;
    ctx.fillRect(i * 16, 0, 16, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildShop(r: number): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0xb9bcbe, 0.06);
  const wall = pick(WALLS, (r * 5) % 1);
  const accent = pick(BRIGHT, (r * 9) % 1);
  box(g, 1.6, 0.95, 1.3, wall, 0, 0.54, 0);
  box(g, 1.7, 0.14, 1.4, accent, 0, 1.09, 0); // parapet band
  box(g, 1.7, 0.08, 1.4, 0x4a4a4a, 0, 1.2, 0); // roof cap
  // storefront glass
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.55, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x9fd8e8, roughness: 0.08, metalness: 0.25 }),
  );
  glass.position.set(-0.14, 0.42, 0.67);
  g.add(glass);
  box(g, 0.28, 0.62, 0.06, accent, 0.62, 0.37, 0.67); // door
  // striped awning
  const awn = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.05, 0.42),
    new THREE.MeshStandardMaterial({ map: stripeTexture("#d01012", "#ffffff"), roughness: 0.6 }),
  );
  awn.position.set(0, 0.78, 0.82);
  awn.rotation.x = 0.35;
  awn.castShadow = true;
  g.add(awn);
  studs(g, 1.27, 0x4a4a4a, 3, 3, 1.1);
  return g;
}

function windowTexture(base: string, lit: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 192;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 192);
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 4; x++) {
      const on = ((x * 7 + y * 13) % 5) < 2;
      ctx.fillStyle = on ? lit : "#39505e";
      ctx.fillRect(10 + x * 29, 12 + y * 30, 20, 20);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildOffice(r: number): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0xb9bcbe, 0.06);
  const tint = pick([0x8fa8bf, 0xb0a89a, 0x9db8a4, 0xc2b280], r);
  const tex = windowTexture("#" + tint.toString(16).padStart(6, "0"), "#ffe9a3");
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.0, 1.3), bodyMat);
  body.position.y = 1.06;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  box(g, 1.55, 0.12, 1.4, 0x33383c, 0, 2.12, 0);
  box(g, 0.4, 0.22, 0.4, 0x707880, 0.3, 2.29, 0.2); // roof unit
  box(g, 0.34, 0.6, 0.06, 0x2c3438, 0, 0.36, 0.67); // entrance
  return g;
}

export function buildPark(r: number): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0x2f8f43, 0.06);
  // sandy path cross
  box(g, CELL * 0.3, 0.03, CELL, 0xd9c08a, 0, 0.07, 0, 0.8);
  box(g, CELL, 0.03, CELL * 0.3, 0xd9c08a, 0, 0.075, 0, 0.8);
  const trees = 2 + Math.floor(r * 2);
  const spots: Array<[number, number]> = [[-0.6, -0.6], [0.62, -0.55], [-0.58, 0.6], [0.6, 0.62]];
  for (let i = 0; i < trees; i++) {
    const [tx, tz] = spots[(i + Math.floor(r * 4)) % spots.length]!;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), mat(0x7a4a21, 0.7));
    trunk.position.y = 0.2;
    trunk.castShadow = true;
    tree.add(trunk);
    const fol = new THREE.Mesh(
      new THREE.SphereGeometry(0.34 + ((r * 13 + i) % 1) * 0.1, 10, 8),
      mat(pick([0x2e9e4f, 0x37b24d, 0x66bb44], (r + i * 0.37) % 1), 0.6),
    );
    fol.position.y = 0.72;
    fol.castShadow = true;
    tree.add(fol);
    tree.position.set(tx, 0.06, tz);
    g.add(tree);
  }
  // flowers
  for (let i = 0; i < 6; i++) {
    const a = r * 20 + i * 1.13;
    box(g, 0.09, 0.09, 0.09, pick(BRIGHT, (r + i * 0.29) % 1),
      Math.cos(a) * 0.42, 0.12, Math.sin(a) * 0.42, 0.5);
  }
  // bench
  box(g, 0.5, 0.05, 0.16, 0x8a5a2b, 0, 0.24, -0.05);
  box(g, 0.5, 0.16, 0.04, 0x8a5a2b, 0, 0.36, -0.13);
  return g;
}

// ---------- track ----------

function straightRails(g: THREE.Group, rotY: number) {
  const grp = new THREE.Group();
  // sleepers
  for (const d of [-0.66, -0.22, 0.22, 0.66]) {
    box(grp, 0.62, 0.05, 0.16, 0x5a4632, 0, 0.1, d, 0.8);
  }
  for (const s of [-0.2, 0.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, CELL), STEEL());
    rail.position.set(s, 0.16, 0);
    rail.castShadow = true;
    grp.add(rail);
  }
  grp.rotation.y = rotY;
  g.add(grp);
}

function curveRails(g: THREE.Group, cornerX: number, cornerZ: number, rotY: number) {
  // Arc subgroup with its origin at the tile corner that centres the curve.
  // The baked torus arc spans from the +x edge to the -z edge; rotY turns
  // that span onto whichever pair of edges this tile connects.
  const grp = new THREE.Group();
  grp.position.set(cornerX, 0, cornerZ);
  grp.rotation.y = rotY;
  for (const rad of [CELL / 2 - 0.2, CELL / 2 + 0.2]) {
    const geo = new THREE.TorusGeometry(rad, 0.032, 6, 14, Math.PI / 2);
    geo.rotateX(-Math.PI / 2); // lay flat: arc now runs +x -> -z in plan view
    const rail = new THREE.Mesh(geo, STEEL());
    rail.position.y = 0.16;
    rail.castShadow = true;
    grp.add(rail);
  }
  for (let i = 0; i < 4; i++) {
    const a = 0.2 + (i / 3) * (Math.PI / 2 - 0.4);
    const sl = box(grp, 0.62, 0.05, 0.15, 0x5a4632,
      Math.cos(a) * (CELL / 2), 0.1, -Math.sin(a) * (CELL / 2), 0.8);
    sl.rotation.y = a; // long axis radial
  }
  g.add(grp);
}

function railsFor(g: THREE.Group, nb: Neighbors) {
  const conns = [nb.n, nb.e, nb.s, nb.w].filter(Boolean).length;
  if (conns === 0) {
    straightRails(g, 0);
    return;
  }
  if (conns === 2) {
    if (nb.n && nb.s) return straightRails(g, 0);
    if (nb.e && nb.w) return straightRails(g, Math.PI / 2);
    // curves: arc centred on the corner between the two connected edges
    if (nb.n && nb.e) return curveRails(g, CELL / 2, -CELL / 2, 0);
    if (nb.w && nb.n) return curveRails(g, -CELL / 2, -CELL / 2, Math.PI / 2);
    if (nb.s && nb.w) return curveRails(g, -CELL / 2, CELL / 2, Math.PI);
    if (nb.e && nb.s) return curveRails(g, CELL / 2, CELL / 2, -Math.PI / 2);
  }
  if (conns === 1) {
    if (nb.n || nb.s) return straightRails(g, 0);
    return straightRails(g, Math.PI / 2);
  }
  // junction / crossing: draw both straights
  straightRails(g, 0);
  straightRails(g, Math.PI / 2);
}

export function buildTrack(nb: Neighbors): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0x8d9296, 0.07); // ballast
  railsFor(g, nb);
  return g;
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0055bf";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("STATION", 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStation(nb: Neighbors): THREE.Group {
  const g = new THREE.Group();
  plate(g, 0x8d9296, 0.07);
  railsFor(g, nb);
  const horizontal = nb.e || nb.w;
  // platform on one side of the rails
  const pg = new THREE.Group();
  box(pg, 1.9, 0.22, 0.55, 0xd8d3c3, 0, 0.11, 0, 0.7);
  // canopy
  for (const px of [-0.8, 0.8]) box(pg, 0.08, 0.75, 0.08, 0x0055bf, px, 0.6, -0.15);
  const canopy = box(pg, 1.9, 0.07, 0.6, 0xd01012, 0, 1.0, -0.12);
  canopy.rotation.x = 0.06;
  // sign
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.28, 0.04),
    new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.5 }),
  );
  sign.position.set(0, 0.82, 0.16);
  pg.add(sign);
  box(pg, 0.06, 0.5, 0.06, 0x333333, 0, 0.45, 0.16);
  // bench + waiting minifig-scale shelter block
  box(pg, 0.6, 0.05, 0.18, 0x8a5a2b, -0.4, 0.32, 0.05);
  if (horizontal) {
    pg.position.set(0, 0, 0.68);
  } else {
    pg.rotation.y = Math.PI / 2;
    pg.position.set(0.68, 0, 0);
  }
  g.add(pg);
  return g;
}

// ---------- train ----------

function wheel(parent: THREE.Object3D, x: number, y: number, z: number, r: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, 0.07, 14);
  geo.rotateZ(Math.PI / 2); // axle along x, so rotation.x spins the wheel
  const w = new THREE.Mesh(geo, mat(0x1c1e20, 0.4, 0.4));
  w.position.set(x, y, z);
  w.castShadow = true;
  parent.add(w);
  return w;
}

export interface TrainPart {
  group: THREE.Group;
  wheels: THREE.Mesh[];
}

export function buildLocomotive(): TrainPart {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  box(g, 0.78, 0.14, 1.85, 0x1c1e20, 0, 0.3, 0); // chassis
  box(g, 0.72, 0.42, 1.05, 0xd01012, 0, 0.58, -0.32); // boiler block / body
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.85, 14), mat(0xd01012, 0.35));
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 0.72, -0.42);
  boiler.castShadow = true;
  g.add(boiler);
  box(g, 0.74, 0.62, 0.62, 0x0055bf, 0, 0.68, 0.58); // cab
  box(g, 0.78, 0.08, 0.7, 0x1c1e20, 0, 1.03, 0.58); // cab roof
  const winMat = new THREE.MeshStandardMaterial({ color: 0xbfe6f2, roughness: 0.1, metalness: 0.2 });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.36), winMat);
    w.position.set(s * 0.38, 0.76, 0.58);
    g.add(w);
  }
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.3, 10), mat(0x1c1e20, 0.5));
  chimney.position.set(0, 0.98, -0.72);
  chimney.castShadow = true;
  g.add(chimney);
  box(g, 0.5, 0.16, 0.1, 0xf2cd37, 0, 0.42, -0.95); // front beam
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffdf6b, emissiveIntensity: 1.4 }),
  );
  lamp.position.set(0, 0.72, -0.88);
  g.add(lamp);
  for (const dz of [-0.68, 0, 0.68])
    for (const s of [-1, 1]) wheels.push(wheel(g, s * 0.36, 0.19, dz, 0.19));
  return { group: g, wheels };
}

export function buildWagon(color: number): TrainPart {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  box(g, 0.78, 0.12, 1.5, 0x1c1e20, 0, 0.3, 0);
  // open wagon: floor + 4 walls
  box(g, 0.74, 0.08, 1.44, color, 0, 0.4, 0);
  box(g, 0.74, 0.4, 0.07, color, 0, 0.62, -0.7);
  box(g, 0.74, 0.4, 0.07, color, 0, 0.62, 0.7);
  box(g, 0.07, 0.4, 1.44, color, -0.35, 0.62, 0);
  box(g, 0.07, 0.4, 1.44, color, 0.35, 0.62, 0);
  // cargo bricks
  box(g, 0.4, 0.22, 0.5, pick(BRIGHT, Math.random()), -0.12, 0.55, -0.2);
  box(g, 0.36, 0.18, 0.4, pick(BRIGHT, Math.random()), 0.14, 0.53, 0.3);
  for (const dz of [-0.5, 0.5])
    for (const s of [-1, 1]) wheels.push(wheel(g, s * 0.36, 0.19, dz, 0.19));
  return { group: g, wheels };
}

// ---------- minifig ----------

export interface Minifig {
  group: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
}

export function buildMinifig(r: number): Minifig {
  const g = new THREE.Group();
  const torsoC = pick(BRIGHT, r);
  const legsC = pick([0x0055bf, 0x333333, 0x8a5a2b, 0xd01012], (r * 7) % 1);
  const mk = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  // legs: two separate brick legs swinging from the hip
  const legGeo = new THREE.BoxGeometry(0.15, 0.34, 0.2);
  legGeo.translate(0, -0.17, 0);
  const legL = mk(legGeo, mat(legsC, 0.45));
  legL.position.set(-0.1, 0.36, 0);
  const legR = mk(legGeo.clone(), mat(legsC, 0.45));
  legR.position.set(0.1, 0.36, 0);
  // hip block joining legs to torso, like a real minifig
  const hips = mk(new THREE.BoxGeometry(0.38, 0.08, 0.21), mat(legsC, 0.45));
  hips.position.y = 0.4;
  // torso: trapezoid brick — narrow at the neck, wide at the hips —
  // extruded from a 2D profile so it reads as a real minifig torso in 3D
  const torsoShape = new THREE.Shape();
  torsoShape.moveTo(-0.14, 0);
  torsoShape.lineTo(0.14, 0);
  torsoShape.lineTo(0.24, -0.42);
  torsoShape.lineTo(-0.24, -0.42);
  torsoShape.closePath();
  const torsoGeo = new THREE.ExtrudeGeometry(torsoShape, { depth: 0.22, bevelEnabled: false });
  torsoGeo.translate(0, 0, -0.11);
  const torso = mk(torsoGeo, mat(torsoC, 0.4));
  torso.position.y = 0.9;
  torso.castShadow = true;
  // arms: angled brick arms with little cylinder hands
  const armGeo = new THREE.BoxGeometry(0.11, 0.36, 0.14);
  armGeo.translate(0, -0.15, 0);
  const armL = mk(armGeo, mat(torsoC, 0.4));
  armL.position.set(-0.26, 0.86, 0);
  armL.rotation.z = 0.18;
  const armR = mk(armGeo.clone(), mat(torsoC, 0.4));
  armR.position.set(0.26, 0.86, 0);
  armR.rotation.z = -0.18;
  for (const s of [-1, 1]) {
    const hand = mk(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 10), mat(0xf2cd37, 0.35));
    hand.position.set(s * 0.33, 0.5, 0);
  }
  // head: classic yellow cylinder with a stud on top
  const head = mk(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 14), mat(0xf2cd37, 0.35));
  head.position.y = 1.0;
  const stud = mk(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), mat(0xf2cd37, 0.35));
  stud.position.y = 1.14;
  // eyes on the face (front is -z)
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), mat(0x1c1c1e, 0.4));
    eye.position.set(s * 0.06, 1.03, -0.155);
    g.add(eye);
  }
  return { group: g, legL, legR, armL, armR };
}
