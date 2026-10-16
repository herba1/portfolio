export const REV = 1.8;
export const OMEGA = (2 * Math.PI) / REV;

export const GEO = {
  record: 152.4,
  mat: 156,
  platter: 168,
  label: 50,
  lead: 147.5,
  end: 62,
  lock: 56.5,
  pivot: [190, -101],
  arm: 230,
  plinth: [-190, -176.5, 263, 176.5],
  lamp: [-128, 128],
  key: [-163, 151, 22, 11],
};

const BANDS = [6, 4, 5, 6];
const LEAD_IN = 1.6;
const GAP = 2.4;
const LEAD_PITCH = 4.6;
const GAP_PITCH = 3.5;
const RUNOUT_REVS = 1.2;

export function buildSide(loop) {
  const music = BANDS.reduce((sum, n) => sum + n * loop, 0);
  const fixedDrop = (LEAD_IN / REV) * LEAD_PITCH + (BANDS.length - 1) * (GAP / REV) * GAP_PITCH;
  const pitch = (GEO.lead - GEO.end - fixedDrop) / (music / REV);
  const segments = [];
  let r = GEO.lead;
  let t = 0;
  const push = (duration, segPitch, isMusic) => {
    segments.push({ r0: r, pitch: segPitch, t0: t, t1: t + duration, music: isMusic });
    r -= (duration / REV) * segPitch;
    t += duration;
  };
  push(LEAD_IN, LEAD_PITCH, false);
  BANDS.forEach((n, i) => {
    push(n * loop, pitch, true);
    if (i < BANDS.length - 1) push(GAP, GAP_PITCH, false);
  });
  const tEnd = t;
  push(RUNOUT_REVS * REV, (r - GEO.lock) / RUNOUT_REVS, false);
  const tLock = t;
  segments.push({ r0: GEO.lock, pitch: 0, t0: tLock, t1: tLock + REV, music: false });
  const bands = segments.filter((s) => s.music).map((s) => ({ t0: s.t0, t1: s.t1 }));
  return { loop, pitch, segments, bands, tEnd, tLock, lockEnd: tLock + REV };
}

export function radiusAt(side, t) {
  if (t <= 0) return GEO.lead;
  for (const s of side.segments) {
    if (t < s.t1 || s.pitch === 0) return s.pitch === 0 ? GEO.lock : s.r0 - ((t - s.t0) / REV) * s.pitch;
  }
  return GEO.lock;
}

export function timeAtRadius(side, r) {
  if (r >= GEO.lead) return 0;
  for (const s of side.segments) {
    if (s.pitch === 0) return s.t0;
    const r1 = s.r0 - ((s.t1 - s.t0) / REV) * s.pitch;
    if (r >= r1) return s.t0 + ((s.r0 - r) / s.pitch) * REV;
  }
  return side.tLock;
}

export function grooveTime(side, r, phase) {
  if (r <= GEO.lock + 0.01) return side.tLock + ((((phase % 1) + 1) % 1) * REV);
  const u = timeAtRadius(side, r) / REV;
  const k = Math.round(u - phase);
  return Math.max(0, Math.min(side.tLock, (k + phase) * REV));
}

export function bandAt(side, t) {
  return side.bands.findIndex((b) => t >= b.t0 - 0.01 && t < b.t1);
}

export function stylusAt(beta) {
  const [px, py] = GEO.pivot;
  return [px + GEO.arm * Math.cos(beta), py + GEO.arm * Math.sin(beta)];
}

export function betaForRadius(r) {
  const [px, py] = GEO.pivot;
  const d = Math.hypot(px, py);
  const base = Math.atan2(-py, -px);
  const c = Math.min(1, Math.max(-1, (GEO.arm * GEO.arm + d * d - r * r) / (2 * GEO.arm * d)));
  return base - Math.acos(c);
}

export const BETA_REST = Math.PI / 2;

export function armPose(beta, lift) {
  const [px, py] = GEO.pivot;
  const grow = 1 + lift * 0.018;
  const s = stylusAt(beta);
  const sx = px + (s[0] - px) * grow;
  const sy = py + (s[1] - py) * grow;
  const dx = sx - px;
  const dy = sy - py;
  const len = Math.hypot(dx, dy) || 1;
  const off = 0.4;
  const hx = (dx / len) * Math.cos(off) - (dy / len) * Math.sin(off);
  const hy = (dx / len) * Math.sin(off) + (dy / len) * Math.cos(off);
  const head = 46 * grow;
  return { p: [px, py], j: [sx - hx * head, sy - hy * head], s: [sx, sy], h: [hx, hy] };
}

export function formatTime(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
