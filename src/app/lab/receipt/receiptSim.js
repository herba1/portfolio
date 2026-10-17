export const SEG = 4;
export const GRAVITY = 9810;
export const EDGE_N = 64;
export const THICK = 0.22;

const BEND = 5e-8;
const CURL = 1 / 120;
const AIR = 1.1;
const DFTL = 0;
const SWEEPS = 10;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function makePoint(s, a, h, kin) {
  return { s, a, h, pa: a, ph: h, va: 0, vh: 0, kin: Boolean(kin), da: 0, dh: 0, age: 0 };
}

export function curlAt(piece, p) {
  const s = p.s;
  const local = s - piece.curlBase;
  const ripe = Math.min(1, Math.max(0, (piece.exitS - s - 50) / 80));
  const relax = ripe * ripe * (3 - 2 * ripe);
  const wave = 0.82 + 0.3 * hash(Math.floor(s / 37) + piece.seed);
  const tail = piece.curlTail ? Math.max(0, 1 - Math.max(0, piece.curlTail - s) / 60) * 0.7 : 0;
  const tip = 1 + relax * 5.5 * Math.max(Math.max(0, 1 - Math.max(0, local) / 75), tail);
  return CURL * wave * tip * (0.35 + 0.65 * relax);
}

export function worldOf(piece, a, h, out) {
  const sy = Math.sin(piece.yaw);
  const cy = Math.cos(piece.yaw);
  out.x = piece.ox + sy * a + cy * piece.perp;
  out.y = h;
  out.z = piece.oz - cy * a + sy * piece.perp;
  return out;
}

const scratch = { x: 0, y: 0, z: 0 };

function bend(piece, i0, i1, i2, rest, alpha, virt) {
  const pts = piece.pts;
  const A = i0 < 0 ? virt : pts[i0];
  const B = pts[i1];
  const C = pts[i2];
  const e1a = B.a - A.a;
  const e1h = B.h - A.h;
  const e2a = C.a - B.a;
  const e2h = C.h - B.h;
  const l1 = e1a * e1a + e1h * e1h;
  const l2 = e2a * e2a + e2h * e2h;
  if (l1 < 0.25 || l2 < 0.25) return;
  const theta = Math.atan2(e1a * e2h - e1h * e2a, e1a * e2a + e1h * e2h);
  let c = theta - rest;
  if (c > Math.PI) c -= 2 * Math.PI;
  if (c < -Math.PI) c += 2 * Math.PI;
  const gAa = -e1h / l1;
  const gAh = e1a / l1;
  const gCa = -e2h / l2;
  const gCh = e2a / l2;
  const gBa = -gAa - gCa;
  const gBh = -gAh - gCh;
  const wA = A.kin || i0 < 0 ? 0 : 1;
  const wB = B.kin ? 0 : 1;
  const wC = C.kin ? 0 : 1;
  const denom = wA * (gAa * gAa + gAh * gAh) + wB * (gBa * gBa + gBh * gBh) + wC * (gCa * gCa + gCh * gCh) + alpha;
  if (denom < 1e-9) return;
  const lambda = -c / denom;
  if (wA) {
    A.a += lambda * gAa;
    A.h += lambda * gAh;
  }
  if (wB) {
    B.a += lambda * gBa;
    B.h += lambda * gBh;
  }
  if (wC) {
    C.a += lambda * gCa;
    C.h += lambda * gCh;
  }
}

function follow(pts, from, to, stepDir) {
  for (let i = from; i !== to; i += stepDir) {
    const P = pts[i];
    const Q = pts[i + stepDir];
    if (Q.kin) {
      Q.da = Q.dh = 0;
      continue;
    }
    const rest = Math.abs(Q.s - P.s);
    const da = Q.a - P.a;
    const dh = Q.h - P.h;
    const len = Math.hypot(da, dh) || 1e-6;
    const na = P.a + (da / len) * rest;
    const nh = P.h + (dh / len) * rest;
    Q.da = na - Q.a;
    Q.dh = nh - Q.h;
    Q.a = na;
    Q.h = nh;
  }
}

function relax(pts, passes) {
  for (let pass = 0; pass < passes * 2; pass += 1) {
    const forward = pass % 2 === 0;
    const n = pts.length;
    for (let k = 0; k < n - 1; k += 1) {
      const i = forward ? k : n - 2 - k;
      const P = pts[i];
      const Q = pts[i + 1];
      const wP = P.kin ? 0 : 1;
      const wQ = Q.kin ? 0 : 1;
      if (!wP && !wQ) continue;
      const rest = Q.s - P.s;
      const da = Q.a - P.a;
      const dh = Q.h - P.h;
      const len = Math.hypot(da, dh) || 1e-6;
      const c = (len - rest) / (len * (wP + wQ));
      P.a += wP * c * da;
      P.h += wP * c * dh;
      Q.a -= wQ * c * da;
      Q.h -= wQ * c * dh;
    }
  }
}

export function stepPiece(piece, dt, env) {
  const pts = piece.pts;
  const n = pts.length;
  if (!n) return;
  const alpha = BEND / (dt * dt);
  const damp = Math.exp(-AIR * dt);
  const grab = piece.grab;
  for (const p of pts) {
    p.da = p.dh = 0;
    if (p.kin) continue;
    p.age += dt;
    p.va *= damp;
    p.vh = (p.vh - GRAVITY * dt) * damp;
    p.pa = p.a;
    p.ph = p.h;
    p.a += p.va * dt;
    p.h += p.vh * dt;
  }
  if (piece.kind === "strip") {
    const root = pts[n - 1];
    const out = env.exitS - root.s;
    root.pa = root.a;
    root.ph = root.h;
    root.a = env.dirA * out;
    root.h = env.exitH + env.dirH * out;
  }
  const held = grab ? pts[grab.i] : null;
  if (held) {
    held.a = grab.ta;
    held.h = grab.th;
    held.kin = true;
  }
  const virt = piece.kind === "strip" ? piece.virt : null;
  if (virt) {
    const root = pts[n - 1];
    virt.a = root.a - env.dirA * SEG;
    virt.h = root.h - env.dirH * SEG;
  }
  const sweeps = SWEEPS;
  for (let it = 0; it < sweeps; it += 1) {
    for (let i = n - 2; i >= 1; i -= 1) {
      const segLen = 0.5 * (pts[i + 1].s - pts[i - 1].s);
      bend(piece, i + 1, i, i - 1, curlAt(piece, pts[i]) * segLen, alpha, null);
    }
  }
  if (virt && n >= 2) bend(piece, -1, n - 1, n - 2, 0, alpha * 0.02, virt);
  if (piece.kind === "strip" && grab && grab.i < n - 1) {
    for (let k = 0; k < 3; k += 1) {
      follow(pts, n - 1, grab.i + 1, -1);
      follow(pts, grab.i, n - 1, 1);
    }
    follow(pts, n - 1, grab.i + 1, -1);
    follow(pts, grab.i, 0, -1);
  } else if (piece.kind === "strip") follow(pts, n - 1, 0, -1);
  else relax(pts, grab ? 4 : 2);
  const floorAt = env.floorAt;
  let contacts = 0;
  for (const p of pts) {
    if (p.kin) continue;
    worldOf(piece, p.a, p.h, scratch);
    const f = floorAt(scratch.x, scratch.z) + THICK + piece.lift;
    if (p.h < f) {
      const push = f - p.h;
      p.h = f;
      const slide = p.a - p.pa;
      const hold = Math.min(Math.abs(slide), env.friction * push);
      p.a -= Math.sign(slide) * hold;
      p.touch = 1;
      contacts += 1;
    } else p.touch = 0;
  }
  piece.contacts = contacts;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    if (p.kin) {
      p.va = (p.a - p.pa) / dt;
      p.vh = (p.h - p.ph) / dt;
      continue;
    }
    let va = (p.a - p.pa - DFTL * p.da) / dt;
    let vh = (p.h - p.ph - DFTL * p.dh) / dt;
    if (p.touch) {
      va *= env.grip;
      if (vh < 0) vh = 0;
    }
    const speed = va * va + vh * vh;
    if (speed < 900) {
      const calm = 1 - 0.12 * (1 - speed / 900);
      va *= calm;
      vh *= calm;
    }
    p.va = clamp(va, -6000, 6000);
    p.vh = clamp(vh, -6000, 6000);
  }
  if (held) held.kin = false;
  if (piece.kind === "free") {
    if (grab) {
      const err = grab.tp - piece.perp;
      const w = 22;
      piece.pv += (w * w * err - 2 * w * piece.pv) * dt;
    } else {
      const ground = contacts > n * 0.3;
      piece.pv *= Math.exp(-(ground ? 9 : AIR) * dt);
    }
    piece.perp += piece.pv * dt;
  }
}

export function feedStrip(piece, env) {
  const pts = piece.pts;
  let root = pts[pts.length - 1];
  while (env.exitS - root.s >= SEG) {
    root.kin = false;
    const s = root.s + SEG;
    const out = env.exitS - s;
    const fresh = makePoint(s, env.dirA * out, env.exitH + env.dirH * out, true);
    fresh.va = root.va;
    fresh.vh = root.vh;
    pts.push(fresh);
    root = fresh;
  }
}

export function kineticEnergy(piece) {
  let e = 0;
  for (const p of piece.pts) if (!p.kin) e += p.va * p.va + p.vh * p.vh;
  return e / Math.max(1, piece.pts.length) + piece.pv * piece.pv;
}
