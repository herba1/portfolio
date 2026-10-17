import { buildPrinter, PRINTER } from "./receiptPrinter";
import { edgeRange, makePaperMesh, straightProfile, tearProfile, updatePaperMesh } from "./receiptPaper";
import { EDGE_N, SEG, THICK, feedStrip, hash, makePoint, stepPiece, worldOf } from "./receiptSim";
import { DOTS, SETS, TEX_W, lineStops, rasterTicket, ticketLength } from "./receiptTicket";

const SUB = 8;
const RING_ROWS = 20480;
const ATLAS_W = 2048;
const ATLAS_H = 4096;
const RING_MM = RING_ROWS / DOTS;
const HEAT_CELL = 2.5;
const HEAT_COLS = 32;
const HEAT_ROWS = 1638;
const HEAT_SCALE = 2;
const GRID = 4;
const GRID_X0 = -480;
const GRID_Z0 = -720;
const GRID_N = 240;
const FOV = 25;
const ELEVATION = 0.97;
const TEAR_PULL = 9;
const LIFT = 22;
const MAX_FREE = 10;
const FEED_SPEED = 118;
const LINE_PAUSE = 0.034;
const ROLL_K = 0.42;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

function deskCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  let s = 17;
  for (let i = 0; i < size * size; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const n = (s / 4294967296 - 0.5) * 7;
    const x = i % size;
    const y = Math.floor(i / size);
    const fibre = Math.sin(x * 0.09 + Math.sin(y * 0.013) * 3) * 1.6;
    img.data[i * 4] = 216 + n + fibre;
    img.data[i * 4 + 1] = 212 + n + fibre;
    img.data[i * 4 + 2] = 204 + n + fibre;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function createReceipt({ host, root, embedded, reduced, onState, onLive }) {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const printer = await buildPrinter(THREE);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0xd6d3cc);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.className = "receipt-canvas";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 20, 6000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.32;

  const hemi = new THREE.HemisphereLight(0xfdfcf8, 0xc9c2b4, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.5);
  key.position.set(-300, 620, -420);
  key.target.position.set(0, 0, -60);
  key.castShadow = true;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.camera.left = -360;
  key.shadow.camera.right = 360;
  key.shadow.camera.top = 360;
  key.shadow.camera.bottom = -360;
  key.shadow.camera.near = 200;
  key.shadow.camera.far = 1400;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.2;
  key.shadow.radius = 9;
  key.shadow.blurSamples = 16;
  scene.add(key);
  scene.add(key.target);

  const deskTex = new THREE.CanvasTexture(deskCanvas(256));
  deskTex.colorSpace = THREE.SRGBColorSpace;
  deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping;
  deskTex.repeat.set(30, 30);
  deskTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.93, metalness: 0 }));
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  scene.add(desk);
  scene.add(printer.group);

  const atlasData = new Uint8Array(ATLAS_W * ATLAS_H);
  const atlas = new THREE.DataTexture(atlasData, ATLAS_W, ATLAS_H, THREE.RedFormat, THREE.UnsignedByteType);
  atlas.minFilter = THREE.LinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
  const heatField = new Float32Array(HEAT_COLS * HEAT_ROWS);
  const heatBytes = new Uint8Array(HEAT_COLS * HEAT_ROWS);
  const heatScratch = new Float32Array(HEAT_COLS * HEAT_ROWS);
  const heatTex = new THREE.DataTexture(heatBytes, HEAT_COLS, HEAT_ROWS, THREE.RedFormat, THREE.UnsignedByteType);
  heatTex.minFilter = THREE.LinearFilter;
  heatTex.magFilter = THREE.LinearFilter;
  heatTex.wrapT = THREE.RepeatWrapping;
  heatTex.generateMipmaps = false;
  heatTex.needsUpdate = true;
  const shared = {
    atlas: { value: atlas },
    heat: { value: heatTex },
    ring: { value: new THREE.Vector4(RING_ROWS, ATLAS_H, TEX_W, ATLAS_W) },
    heatGrid: { value: new THREE.Vector3(HEAT_CELL, HEAT_ROWS, HEAT_SCALE) },
  };
  renderer.initTexture(atlas);

  const grid = new Float32Array(GRID_N * GRID_N);
  const view = { width: 1, height: 1, dpr: 1 };
  const env = {
    exitS: 0,
    dirA: Math.cos(PRINTER.exitAngle),
    dirH: Math.sin(PRINTER.exitAngle),
    exitH: PRINTER.exitY,
    friction: 0.3,
    grip: 0.96,
    floorAt,
  };

  const pieces = [];
  let strip = null;
  let nextIndex = 0;
  let seedCount = 11;
  let job = null;
  let rollBase = 0;
  let rollAngle = 0;
  let rollShown = PRINTER.rollMax;
  let pileAnchor = { x: 175, z: -110, yaw: 0.28 };
  let grab = null;
  let auto = null;
  let pointer = { inside: false, x: 0, y: 0, type: "mouse", down: false };
  let hoverKind = "";
  let heatLive = false;
  let ledLevel = 0;
  let feedPress = 0;
  let active = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let ready = false;
  let shadowDirty = true;
  let lastState = "";
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const held = new THREE.Vector3();
  const heldV = new THREE.Vector3();
  const handPrev = new THREE.Vector3();
  const handVel = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const W = { x: 0, y: 0, z: 0 };

  function floorAt(x, z) {
    let f = 0;
    if (Math.abs(x) < PRINTER.halfW + 0.5 && z > -0.6 && z < PRINTER.depth + 0.5) f = PRINTER.top;
    const gx = (x - GRID_X0) / GRID - 0.5;
    const gz = (z - GRID_Z0) / GRID - 0.5;
    if (gx < 0 || gz < 0 || gx >= GRID_N - 1 || gz >= GRID_N - 1) return f;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const o = iz * GRID_N + ix;
    const near = Math.max(grid[o], grid[o + 1], grid[o + GRID_N], grid[o + GRID_N + 1]);
    const top = grid[o] * (1 - fx) * (1 - fz) + grid[o + 1] * fx * (1 - fz) + grid[o + GRID_N] * (1 - fx) * fz + grid[o + GRID_N + 1] * fx * fz;
    return Math.max(f, top * 0.4 + near * 0.6);
  }

  function rasterPile() {
    grid.fill(0);
    for (const piece of pieces) {
      if (piece.kind !== "free" || !piece.resting || piece.removing) continue;
      const pos = piece.view.geometry.attributes.position.array;
      const nor = piece.view.geometry.attributes.normal.array;
      const count = piece.view.rows * 13;
      for (let i = 0; i < count; i += 1) {
        if (Math.abs(nor[i * 3 + 1]) < 0.6) continue;
        const y = pos[i * 3 + 1];
        if (y > 14) continue;
        const gx = Math.round((pos[i * 3] - GRID_X0) / GRID - 0.5);
        const gz = Math.round((pos[i * 3 + 2] - GRID_Z0) / GRID - 0.5);
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = gx + dx;
            const z = gz + dz;
            if (x < 0 || z < 0 || x >= GRID_N || z >= GRID_N) continue;
            const o = z * GRID_N + x;
            if (y + 0.5 > grid[o]) grid[o] = y + 0.5;
          }
        }
      }
    }
  }

  function uploadTicket(index, startS) {
    const { data, rows } = rasterTicket(index, monoFont);
    const t0 = Math.round(startS * DOTS);
    let r = 0;
    while (r < rows) {
      const t = (((t0 + r) % RING_ROWS) + RING_ROWS) % RING_ROWS;
      const col = Math.floor(t / ATLAS_H);
      const row = t - col * ATLAS_H;
      const n = Math.min(rows - r, ATLAS_H - row);
      for (let k = 0; k < n; k += 1) {
        atlasData.set(data.subarray((r + k) * TEX_W, (r + k + 1) * TEX_W), (row + k) * ATLAS_W + col * TEX_W);
      }
      const src = new THREE.DataTexture(data.subarray(r * TEX_W, (r + n) * TEX_W), TEX_W, n, THREE.RedFormat, THREE.UnsignedByteType);
      renderer.copyTextureToTexture(src, atlas, null, new THREE.Vector2(col * TEX_W, row));
      src.dispose();
      r += n;
    }
  }

  function makePiece(kind, lead, tail, maxLen) {
    seedCount += 1;
    const seed = seedCount * 7.31;
    const piece = {
      kind,
      pts: [],
      virt: kind === "strip" ? { a: 0, h: 0 } : null,
      yaw: 0,
      baseYaw: 0,
      yawV: 0,
      ox: 0,
      oz: PRINTER.exitZ,
      perp: 0,
      pv: 0,
      lift: 0,
      seed,
      curlBase: edgeRange(lead)[0],
      curlTail: tail ? edgeRange(tail)[1] : 0,
      exitS: kind === "strip" ? env.exitS : 1e9,
      grab: null,
      lead,
      tail,
      twist: (hash(seed) - 0.5) * 0.16,
      wander: 0.5 + hash(seed + 1) * 0.6,
      cup: 0.9,
      still: 0,
      awake: true,
      resting: false,
      spin: 0,
      fade: 1,
      removing: false,
    };
    piece.view = makePaperMesh(THREE, shared, piece, Math.ceil(maxLen / 1.4) + 24);
    scene.add(piece.view.mesh);
    pieces.push(piece);
    return piece;
  }

  function setEdges(piece) {
    const u = piece.view.material.userData.uniforms;
    u.uLead.value = piece.lead;
    u.uTail.value = piece.tail || piece.lead;
    u.uHasTail.value = piece.tail ? 1 : 0;
  }

  function newStrip(leadEdge) {
    const s = makePiece("strip", leadEdge, null, 520);
    const [lo] = edgeRange(leadEdge);
    const sR = Math.min(lo - 0.6, env.exitS - 0.4);
    const out = env.exitS - sR;
    s.pts.push(makePoint(sR, env.dirA * out, env.exitH + env.dirH * out, true));
    s.baseYaw = (hash(s.seed + 3) - 0.5) * 0.05;
    s.yaw = s.baseYaw;
    strip = s;
    return s;
  }

  function lineTimeline(index) {
    const stops = lineStops(index);
    const times = [];
    let t = 0;
    let prev = 0;
    for (const stop of stops) {
      const len = stop - prev;
      const move = len / FEED_SPEED;
      times.push({ t0: t, t1: t + move, s0: prev, s1: stop });
      t += move + LINE_PAUSE;
      prev = stop;
    }
    return { times, total: t, len: prev };
  }

  function feedAt(timeline, t) {
    for (const seg of timeline.times) {
      if (t < seg.t0) return seg.s0;
      if (t <= seg.t1) return seg.s0 + (seg.s1 - seg.s0) * smooth((t - seg.t0) / (seg.t1 - seg.t0));
    }
    return timeline.len;
  }

  function stripLength() {
    if (!strip) return 0;
    return env.exitS - edgeRange(strip.lead)[0];
  }

  function canPrint() {
    return ready && !job && stripLength() < 330;
  }

  function emitState() {
    const state = `${ready ? 1 : 0}${job ? 1 : 0}${canPrint() ? 1 : 0}${hoverKind}`;
    if (state === lastState) return;
    lastState = state;
    onState?.({ ready, printing: Boolean(job), canPrint: canPrint(), hover: hoverKind });
  }

  function startJob(index, instant) {
    const startS = env.exitS - 0.8;
    uploadTicket(index, startS);
    const timeline = lineTimeline(index);
    const used = env.exitS - rollBase;
    if (PRINTER.rollMax * PRINTER.rollMax - ROLL_K * (used + timeline.len) < 15 * 15) rollBase = env.exitS;
    job = { index, base: env.exitS, startS, timeline, t: 0 };
    strip.awake = true;
    if (instant) {
      runFeed(timeline.total + 0.1, true);
    }
    onLive?.(`Printing ${SETS[index % SETS.length].label.toLowerCase()}`);
    emitState();
  }

  function runFeed(seconds, settle) {
    const frames = Math.ceil(seconds * 60);
    for (let f = 0; f < frames; f += 1) tickFeed(1 / 60);
    if (settle) for (let f = 0; f < 120; f += 1) simulate(1 / 60);
  }

  function tickFeed(dt) {
    if (!job) return;
    job.t += dt;
    const fed = feedAt(job.timeline, job.t);
    const target = job.base + fed;
    if (target > env.exitS) {
      const delta = target - env.exitS;
      env.exitS = target;
      const r = Math.max(PRINTER.rollCore + 1, rollRadius());
      rollAngle -= delta / r;
    }
    strip.exitS = env.exitS;
    feedStrip(strip, env);
    strip.awake = true;
    strip.still = 0;
    if (job.t >= job.timeline.total) {
      job = null;
      emitState();
    }
    simulate(dt);
  }

  function rollRadius() {
    const used = env.exitS - rollBase;
    return Math.sqrt(Math.max(PRINTER.rollCore * PRINTER.rollCore, PRINTER.rollMax * PRINTER.rollMax - ROLL_K * used));
  }

  function simulate(dt) {
    const steps = Math.max(SUB, Math.ceil(dt * 480));
    const h = dt / steps;
    for (const piece of pieces) {
      if (!piece.awake || piece.removing) continue;
      if (piece === strip) {
        piece.exitS = env.exitS;
        const target = piece.grab ? piece.yawTarget : piece.baseYaw;
        const w = piece.grab ? 9 : 2.6;
        piece.yawV += (w * w * (target - piece.yaw) - 2 * w * piece.yawV) * dt;
        piece.yaw += piece.yawV * dt;
      } else if (Math.abs(piece.spin) > 1e-4) {
        spinPiece(piece, piece.spin * dt);
        piece.spin *= Math.exp(-(piece.contacts > 2 ? 10 : 1.2) * dt);
      }
      const before = piece.pts.map((p) => p.a + p.h * 1.37);
      for (let i = 0; i < steps; i += 1) stepPiece(piece, h, env);
      let moved = Math.abs(piece.pv) * dt + (piece === strip ? Math.abs(piece.yawV) * 200 * dt : 0);
      piece.pts.forEach((p, i) => {
        moved = Math.max(moved, Math.abs(p.a + p.h * 1.37 - before[i]));
      });
      piece.view.dirty = true;
      if (moved < 0.05 && !piece.grab && !(piece === strip && job) && Math.abs(piece.spin) < 0.01) {
        piece.still += 1;
        if (piece.still > 30) {
          piece.awake = false;
          for (const p of piece.pts) p.va = p.vh = 0;
          piece.pv = 0;
          if (piece.kind === "free" && !piece.resting) {
            piece.resting = true;
            updatePaperMesh(piece.view, piece, env);
            rasterPile();
          }
        }
      } else piece.still = 0;
    }
  }

  function centroid(piece, out) {
    let x = 0;
    let z = 0;
    for (const p of piece.pts) {
      worldOf(piece, p.a, p.h, W);
      x += W.x;
      z += W.z;
    }
    out.x = x / piece.pts.length;
    out.z = z / piece.pts.length;
    return out;
  }

  function spinPiece(piece, dYaw) {
    const c = centroid(piece, { x: 0, z: 0 });
    piece.yaw += dYaw;
    const c2 = centroid(piece, { x: 0, z: 0 });
    piece.ox += c.x - c2.x;
    piece.oz += c.z - c2.z;
  }

  function toPlane(piece, x, z) {
    const sy = Math.sin(piece.yaw);
    const cy = Math.cos(piece.yaw);
    const rx = x - piece.ox;
    const rz = z - piece.oz;
    return { a: rx * sy - rz * cy, p: rx * cy + rz * sy };
  }

  function tear(slantHint) {
    if (!strip || strip.pts.length < 3) return null;
    const torn = strip;
    const sT = env.exitS - 1.6;
    const slant = clamp(slantHint, -0.2, 0.2);
    torn.seed += 0;
    const edge = tearProfile(sT, slant, torn.seed * 1.3 + 2);
    torn.kind = "free";
    torn.tail = edge;
    torn.curlTail = edgeRange(edge)[1];
    torn.exitS = 1e9;
    torn.virt = null;
    for (const p of torn.pts) p.kin = false;
    const [, hi] = edgeRange(edge);
    while (torn.pts.length > 2 && torn.pts[torn.pts.length - 2].s > hi) torn.pts.pop();
    setEdges(torn);
    torn.awake = true;
    torn.still = 0;
    const fresh = newStrip(edge);
    feedStrip(fresh, env);
    onLive?.("Torn off");
    emitState();
    shadowDirty = true;
    return torn;
  }

  function nearestIndex(piece, s) {
    let best = -1;
    let bestD = Infinity;
    piece.pts.forEach((p, i) => {
      if (p.kin) return;
      const d = Math.abs(p.s - s);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function setPointerRay(x, y) {
    ndc.set((x / view.width) * 2 - 1, -(y / view.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function pickPaper(x, y) {
    setPointerRay(x, y);
    const meshes = [];
    for (const piece of pieces) if (!piece.removing) meshes.push(piece.view.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const piece = hit.object.userData.piece;
      if (!hit.uv) continue;
      const u = hit.uv.x;
      const s = hit.uv.y;
      const k = clamp(Math.round(u * (EDGE_N - 1)), 0, EDGE_N - 1);
      if (s < piece.lead[k]) continue;
      if (piece.tail && s > piece.tail[k]) continue;
      if (piece === strip && s > env.exitS + 0.5) continue;
      return { piece, u, s, point: hit.point.clone() };
    }
    return null;
  }

  function pickPrinter(x, y) {
    setPointerRay(x, y);
    return raycaster.intersectObjects(printer.hits, false).length > 0;
  }

  function beginGrab(hit, id, type) {
    const piece = hit.piece;
    const i = nearestIndex(piece, hit.s);
    if (i < 0) return false;
    if (piece.kind === "free" && piece.resting) {
      piece.resting = false;
      rasterPile();
    }
    piece.awake = true;
    piece.still = 0;
    piece.spin = 0;
    const pt = piece.pts[i];
    grab = { piece, id, type, y0: hit.point.y, lift: 0, t: 0, excess: 0, offA: 0, offH: 0, clampA: 0, clampH: 0 };
    hand.copy(hit.point);
    held.copy(hit.point);
    heldV.set(0, 0, 0);
    handPrev.copy(hand);
    handVel.set(0, 0, 0);
    const pl = toPlane(piece, hit.point.x, hit.point.z);
    grab.offA = pt.a - pl.a;
    grab.offH = pt.h - hit.point.y;
    grab.lat = piece.kind === "free" ? pl.p - piece.perp : 0;
    piece.grab = { i, ta: pt.a, th: pt.h, tp: piece.kind === "free" ? pl.p : 0 };
    piece.yawTarget = piece.yaw;
    if (piece === strip) for (const p of piece.pts) p.age = Math.max(p.age, 0);
    root.dataset.grabbing = "";
    return true;
  }

  function endGrab() {
    if (!grab) return;
    const piece = grab.piece;
    piece.grab = null;
    if (piece.kind === "free") {
      const sideways = handVel.x * Math.cos(piece.yaw) + handVel.z * Math.sin(piece.yaw);
      piece.spin = clamp(sideways / 900, -1.4, 1.4) * (hash(piece.seed + grab.t) > 0.5 ? 1 : -1) * 0.6;
      for (const p of piece.pts) {
        p.va = clamp(p.va, -1600, 1600);
        p.vh = clamp(p.vh, -1600, 1600);
      }
      piece.pv = clamp(piece.pv, -1600, 1600);
    }
    piece.awake = true;
    piece.still = 0;
    grab = null;
    delete root.dataset.grabbing;
    trimPile();
    wake();
  }

  function trimPile() {
    const free = pieces.filter((p) => p.kind === "free" && !p.removing);
    if (free.length <= MAX_FREE) return;
    const oldest = free.find((p) => p.resting && !p.grab);
    if (oldest) oldest.removing = true;
  }

  function updateHand(dt) {
    if (!grab) return;
    grab.t += dt;
    const piece = grab.piece;
    grab.lift += (LIFT - grab.lift) * (1 - Math.exp(-dt / 0.13));
    const y = grab.y0 + grab.lift;
    if (auto) {
      hand.copy(auto.at(grab.t));
    } else {
      setPointerRay(pointer.x, pointer.y);
      plane.constant = -y;
      const hit = raycaster.ray.intersectPlane(plane, tmpV);
      if (hit) hand.set(clamp(hit.x, -700, 700), y, clamp(hit.z, -900, 400));
    }
    const w = reduced ? 60 : 26;
    const n = Math.max(1, Math.ceil(dt * w * 3));
    const h = dt / n;
    for (let i = 0; i < n; i += 1) {
      heldV.x += (w * w * (hand.x - held.x) - 2 * w * heldV.x) * h;
      heldV.y += (w * w * (hand.y - held.y) - 2 * w * heldV.y) * h;
      heldV.z += (w * w * (hand.z - held.z) - 2 * w * heldV.z) * h;
      held.addScaledVector(heldV, h);
    }
    if (dt > 0) {
      const k = 1 - Math.exp(-dt / 0.05);
      handVel.x += ((held.x - handPrev.x) / dt - handVel.x) * k;
      handVel.y += ((held.y - handPrev.y) / dt - handVel.y) * k;
      handVel.z += ((held.z - handPrev.z) / dt - handVel.z) * k;
    }
    handPrev.copy(held);
    const pl = toPlane(piece, held.x, held.z);
    let ta = pl.a;
    let th = held.y;
    grab.excess = 0;
    if (piece === strip) {
      const g = piece.pts[piece.grab.i];
      const reach = Math.hypot(held.x - piece.ox, held.z - piece.oz);
      const want = Math.atan2(held.x - piece.ox, -(held.z - piece.oz));
      const weight = clamp((reach - 30) / 60, 0, 1) * clamp((g.a - 20) / 40, 0, 1);
      piece.yawTarget = piece.baseYaw + clamp(want - piece.baseYaw, -0.42, 0.42) * weight;
      const L = env.exitS - g.s;
      const d = Math.hypot(ta, th - env.exitH);
      if (d > L && d > 0) {
        grab.excess = d - L;
        ta *= L / d;
        th = env.exitH + ((th - env.exitH) * L) / d;
      }
      grab.clampA = ta;
      grab.clampH = th;
    }
    grab.offA *= Math.exp(-dt / 0.07);
    grab.offH *= Math.exp(-dt / 0.07);
    piece.grab.ta = ta + grab.offA;
    piece.grab.th = th + grab.offH;
    piece.grab.tp = pl.p - (grab.lat || 0);
  }

  function checkTear() {
    if (!grab || grab.piece !== strip) return;
    if (grab.excess > TEAR_PULL && grab.t > 0.1) {
      const piece = strip;
      const angle = Math.atan2(held.x - piece.ox, -(held.z - piece.oz)) - piece.baseYaw;
      const torn = tear(angle * 0.55);
      if (torn) {
        const pl = toPlane(torn, held.x, held.z);
        grab.offA = grab.clampA - pl.a;
        grab.offH = grab.clampH - held.y;
        grab.lat = pl.p - torn.perp;
        grab.piece = torn;
      }
    }
  }

  function depositHeat(u, s, dt) {
    const cx = u * HEAT_COLS - 0.5;
    const cy = s / HEAT_CELL;
    const rate = 5.2 * dt;
    for (let dy = -4; dy <= 4; dy += 1) {
      const row = (((Math.round(cy) + dy) % HEAT_ROWS) + HEAT_ROWS) % HEAT_ROWS;
      const ry = Math.round(cy) + dy - cy;
      for (let dx = -4; dx <= 4; dx += 1) {
        const col = Math.round(cx) + dx;
        if (col < 0 || col >= HEAT_COLS) continue;
        const rx = col - cx;
        const w = Math.exp(-(rx * rx + ry * ry) / (2 * 1.5 * 1.5));
        const o = row * HEAT_COLS + col;
        heatField[o] = Math.min(HEAT_SCALE, heatField[o] + rate * w);
      }
    }
    heatLive = true;
  }

  function stepHeat(dt) {
    if (!heatLive) return;
    const D = 18 / (HEAT_CELL * HEAT_CELL);
    const cool = Math.exp(-dt / 2.2);
    let peak = 0;
    heatScratch.set(heatField);
    for (let r = 0; r < HEAT_ROWS; r += 1) {
      const up = ((r + HEAT_ROWS - 1) % HEAT_ROWS) * HEAT_COLS;
      const dn = ((r + 1) % HEAT_ROWS) * HEAT_COLS;
      const row = r * HEAT_COLS;
      for (let c = 0; c < HEAT_COLS; c += 1) {
        const o = row + c;
        const v = heatScratch[o];
        const l = heatScratch[row + Math.max(0, c - 1)];
        const rr = heatScratch[row + Math.min(HEAT_COLS - 1, c + 1)];
        const lap = l + rr + heatScratch[up + c] + heatScratch[dn + c] - 4 * v;
        let nv = (v + D * lap * dt) * cool - 0.004 * dt;
        if (nv < 0) nv = 0;
        heatField[o] = nv;
        heatBytes[o] = Math.min(255, Math.round((nv / HEAT_SCALE) * 255));
        if (nv > peak) peak = nv;
      }
    }
    heatTex.needsUpdate = true;
    if (peak < 0.003) {
      heatField.fill(0);
      heatBytes.fill(0);
      heatLive = false;
    }
  }

  function hover(dt) {
    if (!pointer.inside || pointer.type !== "mouse") {
      setHover("");
      return false;
    }
    if (grab) {
      setHover("paper");
      const hit = pickPaper(pointer.x, pointer.y);
      if (hit) depositHeat(hit.u, hit.s, dt * 0.6);
      return true;
    }
    const hit = pickPaper(pointer.x, pointer.y);
    if (hit) {
      setHover("paper");
      depositHeat(hit.u, hit.s, dt);
      return true;
    }
    setHover(pickPrinter(pointer.x, pointer.y) ? "printer" : "");
    return false;
  }

  function setHover(kind) {
    if (kind === hoverKind) return;
    hoverKind = kind;
    if (kind) root.dataset.hover = kind;
    else delete root.dataset.hover;
  }

  function busy() {
    if (job || grab || heatLive || auto || feedPress > 0.001) return true;
    if (Math.abs(rollShown - rollRadius()) > 0.01) return true;
    if (Math.abs(ledLevel - (job ? 1 : 0)) > 0.01) return true;
    return pieces.some((p) => p.awake || p.removing);
  }

  function render() {
    for (const piece of pieces) {
      if (piece.view.dirty || !piece.view.rows) {
        updatePaperMesh(piece.view, piece, env);
        piece.view.dirty = false;
        shadowDirty = true;
      }
    }
    const radius = rollRadius();
    rollShown += (radius - rollShown) * (Math.abs(radius - rollShown) > 3 ? 0.08 : 1);
    printer.setRoll(rollShown, rollAngle);
    printer.setLed(ledLevel);
    printer.pressFeed(feedPress);
    if (shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = 0;
    if (!active || destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 1 / 240, 1 / 30) : 1 / 60;
    last = now;
    updateHand(dt);
    if (auto) auto.tick(dt);
    if (job) tickFeed(dt);
    else simulate(dt);
    checkTear();
    const hovering = hover(dt);
    stepHeat(dt);
    ledLevel += ((job ? 1 : 0) - ledLevel) * (1 - Math.exp(-dt / 0.08));
    if (job) ledLevel = 0.75 + 0.25 * Math.sin(now * 0.03);
    feedPress *= Math.exp(-dt * 9);
    if (feedPress < 0.002) feedPress = 0;
    for (const piece of pieces.slice()) {
      if (!piece.removing) continue;
      piece.fade -= dt / 0.7;
      piece.view.material.userData.uniforms.uFade.value = Math.max(0, piece.fade);
      shadowDirty = true;
      if (piece.fade <= 0) dropPiece(piece);
    }
    render();
    if (busy() || hovering) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function dropPiece(piece) {
    scene.remove(piece.view.mesh);
    piece.view.geometry.dispose();
    piece.view.material.dispose();
    pieces.splice(pieces.indexOf(piece), 1);
    rasterPile();
  }

  function wake() {
    if (raf || !active || destroyed || !ready) return;
    raf = requestAnimationFrame(frame);
  }

  function project(points) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      tmpV.set(p[0], p[1], p[2]).project(camera);
      minX = Math.min(minX, tmpV.x);
      maxX = Math.max(maxX, tmpV.x);
      minY = Math.min(minY, tmpV.y);
      maxY = Math.max(maxY, tmpV.y);
    }
    return { minX, maxX, minY, maxY };
  }

  function insets() {
    const narrow = view.width < 720;
    if (embedded) return { top: 12, bottom: 12, side: 12 };
    if (narrow) return { top: 136, bottom: 84, side: 16 };
    return { top: 92, bottom: 20, side: 24 };
  }

  function layout() {
    camera.aspect = view.width / view.height;
    camera.updateProjectionMatrix();
    const len = ticketLength(0);
    const keys = [
      [-PRINTER.halfW, 0, PRINTER.depth],
      [PRINTER.halfW, 0, PRINTER.depth],
      [-PRINTER.halfW, PRINTER.rollFloor + PRINTER.rollMax * 2, PRINTER.rollZ],
      [PRINTER.halfW, PRINTER.rollFloor + PRINTER.rollMax * 2, PRINTER.rollZ],
      [-46, 0, -len + 12],
      [46, 0, -len + 12],
      [-46, 34, -len + 30],
      [46, 34, -len + 30],
    ];
    const pad = insets();
    const allowX0 = -1 + (2 * pad.side) / view.width;
    const allowX1 = 1 - (2 * pad.side) / view.width;
    const allowY1 = 1 - (2 * pad.top) / view.height;
    const allowY0 = -1 + (2 * pad.bottom) / view.height;
    const dir = new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
    const target = new THREE.Vector3(0, 0, -len * 0.3);
    let dist = 700;
    for (let iter = 0; iter < 4; iter += 1) {
      let lo = 150;
      let hi = 4000;
      for (let k = 0; k < 26; k += 1) {
        const mid = (lo + hi) / 2;
        camera.position.copy(target).addScaledVector(dir, mid);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        const b = project(keys);
        const fits = b.minX >= allowX0 && b.maxX <= allowX1 && b.minY >= allowY0 && b.maxY <= allowY1;
        if (fits) hi = mid;
        else lo = mid;
      }
      dist = hi;
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const b = project(keys);
      const shiftY = (allowY0 + allowY1) / 2 - (b.minY + b.maxY) / 2;
      const shiftX = (allowX0 + allowX1) / 2 - (b.minX + b.maxX) / 2;
      const spanY = Math.tan((FOV * Math.PI) / 360) * dist;
      target.z += shiftY * spanY * 1.2;
      target.x -= shiftX * spanY * camera.aspect;
    }
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const wide = view.width / view.height > 1.05 && view.width >= 720;
    if (wide) {
      setPointerRay(view.width * 0.8, view.height * 0.46);
      plane.constant = 0;
      const hit = raycaster.ray.intersectPlane(plane, tmpV);
      if (hit) pileAnchor = { x: Math.max(150, hit.x), z: hit.z, yaw: 0.3 };
    } else pileAnchor = null;
  }

  function resize() {
    const rect = host.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const budget = Math.sqrt(2600000 / Math.max(1, view.width * view.height));
    view.dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2, budget));
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.width, view.height, false);
    layout();
    if (ready) {
      shadowDirty = true;
      render();
    }
  }

  function seedPile() {
    if (!pileAnchor) return;
    const spots = [
      { dx: 0, dz: 0, yaw: 0.34 },
      { dx: -18, dz: 26, yaw: -0.16 },
    ];
    for (const spot of spots) {
      const index = nextIndex;
      nextIndex += 1;
      const len = ticketLength(index);
      const s0 = env.exitS;
      const lead = tearProfile(s0 - 1.6, (hash(s0) - 0.5) * 0.2, s0 + 3);
      const tailS = s0 + len - 0.6;
      const tail = tearProfile(tailS, (hash(s0 + 9) - 0.5) * 0.24, s0 + 5);
      uploadTicket(index, s0 - 0.8);
      const piece = makePiece("free", lead, tail, len + 20);
      piece.yaw = spot.yaw + pileAnchor.yaw;
      piece.ox = pileAnchor.x + spot.dx;
      piece.oz = pileAnchor.z + spot.dz;
      const half = len / 2;
      for (let s = s0 - 2; s <= tailS + SEG; s += SEG) piece.pts.push(makePoint(s, half - (s - s0), 18, false));
      env.exitS = s0 + len + 0.4;
      for (let f = 0; f < 150; f += 1) simulate(1 / 60);
      piece.awake = false;
      piece.resting = true;
      updatePaperMesh(piece.view, piece, env);
      rasterPile();
    }
  }

  let monoFont = "ui-monospace, monospace";

  async function fonts() {
    const probe = document.createElement("span");
    probe.style.fontFamily = "var(--font-mono)";
    root.appendChild(probe);
    const value = getComputedStyle(probe).fontFamily;
    probe.remove();
    if (value) monoFont = value;
    try {
      await Promise.all([document.fonts.load(`520 25px ${monoFont}`), document.fonts.load(`680 25px ${monoFont}`)]);
    } catch {}
  }

  await fonts();
  if (destroyed) return null;
  resize();
  env.exitS = 120;
  rollBase = 0;
  seedPile();
  newStrip(tearProfile(env.exitS - 1.6, 0.04, 3.3));
  feedStrip(strip, env);
  const firstIndex = nextIndex;
  nextIndex += 1;
  startJob(firstIndex, true);
  rollShown = rollRadius();
  ready = true;
  emitState();
  render();
  root.dataset.ready = "";

  function local(e) {
    const rect = host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!ready) return;
    const [x, y] = local(e);
    pointer = { inside: true, x, y, type: e.pointerType, down: true };
    if (grab || auto) return;
    const hit = pickPaper(x, y);
    if (hit) {
      if (beginGrab(hit, e.pointerId, e.pointerType)) {
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        wake();
      }
      return;
    }
    if (pickPrinter(x, y)) {
      feedPress = 1;
      print();
      wake();
    }
  }

  function onMove(e) {
    const [x, y] = local(e);
    pointer.inside = true;
    pointer.x = x;
    pointer.y = y;
    pointer.type = e.pointerType;
    wake();
  }

  function onUp(e) {
    pointer.down = false;
    if (grab && e.pointerId === grab.id) endGrab();
    if (e.pointerType !== "mouse") pointer.inside = false;
  }

  function onLeave(e) {
    if (e.pointerType === "mouse" && !grab) {
      pointer.inside = false;
      setHover("");
    }
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  const ro = new ResizeObserver(() => resize());
  ro.observe(host);

  function print() {
    if (!canPrint()) return false;
    const index = nextIndex;
    nextIndex += 1;
    startJob(index, reduced);
    if (reduced) shadowDirty = true;
    wake();
    return true;
  }

  function autoTear() {
    if (grab || auto || !strip || strip.pts.length < 6) return;
    const tip = strip.pts[1];
    worldOf(strip, tip.a, tip.h, W);
    const start = new THREE.Vector3(W.x, W.y, W.z);
    const fake = { piece: strip, u: 0.5, s: tip.s, point: start.clone() };
    if (!beginGrab(fake, -1, "auto")) return;
    const away = new THREE.Vector3(start.x + 14, start.y + LIFT, start.z - 70);
    const drop = pileAnchor ? new THREE.Vector3(pileAnchor.x, 40, pileAnchor.z + 30) : new THREE.Vector3(start.x - 30, 40, start.z + 20);
    auto = {
      time: 0,
      at(t) {
        if (t < 0.5) return tmpV.copy(start).lerp(away, smooth(t / 0.5));
        const k = smooth(clamp((t - 0.5) / 0.7, 0, 1));
        return tmpV.copy(away).lerp(drop, k);
      },
      tick(dt) {
        this.time += dt;
        if (this.time > 1.3) {
          auto = null;
          endGrab();
        }
      },
    };
    wake();
  }

  return {
    print,
    tear: autoTear,
    setActive(on) {
      active = on;
      if (on) {
        shadowDirty = true;
        render();
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      for (const piece of pieces) {
        piece.view.geometry.dispose();
        piece.view.material.dispose();
      }
      printer.dispose();
      atlas.dispose();
      heatTex.dispose();
      deskTex.dispose();
      desk.geometry.dispose();
      desk.material.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
