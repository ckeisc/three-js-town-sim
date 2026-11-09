import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
CELL, N, idx, inBounds, isTrack, cellHash,
type Grid, type Tile, type Tool, type TrainStatus,
} from "./types";
import {
buildHouse, buildLocomotive, buildMinifig, buildOffice, buildPark,
buildRoad, buildShop, buildStation, buildTrack, buildWagon,
type Minifig, type TrainPart,
} from "./builders";
import { buildTrackRoute, type TrackRoute } from "./trackPath";

export interface SceneProps {
  grid: Grid;
  tool: Tool;
  onPaint: (x: number, z: number) => void;
  trainRunning: boolean;
  trainSpeed: number;
  carCount: number;
  followTrain: boolean;
  whistleNonce: number;
  resetCamNonce: number;
  onTrainStatus: (s: TrainStatus) => void;
}

const WAGON_COLORS = [0x0055bf, 0x237841, 0xfe8a18, 0x6b3fa0, 0xf2cd37];
const worldX = (x: number) => (x - (N - 1) / 2) * CELL;
const worldZ = (z: number) => (z - (N - 1) / 2) * CELL;

function baseplateTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3a9e4f";
  ctx.fillRect(0, 0, 1024, 1024);
  const cell = 1024 / N;
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= N; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(1024, i * cell); ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for (let x = 0; x < N; x++)
    for (let z = 0; z < N; z++) {
      ctx.beginPath();
      ctx.arc(x * cell + cell / 2, z * cell + cell / 2, cell * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Fig {
  fig: Minifig;
  from: THREE.Vector3;
  to: THREE.Vector3;
  cell: number;
  prev: number;
  t: number;
  dur: number;
  phase: number;
}

export function Scene(props: SceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const gridRef = useRef<Grid>(props.grid);
  const builtGridRef = useRef<Grid | null>(null);

  // three.js handles kept in a ref object created on mount
  const rtRef = useRef<{
    tileGroup: THREE.Group;
    cellMeshes: Map<number, THREE.Group>;
    trainGroup: THREE.Group;
    loco: TrainPart;
    wagons: TrainPart[];
    route: TrackRoute | null;
    s: number;
    dir: 1 | -1;
    dwell: number;
    lastStation: number;
    status: TrainStatus;
    figs: Fig[];
    clouds: THREE.Group[];
    syncGrid: (full: boolean) => void;
    rebuildRoute: () => void;
    rebuildFigs: () => void;
    syncTrainCars: () => void;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd3f0);
    scene.fog = new THREE.Fog(0x9fd3f0, 110, 240);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
    const CAM_HOME = new THREE.Vector3(24, 27, 24);
    camera.position.copy(CAM_HOME);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = 1.38;
    controls.minDistance = 9;
    controls.maxDistance = 95;
    controls.target.set(0, 0, 1);

    // lights
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a9a52, 0.85));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
    sun.position.set(32, 44, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -36;
    sun.shadow.camera.right = 36;
    sun.shadow.camera.top = 36;
    sun.shadow.camera.bottom = -36;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // surrounding meadow + baseplate
    const meadow = new THREE.Mesh(
      new THREE.CircleGeometry(260, 40),
      new THREE.MeshStandardMaterial({ color: 0x86c06c, roughness: 1 }),
    );
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = -1.02;
    meadow.receiveShadow = true;
    scene.add(meadow);

    const plateSide = new THREE.MeshStandardMaterial({ color: 0x2e8b42, roughness: 0.6 });
    const plateTop = new THREE.MeshStandardMaterial({ map: baseplateTexture(), roughness: 0.55 });
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(N * CELL + 1.2, 1, N * CELL + 1.2),
      [plateSide, plateSide, plateTop, plateSide, plateSide, plateSide],
    );
    plate.position.y = -0.5;
    plate.receiveShadow = true;
    scene.add(plate);

    // backdrop hills + drifting clouds
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x6fae5f, roughness: 1 });
    for (const [hx, hz, hr] of [[-90, -70, 42], [85, -85, 52], [10, -120, 60], [-110, 30, 38], [115, 45, 44]] as const) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(hr, 18, 12), hillMat);
      hill.position.set(hx, -hr * 0.55, hz);
      scene.add(hill);
    }
    const clouds: THREE.Group[] = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const cl = new THREE.Group();
      const puffs = 3 + (i % 3);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(2.4 + ((i * 7 + p * 3) % 3), 10, 8), cloudMat);
        s.position.set(p * 3 - puffs, ((i + p) % 2) * 0.7, 0);
        s.scale.y = 0.55;
        cl.add(s);
      }
      cl.position.set(-90 + i * 34, 30 + (i % 3) * 5, -60 + (i % 4) * 30);
      scene.add(cl);
      clouds.push(cl);
    }
    // scattered trees outside the plate
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + cellHash(i, 3) * 0.3;
      const rad = 33 + cellHash(i, 9) * 16;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.3, 1.4, 7),
        new THREE.MeshStandardMaterial({ color: 0x7a4a21, roughness: 0.9 }),
      );
      trunk.position.y = 0.7;
      tree.add(trunk);
      const fol = new THREE.Mesh(
        new THREE.SphereGeometry(1.5 + cellHash(i, 5), 9, 7),
        new THREE.MeshStandardMaterial({ color: 0x3d9950, roughness: 0.9 }),
      );
      fol.position.y = 2.6;
      fol.castShadow = true;
      tree.add(fol);
      tree.position.set(Math.cos(a) * rad, -1, Math.sin(a) * rad);
      scene.add(tree);
    }

    const tileGroup = new THREE.Group();
    scene.add(tileGroup);
    const trainGroup = new THREE.Group();
    scene.add(trainGroup);

    // hover ghost
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.98, 0.55, CELL * 0.98),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    ghost.visible = false;
    ghost.renderOrder = 5;
    scene.add(ghost);

    // picking plane at tile-top height
    const pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(N * CELL, N * CELL),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    pickPlane.rotation.x = -Math.PI / 2;
    pickPlane.position.y = 0.05;
    scene.add(pickPlane);

    const rt = {
      tileGroup,
      cellMeshes: new Map<number, THREE.Group>(),
      trainGroup,
      loco: buildLocomotive(),
      wagons: [] as TrainPart[],
      route: null as TrackRoute | null,
      s: 0,
      dir: 1 as 1 | -1,
      dwell: 0,
      lastStation: -1,
      status: "no-track" as TrainStatus,
      figs: [] as Fig[],
      clouds,
      syncGrid: (_full: boolean) => {},
      rebuildRoute: () => {},
      rebuildFigs: () => {},
      syncTrainCars: () => {},
    };
    rtRef.current = rt;
    trainGroup.add(rt.loco.group);

    const disposeGroup = (g: THREE.Group) => {
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.MeshStandardMaterial;
          if (m.map) {
            m.map.dispose();
            m.dispose();
          }
        }
      });
    };

    const neighbors = (x: number, z: number) => {
      const g = gridRef.current;
      const at = (nx: number, nz: number) => (inBounds(nx, nz) ? g[idx(nx, nz)] : undefined);
      return {
        n: at(x, z - 1), e: at(x + 1, z), s: at(x, z + 1), w: at(x - 1, z),
      };
    };

    const buildCell = (x: number, z: number): THREE.Group | null => {
      const g = gridRef.current;
      const t: Tile = g[idx(x, z)]!;
      if (t === ".") return null;
      const nb = neighbors(x, z);
      const r = cellHash(x, z);
      let grp: THREE.Group;
      switch (t) {
        case "R": grp = buildRoad({ n: nb.n === "R", e: nb.e === "R", s: nb.s === "R", w: nb.w === "R" }); break;
        case "H": grp = buildHouse(r); break;
        case "S": grp = buildShop(r); break;
        case "O": grp = buildOffice(r); break;
        case "P": grp = buildPark(r); break;
        case "T": grp = buildTrack({ n: isTrack(nb.n), e: isTrack(nb.e), s: isTrack(nb.s), w: isTrack(nb.w) }); break;
        case "D": grp = buildStation({ n: isTrack(nb.n), e: isTrack(nb.e), s: isTrack(nb.s), w: isTrack(nb.w) }); break;
        default: return null;
      }
      grp.position.set(worldX(x), 0, worldZ(z));
      return grp;
    };

    const rebuildCell = (x: number, z: number) => {
      const i = idx(x, z);
      const old = rt.cellMeshes.get(i);
      if (old) {
        tileGroup.remove(old);
        disposeGroup(old);
        rt.cellMeshes.delete(i);
      }
      const grp = buildCell(x, z);
      if (grp) {
        tileGroup.add(grp);
        rt.cellMeshes.set(i, grp);
      }
    };

    rt.syncGrid = (full: boolean) => {
      const prev = builtGridRef.current;
      const cur = gridRef.current;
      if (full || !prev) {
        for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) rebuildCell(x, z);
      } else {
        const dirty = new Set<number>();
        for (let i = 0; i < N * N; i++) {
          if (prev[i] !== cur[i]) {
            const x = i % N;
            const z = Math.floor(i / N);
            dirty.add(i);
            if (inBounds(x + 1, z)) dirty.add(idx(x + 1, z));
            if (inBounds(x - 1, z)) dirty.add(idx(x - 1, z));
            if (inBounds(x, z + 1)) dirty.add(idx(x, z + 1));
            if (inBounds(x, z - 1)) dirty.add(idx(x, z - 1));
          }
        }
        for (const i of dirty) rebuildCell(i % N, Math.floor(i / N));
      }
      builtGridRef.current = [...cur];
      rt.rebuildRoute();
      rt.rebuildFigs();
    };

    rt.rebuildRoute = () => {
      rt.route = buildTrackRoute(gridRef.current);
      if (rt.route) {
        rt.s = Math.min(rt.s, rt.route.length);
        trainGroup.visible = true;
      } else {
        trainGroup.visible = false;
      }
    };

    rt.syncTrainCars = () => {
      const want = Math.max(0, propsRef.current.carCount - 1);
      while (rt.wagons.length > want) {
        const w = rt.wagons.pop()!;
        trainGroup.remove(w.group);
        disposeGroup(w.group);
      }
      while (rt.wagons.length < want) {
        const w = buildWagon(WAGON_COLORS[rt.wagons.length % WAGON_COLORS.length]!);
        rt.wagons.push(w);
        trainGroup.add(w.group);
      }
    };

    const roadCells = () => {
      const g = gridRef.current;
      const out: number[] = [];
      for (let i = 0; i < N * N; i++) if (g[i] === "R") out.push(i);
      return out;
    };

    rt.rebuildFigs = () => {
      const roads = roadCells();
      const want = roads.length === 0 ? 0 : Math.min(9, 3 + Math.floor(roads.length / 6));
      while (rt.figs.length > want) {
        const f = rt.figs.pop()!;
        scene.remove(f.fig.group);
        disposeGroup(f.fig.group);
      }
      while (rt.figs.length < want) {
        const start = roads[Math.floor(cellHash(rt.figs.length * 3 + 1, 7) * roads.length)]!;
        const fig = buildMinifig(cellHash(start, 11));
        const x = start % N;
        const z = Math.floor(start / N);
        const pos = new THREE.Vector3(worldX(x), 0.1, worldZ(z));
        fig.group.position.copy(pos);
        scene.add(fig.group);
        rt.figs.push({
          fig, from: pos.clone(), to: pos.clone(),
          cell: start, prev: -1, t: 1, dur: 1,
          phase: cellHash(start, 21) * Math.PI * 2,
        });
      }
      // drop figs stranded off-road
      rt.figs = rt.figs.filter((f) => {
        if (gridRef.current[f.cell] === "R") return true;
        scene.remove(f.fig.group);
        disposeGroup(f.fig.group);
        return false;
      });
    };

    rt.syncGrid(true);
    rt.syncTrainCars();

    // ---------- painting ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let painting = false;
    let lastCell = -1;

    const pickCell = (ev: PointerEvent): number => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(pickPlane)[0];
      if (!hit) return -1;
      const gx = Math.round(hit.point.x / CELL + (N - 1) / 2);
      const gz = Math.round(hit.point.z / CELL + (N - 1) / 2);
      if (!inBounds(gx, gz)) return -1;
      return idx(gx, gz);
    };

    const onDown = (ev: PointerEvent) => {
      if (propsRef.current.tool === "look") return;
      const cell = pickCell(ev);
      if (cell < 0) return;
      painting = true;
      lastCell = cell;
      controls.enabled = false;
      propsRef.current.onPaint(cell % N, Math.floor(cell / N));
    };
    const onMove = (ev: PointerEvent) => {
      const cell = pickCell(ev);
      if (cell >= 0 && propsRef.current.tool !== "look") {
        ghost.visible = true;
        ghost.position.set(worldX(cell % N), 0.3, worldZ(Math.floor(cell / N)));
      } else {
        ghost.visible = false;
      }
      if (!painting || cell < 0 || cell === lastCell) return;
      lastCell = cell;
      propsRef.current.onPaint(cell % N, Math.floor(cell / N));
    };
    const onUp = () => {
      painting = false;
      controls.enabled = true;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    // ---------- audio (whistle) ----------
    let audioCtx: AudioContext | null = null;
    const whistle = () => {
      try {
        audioCtx ??= new AudioContext();
        void audioCtx.resume();
        const t0 = audioCtx.currentTime;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.06);
        gain.gain.setValueAtTime(0.12, t0 + 0.45);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
        gain.connect(audioCtx.destination);
        for (const f of [311, 370, 466]) {
          const o = audioCtx.createOscillator();
          o.type = "triangle";
          o.frequency.value = f;
          o.connect(gain);
          o.start(t0);
          o.stop(t0 + 0.85);
        }
      } catch {
        /* audio unavailable — train still runs */
      }
    };
    let lastWhistle = propsRef.current.whistleNonce;
    let lastResetCam = propsRef.current.resetCamNonce;
    let lastCars = propsRef.current.carCount;

    // ---------- resize ----------
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // widen the view on portrait phones so the whole baseplate fits
      camera.fov = camera.aspect < 0.85 ? 62 : 46;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---------- animation ----------
    const clock = new THREE.Clock();
    let raf = 0;
    let followPos: THREE.Vector3 | null = null;

    const setStatus = (s: TrainStatus) => {
      if (rt.status !== s) {
        rt.status = s;
        propsRef.current.onTrainStatus(s);
      }
    };

    const placeOnRoute = (part: TrainPart, dist: number, route: TrackRoute) => {
      const L = route.length;
      let u: number;
      if (route.closed) u = (((dist % L) + L) % L) / L;
      else u = THREE.MathUtils.clamp(dist, 0, L) / L;
      const pos = route.curve.getPointAt(u);
      const tan = route.curve.getTangentAt(u);
      part.group.position.copy(pos);
      const ahead = pos.clone().add(tan.multiplyScalar(rt.dir));
      part.group.lookAt(ahead.x, pos.y, ahead.z);
      // models face -z (loco front, minifig face); lookAt aims +z at target,
      // so aiming at pos+tan*dir with front at -z needs the opposite point:
      part.group.lookAt(pos.x - tan.x, pos.y, pos.z - tan.z);
      return pos;
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      try {
        const dt = Math.min(clock.getDelta(), 0.05);
        const time = clock.elapsedTime;
        const P = propsRef.current;

        if (P.whistleNonce !== lastWhistle) {
          lastWhistle = P.whistleNonce;
          if (lastWhistle > 0) whistle();
        }
        if (P.resetCamNonce !== lastResetCam) {
          lastResetCam = P.resetCamNonce;
          camera.position.copy(CAM_HOME);
          controls.target.set(0, 0, 1);
          followPos = null;
        }
        if (P.carCount !== lastCars) {
          lastCars = P.carCount;
          rt.syncTrainCars();
        }

        // clouds drift
        for (const cl of clouds) {
          cl.position.x += dt * (reduced ? 0.15 : 0.55);
          if (cl.position.x > 130) cl.position.x = -130;
        }

        // ----- train -----
        const route = rt.route;
        if (!route) {
          setStatus("no-track");
        } else {
          const L = route.length;
          const speed = 3.4 * P.trainSpeed;
          if (!P.trainRunning) {
            setStatus("stopped");
          } else if (rt.dwell > 0) {
            rt.dwell -= dt;
            setStatus("station");
          } else {
            setStatus("running");
            const prevS = rt.s;
            const travelDir = rt.dir;
            rt.s += rt.dir * speed * dt;
            if (route.closed) {
              rt.s = ((rt.s % L) + L) % L;
            } else if (rt.s >= L) {
              rt.s = L;
              rt.dir = -1;
              rt.dwell = Math.max(rt.dwell, 0.7);
            } else if (rt.s <= 0) {
              rt.s = 0;
              rt.dir = 1;
              rt.dwell = Math.max(rt.dwell, 0.7);
            }
            // Station stops: a crossing check, not proximity — if this
            // frame's travel carried the train over a station's arc
            // position, it stops there, however large the step was (high
            // speed or a slow frame can no longer jump clean past it).
            const stepDist = speed * dt;
            for (const su of route.stationUs) {
              const sd = su * L;
              if (sd === rt.lastStation) continue;
              let d = (sd - prevS) * travelDir;
              if (route.closed) d = ((d % L) + L) % L;
              if (d > 0 && d <= stepDist) {
                rt.s = sd;
                rt.lastStation = sd;
                rt.dwell = 2.4;
                whistle();
                break;
              }
            }
            // re-arm the last-served station once the train is well clear
            if (rt.lastStation >= 0) {
              let dd = Math.abs(rt.s - rt.lastStation);
              if (route.closed) dd = Math.min(dd, L - dd);
              if (dd > 2) rt.lastStation = -1;
            }
          }
          // wheels
          const spin = P.trainRunning && rt.dwell <= 0 ? (speed * dt) / 0.19 : 0;
          const locoPos = placeOnRoute(rt.loco, rt.s, route);
          for (const w of rt.loco.wheels) w.rotation.x += spin * rt.dir;
          rt.wagons.forEach((wagon, i) => {
            const offset = 1.83 + i * 1.68;
            placeOnRoute(wagon, rt.s - rt.dir * offset, route);
            for (const w of wagon.wheels) w.rotation.x += spin * rt.dir;
          });

          // follow camera
          if (P.followTrain) {
            followPos ??= locoPos.clone();
            followPos.lerp(locoPos, 1 - Math.pow(0.001, dt));
            const delta = followPos.clone().sub(controls.target);
            camera.position.add(delta);
            controls.target.copy(followPos);
          } else {
            followPos = null;
          }
        }

        // ----- minifigs -----
        const roads = new Set<number>();
        gridRef.current.forEach((t, i) => {
          if (t === "R") roads.add(i);
        });
        for (const f of rt.figs) {
          if (f.t >= 1) {
            // choose next road cell
            const cx = f.cell % N;
            const cz = Math.floor(f.cell / N);
            const options: number[] = [];
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = cx + dx;
              const nz = cz + dz;
              if (inBounds(nx, nz) && roads.has(idx(nx, nz))) options.push(idx(nx, nz));
            }
            if (options.length === 0) continue;
            const nonBack = options.filter((o) => o !== f.prev);
            const next = (nonBack.length ? nonBack : options)[
              Math.floor(cellHash(f.cell, Math.floor(time) + f.phase * 10) * (nonBack.length ? nonBack.length : options.length))
            ]!;
            f.prev = f.cell;
            f.cell = next;
            f.from.copy(f.to);
            f.to.set(worldX(next % N), 0.1, worldZ(Math.floor(next / N)));
            f.dur = f.from.distanceTo(f.to) / 1.15;
            f.t = 0;
          }
          f.t = Math.min(1, f.t + dt / Math.max(f.dur, 0.01));
          const pos = f.from.clone().lerp(f.to, f.t);
          const bobA = Math.sin(time * 9 + f.phase) * 0.55;
          f.fig.group.position.copy(pos);
          f.fig.legL.rotation.x = bobA;
          f.fig.legR.rotation.x = -bobA;
          f.fig.armL.rotation.x = -bobA * 0.7;
          f.fig.armR.rotation.x = bobA * 0.7;
          if (f.t < 1) {
            const dirv = f.to.clone().sub(f.from);
            if (dirv.lengthSq() > 0.001) {
              f.fig.group.lookAt(pos.x - dirv.x, pos.y, pos.z - dirv.z);
            }
          }
        }

        controls.update();
        renderer.render(scene, camera);
      } catch (err) {
        console.error("scene frame error", err);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      rtRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // grid prop -> ref + incremental sync
  useEffect(() => {
    gridRef.current = props.grid;
    rtRef.current?.syncGrid(false);
  }, [props.grid]);

  return <div ref={mountRef} className="absolute inset-0" aria-label="3D town view" />;
}
