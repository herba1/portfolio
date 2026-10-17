import { buildSleeve } from "./iceArt";
import { createIceGL } from "./iceGL";
import { BLOCK, FACE_H, FACE_W, MELT_EXT, MELT_N, PUDDLE_EXT, PUDDLE_N, SLEEVE, createIceSim, faceAt } from "./iceSim";
import { SLEEVES } from "./iceSleeves";

const EL = 0.86;
const AZ = 0.34;
const FOV = (26 * Math.PI) / 180;
const FOCAL = 1 / Math.tan(FOV / 2);
const SUB = 1 / 240;
const REST = [0.02, SLEEVE.y, -0.03];
const RELEASE_AREA = 0.014;
const FREEZE_S = 1.05;
const THAW_S = 1.5;
const INTRO_S = 1.9;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function mulMat(a, b) {
  const out = new Array(9);
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[k * 3 + row] * b[col * 3 + k];
      out[col * 3 + row] = sum;
    }
  }
  return out;
}

function axisAngle(ax, ay, az, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * ax * ax + c,
    t * ax * ay + s * az,
    t * ax * az - s * ay,
    t * ax * ay - s * az,
    t * ay * ay + c,
    t * ay * az + s * ax,
    t * ax * az + s * ay,
    t * ay * az - s * ax,
    t * az * az + c,
  ];
}

function apply(m, v) {
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
}

function applyT(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function springTo(state, target, omega, dt) {
  const x = state.x - target;
  const exp = Math.exp(-omega * dt);
  const nx = (x + (state.v + omega * x) * dt) * exp;
  state.v = (state.v - omega * (state.v + omega * x) * dt) * exp;
  state.x = target + nx;
}

export function createIceEngine({ box, stage, canvas, cursor, insets, embedded, onReady, onFail, onSelect, onState }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const restRot = rotY(SLEEVE.yaw);
  const sim = createIceSim();
  const view = { width: 1, height: 1, dpr: 1 };
  const cam = {
    tx: { x: 0, v: 0 },
    ty: { x: 0.18, v: 0 },
    tz: { x: 0, v: 0 },
    dist: { x: 6, v: 0 },
    sx: { x: 0, v: 0 },
    sy: { x: 0, v: 0 },
    settled: false,
  };
  const pointer = {
    id: null,
    type: "mouse",
    x: 0,
    y: 0,
    over: false,
    pressed: false,
    prevX: null,
    prevY: null,
    speed: 0,
    dwell: 0,
  };
  const heat = { value: 0, hold: 0, mx: 0, mz: 0, has: false, key: false, kx: 0, kz: 0 };
  const sleeveTex = new Map();
  let gl = null;
  let failed = false;
  let destroyed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let quality = 1;
  let interval = 16;
  let active = 0;
  let pendingSelect = null;
  let seed = 1;
  let started = false;
  let fade = 0;
  let sleeveWet = 0;
  let released = false;
  let needsDraw = true;

  const pose = {
    phase: "held",
    axis: "x",
    dir: [1, 0, 0],
    edge: 0.7,
    s: 0,
    v: 0,
    theta: 0,
    omega: 0,
    sMax: 0,
    track: [],
    center: REST.slice(),
    rot: restRot.slice(),
    dripT: 0,
    landedFor: 0,
  };

  const frost = { mode: "intro", t: 0, x: 1, y: 0, next: null, rewindFrom: 0 };

  function inSleeveFoot(x, z, margin) {
    const local = applyT(restRot, [x - REST[0], 0, z - REST[2]]);
    if (Math.abs(local[0]) < SLEEVE.half + margin && Math.abs(local[2]) < SLEEVE.half + margin) return true;
    return Math.hypot(local[0] - SLEEVE.discOff, local[2]) < SLEEVE.discR + margin;
  }

  function camBasis(target, dist) {
    const dir = [Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL)];
    const pos = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
    const fwd = [-dir[0], -dir[1], -dir[2]];
    const right = normalize(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { pos, fwd, right, up };
  }

  function project(basis, p) {
    const d = [p[0] - basis.pos[0], p[1] - basis.pos[1], p[2] - basis.pos[2]];
    const z = d[0] * basis.fwd[0] + d[1] * basis.fwd[1] + d[2] * basis.fwd[2];
    const x = d[0] * basis.right[0] + d[1] * basis.right[1] + d[2] * basis.right[2];
    const y = d[0] * basis.up[0] + d[1] * basis.up[1] + d[2] * basis.up[2];
    const k = FOCAL / Math.max(z, 0.01);
    return [x * k, y * k];
  }

  function contentBox() {
    const lo = [-BLOCK.hx, 0, -BLOCK.hz];
    const hi = [BLOCK.hx, BLOCK.h, BLOCK.hz];
    if (released && frost.mode !== "freezing") {
      const c = pose.center;
      const r = SLEEVE.half + 0.05;
      lo[0] = Math.min(lo[0], c[0] - r - 0.1);
      lo[2] = Math.min(lo[2], c[2] - r);
      hi[0] = Math.max(hi[0], c[0] + r + 0.12);
      hi[2] = Math.max(hi[2], c[2] + r);
    }
    return { lo, hi };
  }

  function frameWindow() {
    const pad = insets();
    const aspect = view.width / view.height;
    const side = embedded ? 20 : view.width < 640 ? 16 : 56;
    return {
      top: 1 - (2 * pad.top) / view.height,
      bottom: -1 + (2 * pad.bottom) / view.height,
      left: -aspect + (2 * side) / view.height,
      right: aspect - (2 * side) / view.height,
    };
  }

  function frameTarget() {
    const { lo, hi } = contentBox();
    const target = [(lo[0] + hi[0]) / 2, 0.16, (lo[2] + hi[2]) / 2];
    const win = frameWindow();
    const winW = Math.max(0.2, win.right - win.left);
    const winH = Math.max(0.2, win.top - win.bottom);
    let dist = 6;
    let ext = null;
    for (let it = 0; it < 3; it += 1) {
      const basis = camBasis(target, dist);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < 8; i += 1) {
        const p = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
        const [x, y] = project(basis, p);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const k = Math.max((maxX - minX) / (winW * 0.86), (maxY - minY) / (winH * 0.84));
      dist = clamp(dist * k, 2.2, 30);
      ext = { minX, maxX, minY, maxY };
    }
    const basis = camBasis(target, dist);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      const p = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
      const [x, y] = project(basis, p);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    ext = { minX, maxX, minY, maxY };
    const shift = [(win.left + win.right) / 2 - (ext.minX + ext.maxX) / 2, (win.top + win.bottom) / 2 - (ext.minY + ext.maxY) / 2];
    return { target, dist, shift };
  }

  function snapCamera() {
    const f = frameTarget();
    cam.tx.x = f.target[0];
    cam.tz.x = f.target[2];
    cam.dist.x = f.dist;
    cam.sx.x = f.shift[0];
    cam.sy.x = f.shift[1];
    for (const k of ["tx", "tz", "dist", "sx", "sy"]) cam[k].v = 0;
  }

  function stepCamera(dt) {
    const f = frameTarget();
    const w = 3.4;
    springTo(cam.tx, f.target[0], w, dt);
    springTo(cam.tz, f.target[2], w, dt);
    springTo(cam.dist, f.dist, w * 0.9, dt);
    springTo(cam.sx, f.shift[0], w, dt);
    springTo(cam.sy, f.shift[1], w, dt);
    const err =
      Math.abs(cam.tx.x - f.target[0]) +
      Math.abs(cam.tz.x - f.target[2]) +
      Math.abs(cam.dist.x - f.dist) * 0.2 +
      Math.abs(cam.sx.x - f.shift[0]) +
      Math.abs(cam.sy.x - f.shift[1]);
    const vel = Math.abs(cam.tx.v) + Math.abs(cam.tz.v) + Math.abs(cam.dist.v) * 0.2 + Math.abs(cam.sx.v) + Math.abs(cam.sy.v);
    cam.settled = err < 0.0005 && vel < 0.0005;
  }

  function currentBasis() {
    return camBasis([cam.tx.x, cam.ty.x, cam.tz.x], cam.dist.x);
  }

  function pickIce(px, py) {
    const b = currentBasis();
    const ux = (px - view.width / 2) / (view.height / 2) - cam.sx.x;
    const uy = (view.height / 2 - py) / (view.height / 2) - cam.sy.x;
    const rd = normalize([
      b.right[0] * ux + b.up[0] * uy + b.fwd[0] * FOCAL,
      b.right[1] * ux + b.up[1] * uy + b.fwd[1] * FOCAL,
      b.right[2] * ux + b.up[2] * uy + b.fwd[2] * FOCAL,
    ]);
    const ro = b.pos;
    const lo = [-BLOCK.hx, 0, -BLOCK.hz];
    const hi = [BLOCK.hx, BLOCK.h, BLOCK.hz];
    let tn = -Infinity;
    let tf = Infinity;
    for (let a = 0; a < 3; a += 1) {
      const d = Math.abs(rd[a]) < 1e-6 ? 1e-6 : rd[a];
      const t0 = (lo[a] - ro[a]) / d;
      const t1 = (hi[a] - ro[a]) / d;
      tn = Math.max(tn, Math.min(t0, t1));
      tf = Math.min(tf, Math.max(t0, t1));
    }
    if (tn > tf || tf < 0) return null;
    for (let t = Math.max(tn, 0); t <= tf; t += 0.004) {
      const x = ro[0] + rd[0] * t;
      const y = ro[1] + rd[1] * t;
      const z = ro[2] + rd[2] * t;
      if (!sim.inBlock(x, z)) continue;
      if (y <= BLOCK.h - sim.depthAt(x, z) && y >= 0) return [x, z];
    }
    return null;
  }

  function frontEdge(dir) {
    let best = Infinity;
    const p = REST;
    if (Math.abs(dir[0]) > 1e-4) best = Math.min(best, ((dir[0] > 0 ? BLOCK.hx : -BLOCK.hx) - p[0]) / dir[0]);
    if (Math.abs(dir[2]) > 1e-4) best = Math.min(best, ((dir[2] > 0 ? BLOCK.hz : -BLOCK.hz) - p[2]) / dir[2]);
    return best;
  }

  function release() {
    if (released) return;
    released = true;
    const win = frameWindow();
    const wide = (win.right - win.left) / (win.top - win.bottom) > 1.15;
    pose.axis = wide ? "x" : "z";
    pose.dir = apply(restRot, wide ? [1, 0, 0] : [0, 0, 1]);
    pose.edge = frontEdge(pose.dir);
    pose.phase = "slide";
    pose.s = 0;
    pose.v = 0.05;
    pose.theta = 0;
    pose.omega = 0;
    pose.track = [];
    pose.landedFor = 0;
    if (!reduced && navigator.vibrate && pointer.type === "touch") {
      try {
        navigator.vibrate(12);
      } catch {}
    }
    onState?.("free");
    if (reduced) {
      for (let i = 0; i < 2400 && pose.phase !== "rest"; i += 1) stepSleeve(1 / 240);
      sleeveWet = 1;
      snapCamera();
    }
  }

  function poseFrom(s, theta, phase) {
    const d = pose.dir;
    const k = normalize(cross(d, [0, 1, 0]));
    const tilt = axisAngle(k[0], k[1], k[2], -theta);
    const rot = mulMat(tilt, restRot);
    const t = SLEEVE.thick;
    if (phase === "held" || phase === "slide" || s <= pose.edge) {
      return { center: [REST[0] + d[0] * s, REST[1], REST[2] + d[2] * s], rot };
    }
    if (phase === "tip") {
      const r = s - pose.edge;
      const px = REST[0] + d[0] * pose.edge;
      const pz = REST[2] + d[2] * pose.edge;
      return {
        center: [px + d[0] * r * Math.cos(theta), REST[1] - r * Math.sin(theta), pz + d[2] * r * Math.cos(theta)],
        rot,
      };
    }
    const c = pose.contact;
    const half = SLEEVE.half;
    return {
      center: [c[0] - d[0] * half * Math.cos(theta), half * Math.sin(theta) + t, c[1] - d[2] * half * Math.cos(theta)],
      rot,
    };
  }

  function stepSleeve(h) {
    const S = SLEEVE.half * 2;
    if (pose.phase === "slide") {
      pose.v = Math.min(0.62, pose.v + h * 0.75);
      pose.s += pose.v * h;
      if (pose.s >= pose.edge) pose.phase = "tip";
    } else if (pose.phase === "tip") {
      pose.v = Math.min(0.75, pose.v + h * 0.25);
      pose.s += pose.v * h;
      const r = pose.s - pose.edge;
      const cap = Math.asin(clamp((REST[1] - SLEEVE.thick) / (r + S / 2), 0, 1));
      pose.omega += h * 9;
      pose.theta += pose.omega * h;
      if (pose.theta >= cap) {
        pose.theta = cap;
        pose.omega = 0;
      }
      if (r >= S / 2) {
        pose.theta = cap;
        const reach = (r + S / 2) * Math.cos(pose.theta);
        pose.contact = [REST[0] + pose.dir[0] * (pose.edge + reach), REST[2] + pose.dir[2] * (pose.edge + reach)];
        pose.phase = "fall";
        pose.omega = 0;
      }
    } else if (pose.phase === "fall" || pose.phase === "settle") {
      pose.v = Math.max(0, pose.v - h * 1.1);
      pose.contact[0] += pose.dir[0] * pose.v * h;
      pose.contact[1] += pose.dir[2] * pose.v * h;
      if (pose.phase === "fall") {
        pose.omega -= h * 16 * Math.cos(pose.theta);
        pose.theta += pose.omega * h;
        if (pose.theta <= 0) {
          pose.theta = 0;
          pose.omega = Math.abs(pose.omega) > 0.6 ? -pose.omega * 0.1 : 0;
          pose.phase = "settle";
          sleeveWet = 1;
          landSplash();
        }
      } else {
        pose.omega -= h * 16;
        pose.theta = Math.max(0, pose.theta + pose.omega * h);
        if (pose.theta <= 0) pose.omega = 0;
        pose.landedFor += h;
        if (pose.v <= 0 && pose.theta <= 0 && pose.landedFor > 0.3) pose.phase = "rest";
      }
    }
    if (pose.phase !== "held" && pose.phase !== "rewind") {
      pose.sMax = Math.max(pose.sMax, Math.min(pose.s, pose.edge + S));
      const p = poseFrom(pose.s, pose.theta, pose.phase);
      pose.center = p.center;
      pose.rot = p.rot;
    }
  }

  function landSplash() {
    if (reduced) return;
    const c = pose.center;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      sim.deposit(c[0] + Math.cos(a) * 0.52, c[2] + Math.sin(a) * 0.52, 0.004, 0.08);
    }
  }

  function slotUniform() {
    if (pose.sMax <= 0) return { c: [0, 0, 0], h: [0, 0, 0] };
    const m = 0.014;
    const body = SLEEVE.discOff + SLEEVE.discR;
    if (pose.axis === "x") {
      const lo = -SLEEVE.half - m;
      const hi = body + pose.sMax + m;
      return { c: [(lo + hi) / 2, 0, 0], h: [(hi - lo) / 2, 0.017, SLEEVE.half + m] };
    }
    const lo = -SLEEVE.half - m;
    const hi = SLEEVE.half + pose.sMax + m;
    const xlo = -SLEEVE.half - m;
    const xhi = body + m;
    return { c: [(xlo + xhi) / 2, 0, (lo + hi) / 2], h: [(xhi - xlo) / 2, 0.017, (hi - lo) / 2] };
  }

  function render() {
    if (!gl) return;
    const sleeve = SLEEVES[active];
    if (!gl.hasSleeve(sleeve.key)) return;
    const dirty = sim.dirty;
    if (dirty.melt) gl.uploadMelt(sim.packMelt());
    if (dirty.face) gl.uploadFace(sim.packFace());
    if (dirty.puddle) gl.uploadPuddle(sim.packPuddle());
    const b = currentBasis();
    const slot = slotUniform();
    gl.draw({
      shift: [cam.sx.x, cam.sy.x],
      camPos: b.pos,
      camMat: [...b.right, ...b.up, ...b.fwd],
      focal: FOCAL,
      dims: [BLOCK.hx, BLOCK.h, BLOCK.hz, BLOCK.r],
      sleeveDims: [SLEEVE.half, SLEEVE.thick, SLEEVE.discR, SLEEVE.discOff],
      sleevePos: pose.center,
      sleeveRot: pose.rot,
      restPos: REST,
      restRot,
      slotC: slot.c,
      slotH: slot.h,
      ext: [MELT_EXT, PUDDLE_EXT],
      frost: [frost.x, frost.y],
      seed,
      label: sleeve.label,
      sleeveWet,
      fade,
      sleeveKey: sleeve.key,
    });
  }

  function writeCursor() {
    if (!cursor) return;
    const show = pointer.over && pointer.type === "mouse" && heat.has && frost.mode === "idle";
    cursor.toggleAttribute("data-shown", show);
    if (show) {
      cursor.style.transform = `translate3d(${pointer.x.toFixed(1)}px, ${pointer.y.toFixed(1)}px, 0)`;
      cursor.style.setProperty("--ice-heat", heat.value.toFixed(3));
    }
  }

  function stepHeat(dt) {
    if (pointer.prevX != null && dt > 0) {
      const sp = Math.hypot(pointer.x - pointer.prevX, pointer.y - pointer.prevY) / dt;
      pointer.speed += (sp - pointer.speed) * (1 - Math.exp(-dt / 0.06));
    }
    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
    const canMelt = frost.mode === "idle" && started;
    let hit = null;
    if (canMelt && heat.key) hit = [heat.kx, heat.kz];
    else if (canMelt && pointer.over) hit = pickIce(pointer.x, pointer.y);
    heat.has = Boolean(hit);
    if (pointer.speed < 40) pointer.dwell += dt;
    else pointer.dwell = Math.max(0, pointer.dwell - dt * 4);
    let target = 0;
    if (hit) {
      if (heat.key || pointer.pressed) target = 1 / (1 + pointer.speed / 900);
      else if (pointer.type === "mouse" && pointer.dwell > 0.28) target = 0.42;
    }
    const tau = target > heat.value ? 0.38 : 0.18;
    heat.value += (target - heat.value) * (1 - Math.exp(-dt / tau));
    if (heat.value < 0.002 && target === 0) heat.value = 0;
    if (hit) {
      const k = heat.value < 0.01 ? 1 : 1 - Math.exp(-dt * 16);
      heat.mx += (hit[0] - heat.mx) * k;
      heat.mz += (hit[1] - heat.mz) * k;
    }
    if (hit && heat.value > 0.25) heat.hold = Math.min(4, heat.hold + dt);
    else heat.hold = Math.max(0, heat.hold - dt * 0.6);
    if (hit && heat.value > 0.005) {
      const radius = 0.12 + 0.1 * Math.min(1, heat.hold / 3);
      const removed = sim.brush(heat.mx, heat.mz, radius, heat.value * 0.11 * dt);
      sim.relax(heat.mx, heat.mz, radius, 0.12);
      if (!reduced && removed > 0) sim.addWater(heat.mx, heat.mz, removed * 2.6);
      if (!released && sim.exposure() >= RELEASE_AREA) release();
    }
  }

  function stepFrost(dt) {
    if (frost.mode === "idle") return;
    frost.t += dt;
    if (frost.mode === "intro") {
      const k = reduced ? 1 : clamp(frost.t / INTRO_S, 0, 1);
      fade = reduced ? 1 : clamp(frost.t / 0.5, 0, 1);
      frost.x = 1;
      frost.y = easeOut(k);
      if (k >= 1) {
        frost.mode = "idle";
        frost.x = 0;
        frost.y = 0;
      }
    } else if (frost.mode === "freezing") {
      const k = reduced ? 1 : clamp(frost.t / FREEZE_S, 0, 1);
      frost.x = easeInOut(k);
      frost.y = 0;
      sim.scaleAll(reduced ? 0 : Math.exp(-dt * 4.5));
      if (released && pose.track.length) {
        const e = easeInOut(clamp(k * 1.08, 0, 1));
        const idx = Math.round((1 - e) * (pose.track.length - 1));
        const rec = pose.track[idx];
        pose.center = rec.center;
        pose.rot = rec.rot;
        sleeveWet = 1 - e;
      }
      if (k >= 1) resetBlock();
    } else if (frost.mode === "thawing") {
      const k = reduced ? 1 : clamp(frost.t / THAW_S, 0, 1);
      frost.x = 1;
      frost.y = easeOut(k);
      if (k >= 1) {
        frost.mode = "idle";
        frost.x = 0;
        frost.y = 0;
        onState?.("held");
      }
    }
  }

  function resetBlock() {
    if (frost.next != null) {
      active = frost.next;
      frost.next = null;
    }
    seed += 1;
    sim.configure(1000 + seed * 37, inSleeveFoot);
    sim.clear();
    released = false;
    sleeveWet = 0;
    pose.phase = "held";
    pose.s = 0;
    pose.v = 0;
    pose.theta = 0;
    pose.sMax = 0;
    pose.track = [];
    pose.center = REST.slice();
    pose.rot = restRot.slice();
    heat.value = 0;
    heat.hold = 0;
    frost.mode = "thawing";
    frost.t = 0;
    frost.x = 1;
    frost.y = 0;
  }

  function busy() {
    if (frost.mode !== "idle") return true;
    if (heat.key || heat.value > 0) return true;
    if (pointer.over && (heat.has || pointer.speed > 2)) return true;
    if (released && pose.phase !== "rest") return true;
    if (sim.busy) return true;
    return !cam.settled;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.67;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    stepFrost(dt);
    stepHeat(dt);
    if (released && pose.phase !== "rest" && pose.phase !== "held" && frost.mode === "idle") {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      for (let i = 0; i < steps; i += 1) stepSleeve(dt / steps);
      pose.track.push({ center: pose.center.slice(), rot: pose.rot.slice() });
      if (pose.phase === "tip" || pose.phase === "fall") {
        pose.dripT += dt;
        if (pose.dripT > 0.12) {
          pose.dripT = 0;
          const c = pose.center;
          sim.deposit(c[0] + pose.dir[0] * 0.45, c[2] + pose.dir[2] * 0.45, 0.0016, 0.05);
        }
      }
    }
    sim.stepDrops(dt);
    sim.stepPuddle();
    stepCamera(dt);
    const moving = busy();
    if (moving) {
      interval = interval * 0.8 + raw * 0.2;
      if (interval > 34 && quality > 0.6) {
        applyQuality(Math.max(0.6, quality * 0.88));
        interval = 22;
      }
    }
    const d = sim.dirty;
    const draw = frost.mode !== "idle" || d.melt || d.face || d.puddle || !cam.settled || (released && pose.phase !== "rest") || quality < 1 || needsDraw;
    if (draw) render();
    needsDraw = false;
    writeCursor();
    if (!moving && quality < 1) {
      applyQuality(1);
      render();
    }
    if (moving) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(globalThis.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(1500000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.6, Math.min(dprCap, budget));
    applyQuality(quality);
    if (started) {
      snapCamera();
      needsDraw = true;
      render();
      wake();
    }
  }

  async function ensureSleeve(idx) {
    const sleeve = SLEEVES[idx];
    if (sleeveTex.has(sleeve.key)) return sleeveTex.get(sleeve.key);
    const job = (async () => {
      await document.fonts?.ready;
      const canvasArt = await buildSleeve(sleeve, idx);
      if (destroyed || !gl) return false;
      gl.uploadSleeve(sleeve.key, canvasArt);
      return true;
    })().catch((error) => {
      console.error(error);
      sleeveTex.delete(sleeve.key);
      return false;
    });
    sleeveTex.set(sleeve.key, job);
    return job;
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createIceGL(canvas, { melt: MELT_N, faceW: FACE_W, faceH: FACE_H, puddle: PUDDLE_N });
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    sim.configure(1000, inSleeveFoot);
    sim.clear();
    resize();
    ensureSleeve(active).then((ok) => {
      if (!ok || destroyed) return;
      started = true;
      snapCamera();
      frost.mode = "intro";
      frost.t = 0;
      onReady();
      wake();
      SLEEVES.forEach((_, i) => {
        if (i !== active) ensureSleeve(i);
      });
    });
  }

  function refreeze(next = null) {
    if (!started) return;
    if (frost.mode === "freezing") {
      if (next != null) frost.next = next;
      return;
    }
    frost.mode = "freezing";
    frost.t = 0;
    frost.next = next;
    pointer.pressed = false;
    heat.key = false;
    if (released && pose.track.length === 0) pose.track = [{ center: pose.center.slice(), rot: pose.rot.slice() }];
    if (released) pose.track.unshift({ center: REST.slice(), rot: restRot.slice() });
    onState?.("freezing");
    wake();
  }

  function select(idx) {
    if (idx < 0 || idx >= SLEEVES.length) return;
    if (idx === active && frost.next == null) return;
    onSelect(idx);
    pendingSelect = idx;
    ensureSleeve(idx).then((ok) => {
      if (!ok || destroyed || pendingSelect !== idx) return;
      refreeze(idx);
    });
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = local(e);
    pointer.id = e.pointerId;
    pointer.type = e.pointerType;
    pointer.x = x;
    pointer.y = y;
    pointer.prevX = null;
    pointer.over = true;
    pointer.pressed = true;
    pointer.dwell = 0;
    if (e.pointerType !== "mouse") stage.setPointerCapture?.(e.pointerId);
    box.dataset.pressing = "";
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (pointer.pressed && e.pointerId !== pointer.id) return;
    pointer.type = e.pointerType;
    pointer.x = x;
    pointer.y = y;
    pointer.over = true;
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id && pointer.pressed) return;
    pointer.pressed = false;
    if (e.pointerType !== "mouse") pointer.over = false;
    delete box.dataset.pressing;
    wake();
  }

  function onLeave(e) {
    if (pointer.pressed && e.pointerType !== "mouse") return;
    pointer.over = false;
    pointer.pressed = false;
    delete box.dataset.pressing;
    wake();
  }

  function onKey(e) {
    if (!started) return;
    const stepK = 0.06;
    let handled = true;
    if (e.key === "Enter" || e.key === " ") {
      heat.key = true;
      wake();
    } else if (e.key === "ArrowLeft") heat.kx = clamp(heat.kx - stepK, -0.65, 0.65);
    else if (e.key === "ArrowRight") heat.kx = clamp(heat.kx + stepK, -0.65, 0.65);
    else if (e.key === "ArrowUp") heat.kz = clamp(heat.kz - stepK, -0.65, 0.65);
    else if (e.key === "ArrowDown") heat.kz = clamp(heat.kz + stepK, -0.65, 0.65);
    else if (e.key === "r" || e.key === "R" || e.key === "Escape") refreeze();
    else if (/^[1-9]$/.test(e.key)) select(Number(e.key) - 1);
    else handled = false;
    if (handled) e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.key === "Enter" || e.key === " ") {
      heat.key = false;
      wake();
    }
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        init();
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "120px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);
  const onVisibility = () => {
    if (!document.hidden) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);

  return {
    select,
    refreeze: () => refreeze(),
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("keyup", onKeyUp);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
