import { frontNormal, liveFold, makeRecord, makeSheet, replayFold, worldPoint } from "./origamiFold";
import { backCanvas, creasePainter, feltCanvas, fibreCanvas, frontCanvas, loadImage, sheetSize } from "./origamiPaper";
import { FRAGMENT_HEAD, FRAGMENT_MAP, FRAGMENT_NORMAL, VERTEX_BODY, VERTEX_HEAD } from "./origamiShader";

const CARD = "/flyout/card-03.jpg";
const THICK = 0.0052;
const R_CRISP = THICK / 2;
const R_SOFT = 0.022;
const CHORDS_LIVE = 9;
const CHORDS_SET = 2;
const SPRING_BACK = 0.11;
const PRESS = 0.012;
const MAX_FOLDS = 6;
const LIFT = 0.3;
const LIFT_GAIN = 1.25;
const FLOAT = 0.01;
const FOV = 24;
const TILT = 0.15;
const GRAVITY = 30;
const AIR = 4.2;
const MAX_SPIN = 11;
const SUB = 1 / 240;
const START_PX = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const PRESETS = [
  { angle: 45, f: 0.15 },
  { angle: 270, f: 0.5 },
  { angle: 180, f: 0.5 },
  { angle: 120, f: 0.34 },
  { angle: 0, f: 0.42 },
  { angle: 90, f: 0.5 },
];

export async function createOrigami({ host, root, embedded, reduced, insets, onState }) {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const img = await loadImage(CARD);
  const sheet = sheetSize(img);

  const dprCap = Math.min(2, window.devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({ antialias: dprCap < 2, powerPreference: "high-performance" });
  renderer.setClearColor(0x1d201d);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.className = "origami-canvas";
  host.appendChild(canvas);
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.2, 40);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  pmrem.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.1;

  const hemi = new THREE.HemisphereLight(0xfff6e8, 0x2e302b, 0.3);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xfff0dc, 5.4, 0, 0.62, 0.8, 0);
  key.position.set(-2.5, 2.6, 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 7;
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  const feltTex = new THREE.CanvasTexture(feltCanvas(512, 7));
  feltTex.colorSpace = THREE.SRGBColorSpace;
  feltTex.wrapS = feltTex.wrapT = THREE.RepeatWrapping;
  feltTex.repeat.set(30, 30);
  feltTex.anisotropy = anisotropy;
  const feltMat = new THREE.MeshStandardMaterial({ color: 0x67756b, map: feltTex, roughness: 1, metalness: 0, bumpMap: feltTex, bumpScale: 0.6 });
  feltMat.envMapIntensity = 0.4;
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), feltMat);
  felt.position.z = -FLOAT - THICK / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const fibre = fibreCanvas(512, 31);
  const texWidth = window.innerWidth < 700 ? 1024 : 1400;
  const frontTex = new THREE.CanvasTexture(frontCanvas(img, fibre, texWidth, sheet));
  const backTex = new THREE.CanvasTexture(backCanvas(img, fibre, Math.round(texWidth * 0.7), sheet));
  for (const tex of [frontTex, backTex]) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = anisotropy;
  }
  const fibreTex = new THREE.CanvasTexture(fibre);
  fibreTex.colorSpace = THREE.NoColorSpace;
  fibreTex.flipY = false;
  fibreTex.wrapS = fibreTex.wrapT = THREE.RepeatWrapping;
  fibreTex.anisotropy = anisotropy;
  const creaseWidth = window.innerWidth < 700 ? 768 : 1024;
  const painter = creasePainter(creaseWidth, sheet, 91);
  const creaseTex = new THREE.CanvasTexture(painter.canvas);
  creaseTex.colorSpace = THREE.NoColorSpace;
  creaseTex.flipY = false;
  creaseTex.anisotropy = anisotropy;
  creaseTex.generateMipmaps = true;
  creaseTex.minFilter = THREE.LinearMipmapLinearFilter;

  const fibreRepeat = [1.7, (1.7 * sheet.height) / sheet.width];
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0, side: THREE.DoubleSide });
  paperMat.envMapIntensity = 0.55;
  const uniforms = {
    uFront: { value: frontTex },
    uBack: { value: backTex },
    uFibre: { value: fibreTex },
    uCrease: { value: creaseTex },
    uCreaseTexel: { value: new THREE.Vector2(1 / painter.canvas.width, 1 / painter.canvas.height) },
    uFibreRepeat: { value: new THREE.Vector2(fibreRepeat[0], fibreRepeat[1]) },
    uFibreTexel: { value: new THREE.Vector2(1 / (512 * fibreRepeat[0]), 1 / (512 * fibreRepeat[1])) },
    uCreaseDepth: { value: 0.0028 },
    uFibreDepth: { value: 0.00005 },
    uCore: { value: new THREE.Color(0xd9ceb6) },
  };
  paperMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace("#include <uv_vertex>", `#include <uv_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader
        .replace("#include <map_fragment>", FRAGMENT_MAP)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`);
  };
  paperMat.customProgramCacheKey = () => "origami-paper";

  const geometry = new THREE.BufferGeometry();
  let capacity = 0;
  const attrs = {};
  function ensureCapacity(count) {
    if (count <= capacity) return;
    capacity = Math.max(4096, Math.ceil(count * 1.5));
    attrs.position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    attrs.normal = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    attrs.uv = new THREE.BufferAttribute(new Float32Array(capacity * 2), 2);
    attrs.aKind = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    for (const [name, attr] of Object.entries(attrs)) {
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
    }
  }
  const paper = new THREE.Mesh(geometry, paperMat);
  paper.castShadow = true;
  paper.receiveShadow = true;
  paper.frustumCulled = false;
  scene.add(paper);

  const view = { width: 1, height: 1, dpr: 1 };
  let base = [makeSheet(sheet.width, sheet.height)];
  let records = [];
  let cache = [];
  let current = base;
  let display = base;
  let drag = null;
  let pending = null;
  let lastTap = null;
  let raf = 0;
  let last = 0;
  let active = false;
  let destroyed = false;
  let dirty = true;
  let creaseDirty = false;
  let presetIndex = 0;
  let introAt = reduced ? -1 : 0.55;
  let liveCache = null;

  const tmp = [0, 0, 0];
  const tmpN = [0, 0, 0];

  function build(pieces) {
    let count = 0;
    for (const p of pieces) {
      const n = p.pts.length / 2;
      count += (n - 2) * 3;
      for (let i = 0; i < n; i += 1) if (p.b[i]) count += 6;
    }
    ensureCapacity(count);
    const pos = attrs.position.array;
    const nor = attrs.normal.array;
    const uv = attrs.uv.array;
    const kind = attrs.aKind.array;
    let o = 0;
    const put = (x, y, z, nx, ny, nz, u, v, k) => {
      pos[o * 3] = x;
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = z;
      nor[o * 3] = nx;
      nor[o * 3 + 1] = ny;
      nor[o * 3 + 2] = nz;
      uv[o * 2] = u / sheet.width;
      uv[o * 2 + 1] = v / sheet.height;
      kind[o] = k;
      o += 1;
    };
    const W = [];
    for (const p of pieces) {
      const n = p.pts.length / 2;
      W.length = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < n; i += 1) {
        const w = worldPoint(p, i, [0, 0, 0]);
        W.push(w);
        cx += w[0] / n;
        cy += w[1] / n;
        cz += w[2] / n;
      }
      const vert = (i) => put(W[i][0], W[i][1], W[i][2], p.nm[i * 3], p.nm[i * 3 + 1], p.nm[i * 3 + 2], p.pts[i * 2], p.pts[i * 2 + 1], 0);
      for (let i = 1; i < n - 1; i += 1) {
        vert(0);
        vert(i + 1);
        vert(i);
      }
      for (let i = 0; i < n; i += 1) {
        if (!p.b[i]) continue;
        const j = (i + 1) % n;
        const a = W[i];
        const b = W[j];
        const na = [p.nm[i * 3], p.nm[i * 3 + 1], p.nm[i * 3 + 2]];
        const nb = [p.nm[j * 3], p.nm[j * 3 + 1], p.nm[j * 3 + 2]];
        const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let ox = e[1] * na[2] - e[2] * na[1];
        let oy = e[2] * na[0] - e[0] * na[2];
        let oz = e[0] * na[1] - e[1] * na[0];
        const mx = (a[0] + b[0]) / 2 - cx;
        const my = (a[1] + b[1]) / 2 - cy;
        const mz = (a[2] + b[2]) / 2 - cz;
        if (ox * mx + oy * my + oz * mz < 0) {
          ox = -ox;
          oy = -oy;
          oz = -oz;
        }
        const ol = Math.hypot(ox, oy, oz) || 1;
        ox /= ol;
        oy /= ol;
        oz /= ol;
        const h = THICK / 2;
        const ua = p.pts[i * 2];
        const va = p.pts[i * 2 + 1];
        const ub = p.pts[j * 2];
        const vb = p.pts[j * 2 + 1];
        const A0 = [a[0] + na[0] * h, a[1] + na[1] * h, a[2] + na[2] * h];
        const A1 = [a[0] - na[0] * h, a[1] - na[1] * h, a[2] - na[2] * h];
        const B0 = [b[0] + nb[0] * h, b[1] + nb[1] * h, b[2] + nb[2] * h];
        const B1 = [b[0] - nb[0] * h, b[1] - nb[1] * h, b[2] - nb[2] * h];
        put(A0[0], A0[1], A0[2], ox, oy, oz, ua, va, 1);
        put(A1[0], A1[1], A1[2], ox, oy, oz, ua, va, 1);
        put(B1[0], B1[1], B1[2], ox, oy, oz, ub, vb, 1);
        put(A0[0], A0[1], A0[2], ox, oy, oz, ua, va, 1);
        put(B1[0], B1[1], B1[2], ox, oy, oz, ub, vb, 1);
        put(B0[0], B0[1], B0[2], ox, oy, oz, ub, vb, 1);
      }
    }
    for (const attr of Object.values(attrs)) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, o * attr.itemSize);
      attr.needsUpdate = true;
    }
    geometry.setDrawRange(0, o);
  }

  function signature(r) {
    return `${r.theta.toFixed(6)}|${r.R.toFixed(7)}|${r.N}`;
  }

  function replay() {
    let from = records.length;
    for (let k = 0; k < records.length; k += 1) {
      if (!cache[k] || cache[k].sig !== signature(records[k])) {
        from = k;
        break;
      }
    }
    if (from === records.length && cache.length === records.length) return false;
    cache.length = from;
    let pieces = from === 0 ? base : cache[from - 1].pieces;
    for (let k = from; k < records.length; k += 1) {
      const r = records[k];
      pieces = replayFold(pieces, r.rec, r.theta, r.R, r.N);
      cache[k] = { sig: signature(r), pieces };
    }
    current = pieces;
    return true;
  }

  function layout() {
    const pad = insets();
    const aspect = view.width / view.height;
    camera.aspect = aspect;
    const availW = Math.max(60, view.width - pad.left - pad.right);
    const availH = Math.max(60, view.height - pad.top - pad.bottom);
    const ppu = Math.min(availW / (sheet.width * 1.06), availH / (sheet.height * 1.04));
    const dist = view.height / (2 * Math.tan((FOV * Math.PI) / 360) * ppu);
    camera.position.set(0, -Math.sin(TILT) * dist, Math.cos(TILT) * dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    const cx = pad.left + availW / 2;
    const cy = pad.top + availH / 2;
    camera.setViewOffset(view.width, view.height, view.width / 2 - cx, view.height / 2 - cy, view.width, view.height);
    camera.near = Math.max(0.05, dist * 0.3);
    camera.far = dist * 3;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function resize() {
    const rect = root.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const budget = Math.sqrt(3200000 / Math.max(1, view.width * view.height));
    view.dpr = Math.max(1, Math.min(dprCap, budget));
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.width, view.height, false);
    layout();
    render();
  }

  const rayO = new THREE.Vector3();
  const rayD = new THREE.Vector3();
  function ray(sx, sy) {
    const x = (sx / view.width) * 2 - 1;
    const y = -(sy / view.height) * 2 + 1;
    rayO.set(x, y, -1).unproject(camera);
    rayD.set(x, y, 0.5).unproject(camera).sub(rayO).normalize();
    return [rayO.x, rayO.y, rayO.z, rayD.x, rayD.y, rayD.z];
  }

  function onPlane(sx, sy, z) {
    const [ox, oy, oz, dx, dy, dz] = ray(sx, sy);
    const t = Math.abs(dz) > 1e-9 ? (z - oz) / dz : 0;
    return [ox + dx * t, oy + dy * t];
  }

  function hit(sx, sy) {
    const [ox, oy, oz, dx, dy, dz] = ray(sx, sy);
    let best = null;
    let near = null;
    for (const p of display) {
      const R = p.R;
      const nx = R[2];
      const ny = R[5];
      const nz = R[8];
      const den = dx * nx + dy * ny + dz * nz;
      if (Math.abs(den) < 1e-6) continue;
      const lam = ((p.t[0] - ox) * nx + (p.t[1] - oy) * ny + (p.t[2] - oz) * nz) / den;
      if (lam <= 0) continue;
      const hx = ox + dx * lam - p.t[0];
      const hy = oy + dy * lam - p.t[1];
      const hz = oz + dz * lam - p.t[2];
      const u = R[0] * hx + R[3] * hy + R[6] * hz;
      const v = R[1] * hx + R[4] * hy + R[7] * hz;
      const dist = outside(p.pts, u, v);
      const world = [ox + dx * lam, oy + dy * lam, oz + dz * lam];
      if (dist <= 0) {
        if (!best || lam < best.lam) best = { lam, world };
      } else if (dist < 0.045 && (!near || dist < near.dist)) near = { dist, lam, world };
    }
    return best || near;
  }

  function outside(pts, u, v) {
    const n = pts.length / 2;
    let worst = -Infinity;
    let sign = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ex = pts[j * 2] - pts[i * 2];
      const ey = pts[j * 2 + 1] - pts[i * 2 + 1];
      const len = Math.hypot(ex, ey) || 1;
      const cr = (ex * (v - pts[i * 2 + 1]) - ey * (u - pts[i * 2])) / len;
      if (!sign && Math.abs(cr) > 1e-12) sign = cr > 0 ? 1 : -1;
      worst = Math.max(worst, -cr * (sign || 1));
    }
    return worst;
  }

  function extentAlong(gx, gy, dx, dy) {
    let far = 0;
    for (const p of current) {
      const n = p.pts.length / 2;
      for (let i = 0; i < n; i += 1) {
        worldPoint(p, i, tmp);
        far = Math.max(far, (tmp[0] - gx) * dx + (tmp[1] - gy) * dy);
      }
    }
    return far;
  }

  function lineFrom(d) {
    const ex = d.C[0] - d.G[0];
    const ey = d.C[1] - d.G[1];
    const raw = Math.hypot(ex, ey);
    if (raw < 1e-5) return null;
    const dx = ex / raw;
    const dy = ey / raw;
    const reach = Math.max(0.02, 2 * (extentAlong(d.G[0], d.G[1], dx, dy) - 0.03));
    const L = reach * Math.tanh(raw / reach);
    let H = LIFT * Math.tanh((LIFT_GAIN * L) / LIFT);
    if (records.length >= MAX_FOLDS) H = Math.max(H, L / Math.tan(0.55));
    const a = (L * L + H * H) / (2 * L);
    return {
      L,
      H,
      theta: 2 * Math.atan2(L, H),
      frame: {
        p: [d.G[0] + dx * a, d.G[1] + dy * a, 0],
        n: [-dx, -dy, 0],
        m: [0, 0, 1],
      },
      a,
      dir: [dx, dy],
    };
  }

  function radiusFor(theta) {
    return R_SOFT + (R_CRISP - R_SOFT) * smooth(2.1, Math.PI - PRESS, theta);
  }

  function commit(theta, frame) {
    const live = liveFold(current, frame, theta, radiusFor(theta), CHORDS_LIVE);
    const rec = makeRecord(current, frame, live.info, live.top);
    const segments = [];
    current.forEach((piece, i) => {
      const it = live.info[i];
      if (!it.split || !it.seg || it.seg.length < 4) return;
      frontNormal(piece, tmpN);
      segments.push({
        a: [it.seg[0], it.seg[1]],
        b: [it.seg[2], it.seg[3]],
        valleyFront: tmpN[0] * frame.m[0] + tmpN[1] * frame.m[1] + tmpN[2] * frame.m[2] > 0,
      });
    });
    painter.draw(segments);
    creaseDirty = true;
    records.push({
      rec,
      theta,
      vel: 0,
      target: Math.PI - SPRING_BACK,
      omega: 5.2,
      zeta: 1.15,
      R: radiusFor(theta),
      Rt: R_CRISP,
      N: CHORDS_LIVE,
      state: "set",
      ramp: 1,
    });
    onState?.({ folds: records.filter((r) => r.state === "set").length, flat: false });
  }

  function stepRecords(dt) {
    let moving = false;
    const queued = records.filter((r) => r.state === "queued");
    if (queued.length && !records.some((r) => r.state === "opening" && r.theta > 1.75)) {
      const next = queued[queued.length - 1];
      next.state = "opening";
      next.target = 0;
      next.omega = 4.6;
      next.zeta = 1;
      next.ramp = 0;
    }
    for (const r of records) {
      if (r.state === "queued") {
        moving = true;
        continue;
      }
      if (reduced) {
        r.theta = r.target;
        r.vel = 0;
        r.R = r.Rt;
        r.N = CHORDS_SET;
        continue;
      }
      r.ramp = Math.min(1, r.ramp + dt / 0.32);
      const w = r.omega * (0.35 + 0.65 * smooth(0, 1, r.ramp));
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        const acc = w * w * (r.target - r.theta) - 2 * r.zeta * w * r.vel;
        r.vel += acc * h;
        r.theta += r.vel * h;
        if (r.state === "opening" && r.theta < 0) {
          r.theta = 0;
          r.vel = 0;
        }
      }
      if (Math.abs(r.target - r.theta) < 2e-4 && Math.abs(r.vel) < 2e-3) {
        r.theta = r.target;
        r.vel = 0;
        if (r.state === "opening") r.state = "open";
      } else moving = true;
      if (r.R !== r.Rt) {
        r.R += (r.Rt - r.R) * (1 - Math.exp(-dt * 16));
        if (Math.abs(r.R - r.Rt) < 2e-6) r.R = r.Rt;
        moving = true;
      }
      if (r.R === r.Rt && r.N !== CHORDS_SET && r.vel === 0) r.N = CHORDS_SET;
    }
    if (records.length && records.every((r) => r.state === "open" && r.vel === 0) && !drag) {
      base = [makeSheet(sheet.width, sheet.height)];
      records = [];
      cache = [];
      current = base;
      dirty = true;
      onState?.({ folds: 0, flat: true });
    }
    return moving;
  }

  function stepDrag(dt) {
    const d = drag;
    if (!d) return false;
    if (d.phase === "drag") {
      const target = onPlane(d.sx, d.sy, d.G[2] + d.H);
      const omega = reduced ? 60 : 24;
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        for (let k = 0; k < 2; k += 1) {
          const acc = omega * omega * (target[k] - d.C[k]) - 2 * omega * d.Cv[k];
          d.Cv[k] += acc * h;
          d.C[k] += d.Cv[k] * h;
        }
      }
      const line = lineFrom(d);
      if (!line) {
        d.theta = 0;
        d.line = null;
        return true;
      }
      d.H = line.H;
      const prev = d.theta;
      d.theta = line.theta;
      d.line = line;
      if (dt > 0) {
        const spin = (d.theta - prev) / dt;
        const k = 1 - Math.exp(-dt / 0.06);
        d.spin += (spin - d.spin) * k;
      }
      return true;
    }
    const steps = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      let acc;
      if (d.phase === "auto") {
        const w = 4.8;
        acc = w * w * (Math.PI + 0.25 - d.theta) - 2 * 0.95 * w * d.spin;
      } else {
        acc = -GRAVITY * Math.cos(d.theta);
        const floor = 4;
        if (Math.abs(acc) < floor) acc = d.theta > Math.PI / 2 && records.length < MAX_FOLDS ? floor : -floor;
        if (records.length >= MAX_FOLDS) acc = -Math.max(floor, Math.abs(acc));
        acc -= AIR * d.spin;
      }
      d.spin = clamp(d.spin + acc * h, -MAX_SPIN, MAX_SPIN);
      d.theta += d.spin * h;
      if (d.theta >= Math.PI - PRESS) {
        const frame = d.line.frame;
        drag = null;
        commit(Math.PI - PRESS, frame);
        return true;
      }
      if (d.theta <= 0) {
        drag = null;
        return true;
      }
    }
    return true;
  }

  function render() {
    renderer.render(scene, camera);
  }

  function refresh() {
    const changed = replay();
    if (drag && drag.line && drag.theta > 1e-5) {
      const r = radiusFor(drag.theta);
      liveCache = liveFold(current, drag.line.frame, drag.theta, r, CHORDS_LIVE);
      display = liveCache.pieces;
      build(display);
      renderer.shadowMap.needsUpdate = true;
      return;
    }
    if (changed || dirty || display !== current) {
      display = current;
      build(display);
      renderer.shadowMap.needsUpdate = true;
      dirty = false;
    }
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60;
    last = now;
    let busy = false;
    if (introAt >= 0) {
      introAt -= dt;
      busy = true;
      if (introAt < 0) {
        introAt = -1;
        autoFold(PRESETS[0]);
        presetIndex = 1;
      }
    }
    if (stepDrag(dt)) busy = true;
    if (stepRecords(dt)) busy = true;
    refresh();
    if (creaseDirty) {
      creaseTex.needsUpdate = true;
      creaseDirty = false;
    }
    render();
    if (busy || drag) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || destroyed || !active) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function autoFold(preset) {
    if (drag || records.length >= MAX_FOLDS || records.some((r) => r.state !== "set")) return false;
    const a = (preset.angle * Math.PI) / 180;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    let hi = -Infinity;
    let lo = Infinity;
    for (const p of current) {
      for (let i = 0; i < p.pts.length / 2; i += 1) {
        worldPoint(p, i, tmp);
        const s = tmp[0] * nx + tmp[1] * ny;
        hi = Math.max(hi, s);
        lo = Math.min(lo, s);
      }
    }
    const at = hi - preset.f * (hi - lo);
    const frame = { p: [nx * at, ny * at, 0], n: [nx, ny, 0], m: [0, 0, 1] };
    if (reduced) {
      commit(Math.PI - PRESS, frame);
      for (const r of records) {
        r.theta = r.target;
        r.R = r.Rt;
        r.N = CHORDS_SET;
      }
      dirty = true;
      wake();
      return true;
    }
    drag = { phase: "auto", theta: 0.001, spin: 0.4, line: { frame }, G: [0, 0, 0], C: [0, 0], Cv: [0, 0], H: 0 };
    wake();
    return true;
  }

  function unfold() {
    if (!records.length || (drag && drag.phase !== "fall")) return false;
    if (records.every((r) => r.state !== "set")) return false;
    introAt = -1;
    for (const r of records) if (r.state === "set") r.state = "queued";
    if (reduced) {
      for (const r of records) {
        r.state = "opening";
        r.target = 0;
      }
    }
    onState?.({ folds: records.length, flat: false, opening: true });
    wake();
    return true;
  }

  function interruptOpening() {
    let changed = false;
    for (const r of records) {
      if (r.state === "queued") {
        r.state = "set";
        changed = true;
      } else if (r.state === "opening") {
        changed = true;
        if (r.theta > Math.PI / 2) {
          r.state = "set";
          r.target = Math.PI - SPRING_BACK;
          r.omega = 5.2;
          r.zeta = 1.15;
        }
      }
    }
    return changed;
  }

  function local(e) {
    const rect = root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    introAt = -1;
    const [sx, sy] = local(e);
    if (drag && drag.phase !== "drag") {
      const d = drag;
      const a = d.line.a ?? 0.2;
      const dir = d.line.dir;
      if (d.phase === "fall" && dir) {
        const s = Math.sin(d.theta / 2);
        const L = 2 * a * s * s;
        const tau = Math.tan(d.theta / 2);
        d.H = tau > 1e-6 ? L / tau : LIFT;
        d.C = [d.G[0] + dir[0] * L, d.G[1] + dir[1] * L];
        const dLdt = a * Math.sin(d.theta) * d.spin;
        d.Cv = [dir[0] * dLdt, dir[1] * dLdt];
        d.phase = "drag";
        d.id = e.pointerId;
        d.sx = sx;
        d.sy = sy;
        canvas.setPointerCapture?.(e.pointerId);
        root.dataset.grabbing = "";
        wake();
        return;
      }
      return;
    }
    interruptOpening();
    const found = hit(sx, sy);
    if (!found) {
      pending = { id: e.pointerId, sx, sy, miss: true };
      return;
    }
    pending = { id: e.pointerId, sx, sy, world: found.world };
    canvas.setPointerCapture?.(e.pointerId);
    wake();
  }

  function onMove(e) {
    const [sx, sy] = local(e);
    if (drag && drag.phase === "drag" && e.pointerId === drag.id) {
      drag.sx = clamp(sx, 0, view.width);
      drag.sy = clamp(sy, 0, view.height);
      wake();
      return;
    }
    if (pending && pending.id === e.pointerId && !pending.miss) {
      if (Math.hypot(sx - pending.sx, sy - pending.sy) < START_PX) return;
      if (records.some((r) => r.state === "queued" || r.state === "opening")) interruptOpening();
      const g = pending.world;
      drag = {
        phase: "drag",
        id: e.pointerId,
        G: [g[0], g[1], g[2]],
        C: [g[0], g[1]],
        Cv: [0, 0],
        H: 0,
        theta: 0,
        spin: 0,
        sx,
        sy,
        line: null,
      };
      pending = null;
      lastTap = null;
      root.dataset.grabbing = "";
      wake();
    }
    if (!drag && e.pointerType === "mouse") {
      if (hit(sx, sy)) root.dataset.over = "";
      else delete root.dataset.over;
    }
  }

  function onUp(e) {
    const [sx, sy] = local(e);
    if (drag && drag.phase === "drag" && e.pointerId === drag.id) {
      delete root.dataset.grabbing;
      if (!drag.line || drag.theta < 1e-4) {
        drag = null;
        dirty = true;
        wake();
        return;
      }
      drag.phase = "fall";
      drag.spin = clamp(drag.spin, -MAX_SPIN, MAX_SPIN);
      if (reduced) {
        const frame = drag.line.frame;
        const go = drag.theta > Math.PI / 2 && records.length < MAX_FOLDS;
        drag = null;
        if (go) {
          commit(Math.PI - PRESS, frame);
          const r = records[records.length - 1];
          r.theta = r.target;
          r.R = r.Rt;
          r.N = CHORDS_SET;
        }
        dirty = true;
      }
      wake();
      return;
    }
    if (pending && pending.id === e.pointerId) {
      pending = null;
      const now = performance.now();
      if (lastTap && now - lastTap.at < 360 && Math.hypot(sx - lastTap.sx, sy - lastTap.sy) < 28) {
        lastTap = null;
        unfold();
      } else lastTap = { at: now, sx, sy };
    }
  }

  function onCancel(e) {
    if (drag && drag.phase === "drag" && e.pointerId === drag.id) onUp(e);
    pending = null;
  }

  function setActive(on) {
    active = on;
    if (on) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  refresh();
  resize();

  return {
    setActive,
    unfold,
    foldNext() {
      const ok = autoFold(PRESETS[presetIndex % PRESETS.length]);
      if (ok) presetIndex += 1;
      return ok;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      geometry.dispose();
      paperMat.dispose();
      feltMat.dispose();
      felt.geometry.dispose();
      for (const tex of [frontTex, backTex, fibreTex, creaseTex, feltTex]) tex.dispose();
      envTarget.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
