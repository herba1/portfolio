import { FRAME_COUNT, pose } from "./riffleRig";

export const TEX_W = 784;
export const TEX_H = 560;

const DEG = Math.PI / 180;
const VIEW_YAW = -40 * DEG;
const VIEW_TILT = 7 * DEG;
const R3 = [Math.cos(VIEW_YAW), 0, -Math.sin(VIEW_YAW)];
const C3 = [Math.sin(VIEW_YAW), 0, Math.cos(VIEW_YAW)];
const SCALE = 226;
const ORIGIN = [TEX_W * 0.45, TEX_H * 0.9];
const GRAPHITE = "rgb(52 50 54)";
const BLUE = "rgb(96 132 196)";

function rng(seed) {
  let s = Math.floor(seed * 9973) + 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function project(p) {
  const x = p[0] * R3[0] + p[2] * R3[2];
  const c = p[0] * C3[0] + p[2] * C3[2];
  const up = p[1] * Math.cos(VIEW_TILT) - c * Math.sin(VIEW_TILT);
  const depth = c * Math.cos(VIEW_TILT) + p[1] * Math.sin(VIEW_TILT);
  return [ORIGIN[0] + x * SCALE, ORIGIN[1] - up * SCALE, depth];
}

function capsule(a, b, ra, rb) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l < Math.abs(ra - rb) + 0.5) {
    const c = ra > rb ? a : b;
    const r = Math.max(ra, rb);
    return circle(c, r, 18);
  }
  const base = Math.atan2(dy, dx);
  const phi = Math.asin(Math.max(-0.95, Math.min(0.95, (ra - rb) / l)));
  const pts = [];
  const n = 9;
  for (let i = 0; i <= n; i += 1) {
    const ang = base + Math.PI / 2 + phi + ((Math.PI - 2 * phi) * i) / n;
    pts.push([a[0] + Math.cos(ang) * ra, a[1] + Math.sin(ang) * ra]);
  }
  for (let i = 0; i <= n; i += 1) {
    const ang = base - Math.PI / 2 - phi + ((Math.PI + 2 * phi) * i) / n;
    pts.push([b[0] + Math.cos(ang) * rb, b[1] + Math.sin(ang) * rb]);
  }
  return pts;
}

function circle(c, r, n = 20, ry = r, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * ry;
    pts.push([c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}

function ellipse3(center, u, v, n = 18) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pts.push(project([center[0] + u[0] * ca + v[0] * sa, center[1] + u[1] * ca + v[1] * sa, center[2] + u[2] * ca + v[2] * sa]));
  }
  return pts;
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function chain(points, radii) {
  const dense = [];
  const rads = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const steps = 8;
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      dense.push([x, y]);
      rads.push(radii[i] + (radii[i + 1] - radii[i]) * t);
    }
  }
  dense.push(points[n - 1]);
  rads.push(radii[n - 1]);
  const left = [];
  const right = [];
  for (let i = 0; i < dense.length; i += 1) {
    const a = dense[Math.max(0, i - 1)];
    const b = dense[Math.min(dense.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    left.push([dense[i][0] + nx * rads[i], dense[i][1] + ny * rads[i]]);
    right.push([dense[i][0] - nx * rads[i], dense[i][1] - ny * rads[i]]);
  }
  const capEnd = [];
  const last = dense[dense.length - 1];
  const prev = dense[dense.length - 2];
  const endAng = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
  const re = rads[rads.length - 1];
  for (let k = 1; k < 8; k += 1) {
    const a = endAng + Math.PI / 2 - (Math.PI * k) / 8;
    capEnd.push([last[0] + Math.cos(a) * re, last[1] + Math.sin(a) * re]);
  }
  const capStart = [];
  const first = dense[0];
  const second = dense[1];
  const startAng = Math.atan2(first[1] - second[1], first[0] - second[0]);
  const rs = rads[0];
  for (let k = 1; k < 8; k += 1) {
    const a = startAng + Math.PI / 2 - (Math.PI * k) / 8;
    capStart.push([first[0] + Math.cos(a) * rs, first[1] + Math.sin(a) * rs]);
  }
  return smoothClosed([...left, ...capEnd, ...right.reverse(), ...capStart], 1);
}

function shoe(heel, toe, ankle) {
  const dx = toe[0] - heel[0];
  const dy = toe[1] - heel[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  let nx = -uy;
  let ny = ux;
  if ((ankle[0] - heel[0]) * nx + (ankle[1] - heel[1]) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const h = SCALE * 0.05;
  const at = (t, k) => [heel[0] + dx * t - nx * h * k, heel[1] + dy * t - ny * h * k];
  return smoothClosed(
    [at(-0.06, 0.1), at(0.02, 1.1), at(0.3, 1.25), at(0.55, 0.9), at(0.85, 0.75), at(1.04, 0.35), at(1.03, -0.12), at(0.5, -0.2), at(0, -0.15)],
    2,
  );
}

function hull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function smoothClosed(pts, iterations = 2) {
  let cur = pts;
  for (let k = 0; k < iterations; k += 1) {
    const next = [];
    for (let i = 0; i < cur.length; i += 1) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

function tracePath(ctx, pts, closed) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

function wobble(pts, closed, rand, amp) {
  const out = [];
  const count = pts.length;
  const segs = closed ? count : count - 1;
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  let acc = 0;
  for (let i = 0; i < segs; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % count];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(l / 5));
    const nx = -(b[1] - a[1]) / (l || 1);
    const ny = (b[0] - a[0]) / (l || 1);
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      acc += l / steps;
      const w = amp * (Math.sin(acc * 0.045 + p1) * 0.7 + Math.sin(acc * 0.13 + p2) * 0.3);
      out.push([a[0] + (b[0] - a[0]) * t + nx * w, a[1] + (b[1] - a[1]) * t + ny * w]);
    }
  }
  if (!closed) out.push(pts[count - 1]);
  return out;
}

function pencil(ctx, pts, { closed = true, width = 2.1, rand, amp = 0.7, color = GRAPHITE, alpha = 1 }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const main = wobble(pts, closed, rand, amp);
  ctx.lineWidth = width;
  tracePath(ctx, main, closed);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.45;
  ctx.lineWidth = width * 0.55;
  const ghost = wobble(pts, closed, rand, amp * 1.6).map(([x, y]) => [x + 0.6, y - 0.4]);
  tracePath(ctx, ghost, closed);
  ctx.stroke();
  ctx.restore();
}

function hatch(ctx, pts, { spacing, angle, alpha, width = 1, rand, cross = false, color = GRAPHITE }) {
  ctx.save();
  tracePath(ctx, pts, true);
  ctx.clip();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const reach = Math.hypot(maxX - minX, maxY - minY) / 2 + 4;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  const passes = cross ? [angle, angle + 72 * DEG] : [angle];
  for (const ang of passes) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let o = -reach; o <= reach; o += spacing) {
      const j = (rand() - 0.5) * spacing * 0.5;
      const px = cx - dy * (o + j);
      const py = cy + dx * (o + j);
      const a = reach * (0.9 + rand() * 0.2);
      ctx.globalAlpha = alpha * (0.7 + rand() * 0.3);
      ctx.beginPath();
      ctx.moveTo(px - dx * a, py - dy * a);
      ctx.lineTo(px + dx * a, py + dy * a + (rand() - 0.5) * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function erase(ctx, pts) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  tracePath(ctx, pts, true);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

const TONES = {
  shirt: { base: { spacing: 5, alpha: 0.2 }, shade: { spacing: 3, alpha: 0.5 } },
  pants: { base: { spacing: 4.6, alpha: 0.26 }, shade: { spacing: 2.8, alpha: 0.55 } },
  dark: { base: { spacing: 2.4, alpha: 0.8, cross: true }, shade: null },
  shoe: { base: { spacing: 2.2, alpha: 0.85, cross: true }, shade: null },
  wood: { base: null, shade: { spacing: 3.4, alpha: 0.32 } },
  skin: { base: null, shade: { spacing: 3.2, alpha: 0.28 } },
};

let scratch = null;

function shade(ctx, shape, tone, rand) {
  if (!tone) return;
  const angle = -58 * DEG;
  if (tone.base) hatch(ctx, shape, { ...tone.base, angle, width: 1, rand });
  if (!tone.shade) return;
  if (!scratch) scratch = makeCanvas(TEX_W, TEX_H);
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of shape) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const x0 = Math.max(0, Math.floor(minX) - 4);
  const y0 = Math.max(0, Math.floor(minY) - 4);
  const w = Math.min(TEX_W, Math.ceil(maxX) + 4) - x0;
  const h = Math.min(TEX_H, Math.ceil(maxY) + 4) - y0;
  if (w <= 0 || h <= 0) return;
  sctx.clearRect(x0, y0, w, h);
  hatch(sctx, shape, { ...tone.shade, angle: angle + 8 * DEG, width: 1, rand });
  sctx.save();
  sctx.globalCompositeOperation = "destination-out";
  const off = Math.min(9, Math.max(4, Math.min(w, h) * 0.32));
  tracePath(sctx, shape.map(([x, y]) => [x - off * 0.75, y - off * 0.55]), true);
  sctx.fill();
  sctx.restore();
  ctx.drawImage(scratch, x0, y0, w, h, x0, y0, w, h);
}

function folds(ctx, part, rand) {
  const [a, b, c] = part.bend;
  const ux = a[0] - b[0];
  const uy = a[1] - b[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy) || 1;
  const lv = Math.hypot(vx, vy) || 1;
  const cos = (ux * vx + uy * vy) / (lu * lv);
  if (cos < -0.93) return;
  let ix = ux / lu + vx / lv;
  let iy = uy / lu + vy / lv;
  const li = Math.hypot(ix, iy) || 1;
  ix /= li;
  iy /= li;
  const r = part.r;
  const strength = Math.min(1, (cos + 0.93) * 1.6);
  for (const k of [0.55, 0.15]) {
    const cx = b[0] + ix * r * k;
    const cy = b[1] + iy * r * k;
    const tx = -iy;
    const ty = ix;
    const l = r * (0.7 - k * 0.5);
    pencil(ctx, [[cx - tx * l, cy - ty * l], [cx + ix * r * 0.25, cy + iy * r * 0.25], [cx + tx * l * 0.8, cy + ty * l * 0.8]], { closed: false, rand, width: 1.2, amp: 0.2, alpha: 0.75 * strength });
  }
}

function figureParts(p) {
  const parts = [];
  const px = (m) => m * SCALE;
  const P = (v) => project(v);
  const push = (shape, depth, tone, extra) => parts.push({ shape, depth, tone, extra });

  const { chest, hips } = p;
  const shirtPts = [];
  const levels = [
    [0.44, 0.17, 0.1, 1],
    [0.36, 0.195, 0.12, 1],
    [0.2, 0.165, 0.112, 0.55],
    [0.12, 0.158, 0.11, 0.3],
  ];
  for (const [h, w, d, mixC] of levels) {
    const up = [chest.up[0] * mixC, chest.up[1] * mixC + (1 - mixC), chest.up[2] * mixC];
    const r = [chest.r[0] * mixC + hips.r[0] * (1 - mixC), chest.r[1] * mixC, chest.r[2] * mixC + hips.r[2] * (1 - mixC)];
    const f = [chest.f[0] * mixC + hips.f[0] * (1 - mixC), chest.f[1] * mixC, chest.f[2] * mixC + hips.f[2] * (1 - mixC)];
    const c = [p.pelvis[0] + up[0] * h, p.pelvis[1] + up[1] * h, p.pelvis[2] + up[2] * h];
    shirtPts.push(...ellipse3(c, r.map((x) => x * w), f.map((x) => x * d)));
  }
  const shirt = smoothClosed(hull(shirtPts), 3);
  const torsoDepth = P(chest.top)[2] * 0.5 + P(p.pelvis)[2] * 0.5;
  push(shirt, torsoDepth, "shirt", "shirt");

  const pantsPts = [];
  for (const [h, w, d] of [
    [0.13, 0.16, 0.11],
    [0.02, 0.175, 0.125],
    [-0.08, 0.17, 0.12],
  ]) {
    const c = [p.pelvis[0], p.pelvis[1] + h, p.pelvis[2]];
    pantsPts.push(...ellipse3(c, hips.r.map((x) => x * w), hips.f.map((x) => x * d)));
  }
  const pants = smoothClosed(hull(pantsPts), 3);
  push(pants, P(p.pelvis)[2] - 0.02, "pants", "belt");

  const legs = [
    [p.hipL, p.kneeL, p.ankleL, p.footF],
    [p.hipR, p.kneeR, p.ankleR, p.footB],
  ];
  for (const [hip, knee, ankle, foot] of legs) {
    const mid = lerp3(knee, ankle, 0.45);
    const H = P(hip);
    const K = P(knee);
    const A = P(ankle);
    const M = P(mid);
    push(capsule(A, M, px(0.038), px(0.05)), (K[2] + A[2]) / 2 - 0.01, "dark");
    const T = P(foot.toe);
    const Hl = P(foot.heel);
    push(shoe(Hl, T, A), (T[2] + Hl[2]) / 2 + 0.01, "shoe");
    push(chain([H, K, M], [px(0.09), px(0.076), px(0.072)]), (H[2] + K[2]) / 2, "pants", { bend: [H, K, M], r: px(0.076) });
  }

  const arms = [
    [p.shoulderL, p.elbowL, p.wristL],
    [p.shoulderR, p.elbowR, p.wristR],
  ];
  arms.forEach(([s, e, w]) => {
    const S = P(s);
    const E = P(e);
    const W = P(w);
    push(chain([S, E, W], [px(0.062), px(0.05), px(0.038)]), (S[2] + E[2] + W[2]) / 3 + 0.012, "shirt", { bend: [S, E, W], r: px(0.05) });
  });

  const knob = P(p.bat.knob);
  const tip = P(p.bat.tip);
  const d = [tip[0] - knob[0], tip[1] - knob[1]];
  const at = (t) => [knob[0] + d[0] * t, knob[1] + d[1] * t];
  const batShape = [];
  const prof = [
    [0, 0.023],
    [0.03, 0.014],
    [0.3, 0.015],
    [0.55, 0.024],
    [0.78, 0.031],
    [0.97, 0.03],
    [1, 0.022],
  ];
  const l = Math.hypot(d[0], d[1]) || 1;
  const nx = -d[1] / l;
  const ny = d[0] / l;
  for (const [t, r] of prof) {
    const c = at(t);
    batShape.push([c[0] + nx * px(r), c[1] + ny * px(r)]);
  }
  for (let i = prof.length - 1; i >= 0; i -= 1) {
    const c = at(prof[i][0]);
    batShape.push([c[0] - nx * px(prof[i][1]), c[1] - ny * px(prof[i][1])]);
  }
  const batDepth = Math.max(knob[2], tip[2]) * 0.35 + Math.min(knob[2], tip[2]) * 0.65;
  push(smoothClosed(batShape, 1), batDepth, "wood");

  const handL = P(p.wristL);
  const handR = P(p.wristR);
  const handDepth = Math.max(handL[2], handR[2]) + 0.06;
  const ext = [handR[0] + (handR[0] - handL[0]) * 0.25, handR[1] + (handR[1] - handL[1]) * 0.25];
  const lead = [handL[0] - (handR[0] - handL[0]) * 0.2, handL[1] - (handR[1] - handL[1]) * 0.2];
  push(capsule(lead, ext, px(0.04), px(0.038)), handDepth, "skin", { grip: [lead, handL, handR, ext] });

  const head = P(p.head);
  const g = p.gaze;
  const chin = P([p.head[0] + g[0] * 0.085, p.head[1] - 0.115, p.head[2] + g[2] * 0.085]);
  const jawBack = P([p.head[0] - g[0] * 0.03, p.head[1] - 0.1, p.head[2] - g[2] * 0.03]);
  const neckBase = P(lerp3(p.neck, p.head, 0.15));
  push(capsule(neckBase, P([p.head[0], p.head[1] - 0.06, p.head[2]]), px(0.052), px(0.05)), torsoDepth - 0.08, "skin");
  const skull = hull([...circle(head, px(0.105), 22, px(0.115)), chin, jawBack]);
  push(smoothClosed(skull, 1), head[2], "head", { gaze: g });

  if (p.ball) {
    const B = P(p.ball.pos);
    push(circle(B, px(0.04), 16), B[2] + 2, "ball", { ball: p.ball });
  }

  parts.sort((a, b) => a.depth - b.depth);
  return parts;
}

function drawHead(ctx, p, rand) {
  const g = p.gaze;
  const side = [g[2], 0, -g[0]];
  const H = p.head;
  const at = (fx, fy, fs) => project([H[0] + g[0] * fx + side[0] * fs, H[1] + fy, H[2] + g[2] * fx + side[2] * fs]);
  const camSide = side[0] * C3[0] + side[2] * C3[2];
  const near = camSide >= 0 ? 1 : -1;
  const ear = [at(-0.035, 0.01, near * 0.1), at(-0.06, 0.0, near * 0.1), at(-0.055, -0.04, near * 0.1), at(-0.03, -0.045, near * 0.1)];
  pencil(ctx, ear, { closed: false, rand, width: 1.5, amp: 0.2 });
  const nose = [at(0.1, -0.005, 0), at(0.128, -0.04, 0), at(0.104, -0.05, 0)];
  pencil(ctx, nose, { closed: false, rand, width: 1.6, amp: 0.2 });
  const eye = at(0.075, 0.0, near * 0.045);
  ctx.save();
  ctx.fillStyle = GRAPHITE;
  ctx.beginPath();
  ctx.ellipse(eye[0], eye[1], 1.6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  pencil(ctx, [at(0.06, 0.03, near * 0.06), at(0.09, 0.033, near * 0.03)], { closed: false, rand, width: 1.5, amp: 0.2 });
  pencil(ctx, [at(0.07, -0.085, 0.02 * near), at(0.09, -0.083, 0)], { closed: false, rand, width: 1.2, amp: 0.2 });
  const capPts = [];
  for (const [y, r] of [
    [0.035, 0.112],
    [0.08, 0.1],
    [0.12, 0.07],
    [0.14, 0.02],
  ]) {
    capPts.push(...ellipse3([H[0], H[1] + y, H[2]], [g[0] * r, 0, g[2] * r], [side[0] * r, 0, side[2] * r], 16));
  }
  const cap = smoothClosed(hull(capPts), 1);
  erase(ctx, cap);
  shade(ctx, cap, TONES.dark, rand);
  pencil(ctx, cap, { rand, width: 2 });
  const brimC = [H[0] + g[0] * 0.115, H[1] + 0.035, H[2] + g[2] * 0.115];
  const brim = smoothClosed(hull(ellipse3(brimC, [g[0] * 0.075, -0.012, g[2] * 0.075], [side[0] * 0.095, 0, side[2] * 0.095], 18)), 1);
  erase(ctx, brim);
  shade(ctx, brim, TONES.dark, rand);
  pencil(ctx, brim, { rand, width: 2 });
}

function drawPart(ctx, part, p, rand) {
  erase(ctx, part.shape);
  if (part.tone === "head") {
    shade(ctx, part.shape, TONES.skin, rand);
    pencil(ctx, part.shape, { rand, width: 2.2 });
    drawHead(ctx, p, rand);
    return;
  }
  if (part.tone === "ball") {
    ctx.save();
    ctx.fillStyle = "rgb(250 246 236)";
    tracePath(ctx, part.shape, true);
    ctx.restore();
    pencil(ctx, part.shape, { rand, width: 1.8, amp: 0.25 });
    const c = part.shape.reduce((a, q) => [a[0] + q[0] / part.shape.length, a[1] + q[1] / part.shape.length], [0, 0]);
    const r = SCALE * 0.04;
    ctx.save();
    ctx.strokeStyle = "rgb(178 52 44)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(c[0] - r * 1.15, c[1], r * 0.8, -0.8, 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c[0] + r * 1.15, c[1], r * 0.8, Math.PI - 0.8, Math.PI + 0.8);
    ctx.stroke();
    ctx.restore();
    return;
  }
  shade(ctx, part.shape, TONES[part.tone], rand);
  pencil(ctx, part.shape, { rand, width: part.tone === "wood" ? 1.8 : 2.2 });
  if (part.extra && part.extra.bend) folds(ctx, part.extra, rand);
  if (part.extra && part.extra.grip) {
    const [a, , , d] = part.extra.grip;
    const m = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
    const dx = d[0] - a[0];
    const dy = d[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const r = SCALE * 0.04;
    pencil(ctx, [[m[0] + nx * r * 0.9, m[1] + ny * r * 0.9], [m[0] - nx * r * 0.9, m[1] - ny * r * 0.9]], { closed: false, rand, width: 1.4, amp: 0.2 });
    for (const t of [0.22, 0.75]) {
      const c = [a[0] + dx * t, a[1] + dy * t];
      pencil(ctx, [[c[0] + nx * r * 0.2, c[1] + ny * r * 0.2], [c[0] + nx * r * 0.75, c[1] + ny * r * 0.75]], { closed: false, rand, width: 1.1, amp: 0.1, alpha: 0.7 });
    }
  }
  if (part.extra === "belt") {
    const { hips } = p;
    const c = [p.pelvis[0], p.pelvis[1] + 0.12, p.pelvis[2]];
    const ring = ellipse3(c, hips.r.map((x) => x * 0.162), hips.f.map((x) => x * 0.113), 28);
    const front = ring.filter((q) => q[2] >= project(c)[2] - 0.01);
    if (front.length > 2) {
      front.sort((a, b) => a[0] - b[0]);
      ctx.save();
      ctx.strokeStyle = GRAPHITE;
      ctx.lineCap = "round";
      ctx.lineWidth = SCALE * 0.04;
      ctx.globalAlpha = 0.8;
      tracePath(ctx, front, false);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (part.extra === "shirt") {
    const { chest } = p;
    const camF = chest.f[0] * C3[0] + chest.f[2] * C3[2];
    if (camF > 0.1) {
      const c = [chest.top[0] + chest.f[0] * 0.09, chest.top[1] + 0.01, chest.top[2] + chest.f[2] * 0.09];
      const a = project([c[0] - chest.r[0] * 0.07, c[1] + 0.015, c[2] - chest.r[2] * 0.07]);
      const m = project([c[0], c[1] - 0.06, c[2]]);
      const b = project([c[0] + chest.r[0] * 0.07, c[1] + 0.015, c[2] + chest.r[2] * 0.07]);
      pencil(ctx, [a, m, b], { closed: false, rand, width: 1.5, amp: 0.3, alpha: Math.min(1, (camF - 0.1) * 3) });
    }
  }
}

function drawRoughs(ctx, p, rand) {
  const P = (v) => project(v);
  const line = (a, b, ext = 0.12) => {
    const A = P(a);
    const B = P(b);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const pts = [
      [A[0] - dx * ext + (rand() - 0.5) * 3, A[1] - dy * ext + (rand() - 0.5) * 3],
      [B[0] + dx * ext + (rand() - 0.5) * 3, B[1] + dy * ext + (rand() - 0.5) * 3],
    ];
    pencil(ctx, pts, { closed: false, rand, width: 1.1, amp: 0.8, color: BLUE, alpha: 0.9 });
  };
  line(p.pelvis, p.neck, 0.25);
  line(p.shoulderL, p.shoulderR, 0.2);
  line(p.hipL, p.hipR, 0.25);
  line(p.hipL, p.kneeL);
  line(p.kneeL, p.ankleL);
  line(p.hipR, p.kneeR);
  line(p.kneeR, p.ankleR);
  line(p.shoulderL, p.elbowL);
  line(p.elbowL, p.wristL);
  line(p.shoulderR, p.elbowR);
  line(p.elbowR, p.wristR);
  line(p.bat.knob, p.bat.tip, 0.06);
  const head = P(p.head);
  pencil(ctx, circle([head[0] + (rand() - 0.5) * 3, head[1] + (rand() - 0.5) * 3], SCALE * 0.13, 22), { rand, width: 1.1, amp: 1.2, color: BLUE, alpha: 0.8 });
  const pel = P(p.pelvis);
  pencil(ctx, circle([pel[0], pel[1]], SCALE * 0.12, 20, SCALE * 0.08), { rand, width: 1, amp: 1, color: BLUE, alpha: 0.7 });
}

function drawGround(ctx, rand) {
  const plate = [
    [0.12, 0, 0.36],
    [0.33, 0, 0.36],
    [0.33, 0, 0.58],
    [0.225, 0, 0.7],
    [0.12, 0, 0.58],
  ].map(project);
  pencil(ctx, plate, { rand, width: 1.4, amp: 0.4, alpha: 0.7 });
  const left = project([-1.4, 0, 0.1]);
  const right = project([1.7, 0, 0.1]);
  pencil(ctx, [left, right], { closed: false, rand, width: 1.2, amp: 1.2, alpha: 0.45 });
  const box = [
    [-0.75, 0, -0.35],
    [0.85, 0, -0.35],
  ].map(project);
  pencil(ctx, box, { closed: false, rand, width: 1, amp: 0.8, alpha: 0.35 });
}

function drawShadow(ctx, p, rand) {
  const c = [(p.footF.toe[0] + p.footB.toe[0]) / 2, 0, (p.footF.toe[2] + p.footB.toe[2]) / 2 - 0.05];
  const pts = ellipse3(c, [0.6, 0, 0], [0, 0, 0.2], 28);
  hatch(ctx, pts, { spacing: 3.6, angle: -12 * DEG, alpha: 0.28, width: 1, rand });
}

function drawEffects(ctx, f, p, rand) {
  if (f >= 11 && f <= 14) {
    const strength = f === 12 || f === 13 ? 1 : 0.55;
    const tip = project(p.bat.tip);
    const prev = pose(f - 0.6);
    const prev2 = pose(f - 1.1);
    for (const t of [1, 0.85, 0.7]) {
      const a = project(prev2.bat.tip.map((v, i) => p.bat.hand[i] + (v - prev2.bat.hand[i]) * t));
      const b = project(prev.bat.tip.map((v, i) => p.bat.hand[i] + (v - prev.bat.hand[i]) * t));
      const c = project(p.bat.tip.map((v, i) => p.bat.hand[i] + (v - p.bat.hand[i]) * t * 0.96));
      pencil(ctx, [a, b, c], { closed: false, rand, width: 1.1, amp: 0.4, alpha: 0.55 * strength * t });
    }
    void tip;
  }
  if (p.ball && p.ball.contact) {
    const B = project(p.ball.pos);
    for (let i = 0; i < 7; i += 1) {
      const a = -1.2 + (i / 6) * 2.4 + (rand() - 0.5) * 0.2;
      const r0 = SCALE * 0.07;
      const r1 = SCALE * (0.13 + rand() * 0.05);
      pencil(ctx, [[B[0] + Math.cos(a) * r0, B[1] + Math.sin(a) * r0], [B[0] + Math.cos(a) * r1, B[1] + Math.sin(a) * r1]], { closed: false, rand, width: 1.5, amp: 0.1 });
    }
  }
  if (p.ball && !p.ball.contact) {
    const B = project(p.ball.pos);
    const prev = pose(f - 0.5).ball;
    if (prev) {
      const A = project(prev.pos);
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      const r = SCALE * 0.03;
      for (const o of [-1, 0, 1]) {
        const s = [B[0] - (dx / l) * SCALE * 0.07 + nx * r * o, B[1] - (dy / l) * SCALE * 0.07 + ny * r * o];
        const e = [s[0] - dx * (o === 0 ? 0.9 : 0.6), s[1] - dy * (o === 0 ? 0.9 : 0.6)];
        pencil(ctx, [s, e], { closed: false, rand, width: 1.1, amp: 0.3, alpha: 0.5 });
      }
    }
  }
}

let paperCache = null;
let grainCache = null;

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function valueNoise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = grid[iy * gw + ix];
    const b = grid[iy * gw + ix + 1];
    const c = grid[(iy + 1) * gw + ix];
    const d = grid[(iy + 1) * gw + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function paper() {
  if (paperCache) return paperCache;
  const w = TEX_W + 96;
  const h = TEX_H + 96;
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const rand = rng(3.3);
  const n1 = valueNoise(w, h, 90, rand);
  const n2 = valueNoise(w, h, 11, rand);
  const n3 = valueNoise(w, h, 2.2, rand);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = (n1(x, y) - 0.5) * 4 + (n2(x, y) - 0.5) * 4 + (n3(x, y) - 0.5) * 7;
      const i = (y * w + x) * 4;
      img.data[i] = 244 + v;
      img.data[i + 1] = 237 + v;
      img.data[i + 2] = 221 + v * 1.1;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.lineCap = "round";
  for (let i = 0; i < 900; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI;
    const l = 3 + rand() * 12;
    ctx.strokeStyle = rand() < 0.5 ? "rgb(206 194 170)" : "rgb(255 252 244)";
    ctx.globalAlpha = 0.18 + rand() * 0.25;
    ctx.lineWidth = 0.6 + rand() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 3, y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  paperCache = c;
  return c;
}

function grain() {
  if (grainCache) return grainCache;
  const c = makeCanvas(TEX_W, TEX_H);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(TEX_W, TEX_H);
  const rand = rng(8.1);
  const n1 = valueNoise(TEX_W, TEX_H, 1.6, rand);
  const n2 = valueNoise(TEX_W, TEX_H, 7, rand);
  for (let y = 0; y < TEX_H; y += 1) {
    for (let x = 0; x < TEX_W; x += 1) {
      const v = n1(x, y) * 0.75 + n2(x, y) * 0.25;
      const i = (y * TEX_W + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = Math.max(0, Math.min(255, (0.35 + v * 0.85) * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  grainCache = c;
  return c;
}

function drawNumber(ctx, n, rand) {
  const x = TEX_W - 58;
  const y = 50;
  ctx.save();
  ctx.fillStyle = GRAPHITE;
  ctx.font = "italic 26px 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), x, y + 1);
  ctx.restore();
  const ring = circle([x + 1, y], 21, 26, 18, -0.15).map(([px, py], i) => [px + (i < 3 ? 0 : 0), py]);
  ring.push([ring[0][0] + 6, ring[0][1] - 5]);
  pencil(ctx, ring, { closed: false, rand, width: 1.3, amp: 0.8 });
}

export function drawFrame(target, index) {
  const ctx = target.getContext("2d", { willReadFrequently: true });
  const rand = rng(index * 1.913 + 0.37);
  const p = pose(index);
  const ink = makeCanvas(TEX_W, TEX_H);
  const ictx = ink.getContext("2d", { willReadFrequently: true });
  const blue = makeCanvas(TEX_W, TEX_H);
  const bctx = blue.getContext("2d", { willReadFrequently: true });
  drawRoughs(bctx, p, rand);
  drawShadow(ictx, p, rand);
  drawGround(ictx, rand);
  for (const part of figureParts(p)) drawPart(ictx, part, p, rand);
  drawEffects(ictx, index, p, rand);
  drawNumber(ictx, index + 1, rand);
  ictx.globalCompositeOperation = "destination-in";
  ictx.drawImage(grain(), Math.floor(rand() * 40) - 20, Math.floor(rand() * 40) - 20, TEX_W + 40, TEX_H + 40);
  bctx.globalCompositeOperation = "destination-in";
  bctx.drawImage(grain(), 0, 0);
  const pp = paper();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(pp, -Math.floor(rand() * 90), -Math.floor(rand() * 90));
  ctx.globalAlpha = 0.34;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(blue, 0, 0);
  ctx.globalAlpha = 0.94;
  ctx.drawImage(ink, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

export function drawCover(target, card) {
  const ctx = target.getContext("2d", { willReadFrequently: true });
  const rand = rng(41.7);
  const w = TEX_W;
  const h = TEX_H;
  const img = ctx.createImageData(w, h);
  const n1 = valueNoise(w, h, 60, rand);
  const n2 = valueNoise(w, h, 3, rand);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = (n1(x, y) - 0.5) * 10 + (n2(x, y) - 0.5) * 16 + (rand() - 0.5) * 8;
      const i = (y * w + x) * 4;
      img.data[i] = 186 + v;
      img.data[i + 1] = 168 + v;
      img.data[i + 2] = 140 + v * 0.9;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 260; i += 1) {
    ctx.strokeStyle = rand() < 0.6 ? "rgb(120 100 76)" : "rgb(214 198 170)";
    ctx.globalAlpha = 0.25 + rand() * 0.3;
    ctx.lineWidth = 0.7;
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (2 + rand() * 6), y + Math.sin(a) * (2 + rand() * 6));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (card) {
    const ch = h * 0.66;
    const cw = ch * (card.naturalWidth / card.naturalHeight);
    const cx = w * 0.37;
    const cy = h * 0.48;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-3.2 * DEG);
    ctx.shadowColor = "rgb(60 40 20 / 0.35)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgb(240 232 214)";
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    ctx.shadowColor = "transparent";
    ctx.drawImage(card, -cw / 2, -ch / 2, cw, ch);
    ctx.fillStyle = "rgb(36 30 26)";
    const k = 26;
    const corners = [
      [-cw / 2, -ch / 2, 1, 1],
      [cw / 2, -ch / 2, -1, 1],
      [-cw / 2, ch / 2, 1, -1],
      [cw / 2, ch / 2, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x - sx * 3, y - sy * 3);
      ctx.lineTo(x + sx * k, y - sy * 3);
      ctx.lineTo(x - sx * 3, y + sy * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  const notes = makeCanvas(w, h);
  const nctx = notes.getContext("2d", { willReadFrequently: true });
  nctx.fillStyle = GRAPHITE;
  nctx.font = "italic 30px 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
  nctx.fillText("Tinker at bat", w * 0.6, h * 0.36);
  nctx.font = "italic 21px 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
  nctx.fillText("24 drawings, traced", w * 0.6, h * 0.36 + 40);
  nctx.fillText("from his 1909 card", w * 0.6, h * 0.36 + 68);
  pencil(nctx, [[w * 0.6, h * 0.36 + 88], [w * 0.6 + 70, h * 0.36 + 90], [w * 0.6 + 150, h * 0.36 + 86]], { closed: false, rand, width: 1.2, amp: 0.6 });
  nctx.globalCompositeOperation = "destination-in";
  nctx.drawImage(grain(), 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.9;
  ctx.drawImage(notes, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

export { FRAME_COUNT };
