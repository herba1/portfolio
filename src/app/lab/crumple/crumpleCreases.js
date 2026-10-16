export const SHEET_W = 1;
export const SHEET_H = 1.16;
export const MAX_CREASES = 96;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function crease(rand, major) {
  const angle = rand() * Math.PI;
  const along = major ? 0.5 + rand() * 0.7 : 0.08 + rand() * 0.3;
  const width = major ? 0.1 + rand() * 0.18 : 0.025 + rand() * 0.07;
  const sign = rand() < 0.55 ? 1 : -1;
  return {
    qx: (rand() - 0.5) * SHEET_W * 1.1,
    qy: (rand() - 0.5) * SHEET_H * 1.1,
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    w: width,
    L: along,
    amp: sign * (major ? 0.55 + rand() * 0.45 : 0.3 + rand() * 0.5),
  };
}

function branch(rand, from) {
  const t = (rand() - 0.5) * from.L * 1.4;
  const turn = (rand() < 0.5 ? 1 : -1) * (0.5 + rand() * 0.9);
  const a = Math.atan2(from.dy, from.dx) + turn;
  const L = 0.1 + rand() * 0.28;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  return {
    qx: from.qx + from.dx * t + dx * L * 0.6,
    qy: from.qy + from.dy * t + dy * L * 0.6,
    dx,
    dy,
    w: 0.025 + rand() * 0.06,
    L,
    amp: (rand() < 0.5 ? 1 : -1) * (0.3 + rand() * 0.5),
  };
}

export function makeCreases(seed, majors = 9, minors = 20, branches = 18) {
  const rand = rng(seed);
  const list = [];
  for (let i = 0; i < majors; i += 1) list.push(crease(rand, true));
  for (let i = 0; i < minors; i += 1) list.push(crease(rand, false));
  for (let i = 0; i < branches; i += 1) list.push(branch(rand, list[Math.floor(rand() * list.length)]));
  return list;
}

export function addCreases(list, seed, count = 10) {
  const rand = rng(seed);
  const next = list.slice();
  for (let i = 0; i < count && next.length < MAX_CREASES; i += 1) {
    next.push(rand() < 0.5 ? crease(rand, false) : branch(rand, next[Math.floor(rand() * next.length)]));
  }
  return next;
}

function falloff(u, L) {
  const a = Math.abs(u);
  const lo = L * 0.35;
  if (a <= lo) return 1;
  if (a >= L) return 0;
  const x = (a - lo) / (L - lo);
  return 1 - x * x * (3 - 2 * x);
}

export function sampleField(list, x, y, out) {
  let h = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    const rx = x - c.qx;
    const ry = y - c.qy;
    const u = rx * c.dx + ry * c.dy;
    const F = falloff(u, c.L);
    if (F <= 0) continue;
    const v = -rx * c.dy + ry * c.dx;
    const av = Math.abs(v);
    if (av < c.w) {
      const k = (c.w - av) / c.w;
      h += c.amp * k * k * F;
    }
    const pull = Math.min(av, c.w * 1.6) * Math.sign(v) * F * Math.abs(c.amp);
    px -= -c.dy * pull;
    py -= c.dx * pull;
  }
  out.h = h;
  out.px = px;
  out.py = py;
  return out;
}

export function packCreases(list, a, b) {
  for (let i = 0; i < MAX_CREASES; i += 1) {
    const c = list[i];
    if (c) {
      a[i].set(c.qx, c.qy, c.dx, c.dy);
      b[i].set(c.w, c.L, c.amp, 0);
    } else {
      a[i].set(9, 9, 1, 0);
      b[i].set(0, 0, 0, 0);
    }
  }
}
