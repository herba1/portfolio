export const VW = 1600;
export const VH = 900;
export const BEATS = 40;
export const BPM = 120;
export const SECONDS = (BEATS * 60) / BPM;

export const SECTIONS = [
  { beat: 0, name: "crossing" },
  { beat: 8, name: "the four" },
  { beat: 24, name: "producer" },
  { beat: 28, name: "title" },
];

const PAPER = "#efe6d2";
const INK = "#171513";
const RED = "#d2391f";
const OCHRE = "#e2a227";
const DENIM = "#2d5a86";
const GREY = "#8c877d";
const FONT = "TitleArimo";

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (b, from, to) => clamp((b - from) / (to - from));
const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const inCubic = (t) => t * t * t;
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outBack = (t) => {
  const c = 1.25;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function cutPath(ctx, pts, seed) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / 46));
    const nx = -(by - ay) / (len || 1);
    const ny = (bx - ax) / (len || 1);
    for (let k = 0; k < n; k += 1) {
      const t = k / n;
      const j = k === 0 ? 0 : (hash(seed * 13.7 + i * 7.1 + k) - 0.5) * 2.4;
      const x = ax + (bx - ax) * t + nx * j;
      const y = ay + (by - ay) * t + ny * j;
      if (i === 0 && k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function paper(ctx, pts, color, seed, shadow = true) {
  if (shadow) {
    ctx.save();
    ctx.translate(2.5, 3.5);
    cutPath(ctx, pts, seed);
    ctx.fillStyle = "rgba(20, 14, 6, 0.2)";
    ctx.fill();
    ctx.restore();
  }
  cutPath(ctx, pts, seed);
  ctx.fillStyle = color;
  ctx.fill();
}

function rect(ctx, x, y, w, h, color, seed, shadow = true) {
  if (w <= 0.5 || h <= 0.5) return;
  paper(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color, seed, shadow);
}

function disc(ctx, x, y, r, color, seed, shadow = true) {
  const pts = [];
  const n = 40;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + (hash(seed + i * 3.3) - 0.5) * 0.016);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  paper(ctx, pts, color, seed, shadow);
}

function cutText(ctx, text, x, y, size, color, { seed = 1, align = "left", weight = 700, reveal = 1, drop = null, shadow = true } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  const track = size >= 20 ? -0.035 * size : 0;
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (text.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const limit = x + (align === "center" ? -total / 2 : align === "right" ? -total : 0) + total * reveal;
  [...text].forEach((ch, i) => {
    const w = widths[i];
    if (ch !== " " && cx < limit) {
      const r = (hash(seed * 5.1 + i * 1.7) - 0.5) * 0.05;
      const dy = (hash(seed * 2.3 + i * 4.9) - 0.5) * size * 0.035;
      const sc = 1 + (hash(seed * 9.7 + i * 2.1) - 0.5) * 0.05;
      let oy = 0;
      let alpha = 1;
      if (drop) {
        const p = drop(i);
        oy = (1 - p) * -size * 1.2;
        alpha = p > 0 ? 1 : 0;
      }
      if (alpha > 0) {
        ctx.save();
        ctx.translate(cx + w / 2, y + dy + oy);
        ctx.rotate(r);
        ctx.scale(sc, sc);
        if (shadow) {
          ctx.fillStyle = "rgba(20, 14, 6, 0.22)";
          ctx.fillText(ch, -w / 2 + 2.5, 3.5);
        }
        ctx.fillStyle = color;
        ctx.fillText(ch, -w / 2, 0);
        ctx.restore();
      }
    }
    cx += w + track;
  });
  return total;
}

function sweep(ctx, x, y, w, h, p, color, seed) {
  if (p <= 0 || p >= 1) return;
  const front = x + w * outCubic(p);
  const barW = Math.max(18, h * 0.22);
  rect(ctx, front - barW * 0.2, y - h * 0.08, barW, h * 1.16, color, seed);
}

function crossing(ctx, top, height, beat, stripesIn, seed) {
  rect(ctx, -20, top, VW + 40, height, INK, seed);
  for (let k = 0; k < 7; k += 1) {
    const p = stripesIn(k);
    if (p <= 0) continue;
    const e = outBack(clamp(p));
    const h = height * 0.78 * e;
    const x = 135 + k * 220;
    rect(ctx, x, top + height / 2 - h / 2, 110, h, PAPER, seed + 10 + k, false);
  }
}

function limb(ctx, x, y, len, width, angle, color, seed) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const hw = width / 2;
  const fx = x + s * len;
  const fy = y + c * len;
  paper(ctx, [[x - hw * c, y + hw * s], [x + hw * c, y - hw * s], [fx + hw * 0.8 * c, fy - hw * 0.8 * s], [fx - hw * 0.8 * c, fy + hw * 0.8 * s]], color, seed, false);
}

function figure(ctx, x, feet, beat, color, seed, scale = 1) {
  const phase = beat * Math.PI;
  const swing = Math.sin(phase) * 0.5;
  const legLen = 150 * scale;
  const hipY = feet - legLen * Math.cos(0.5) * 0.98;
  const bob = Math.abs(Math.cos(phase)) * 5 * scale;
  const hy = hipY - bob;
  ctx.save();
  ctx.translate(2.5, 3.5);
  ctx.globalAlpha = 0.2;
  drawFigure(ctx, x, hy, legLen, swing, "rgb(20, 14, 6)", seed, scale);
  ctx.restore();
  drawFigure(ctx, x, hy, legLen, swing, color, seed, scale);
}

function drawFigure(ctx, x, hy, legLen, swing, color, seed, scale) {
  limb(ctx, x, hy, legLen, 36 * scale, swing, color, seed + 1);
  limb(ctx, x, hy, legLen, 36 * scale, -swing, color, seed + 2);
  const bodyH = 150 * scale;
  const top = hy - bodyH;
  paper(ctx, [[x - 34 * scale, top], [x + 34 * scale, top], [x + 30 * scale, hy + 6], [x - 30 * scale, hy + 6]], color, seed + 3, false);
  limb(ctx, x - 2 * scale, top + 10 * scale, 132 * scale, 24 * scale, -swing * 1.15, color, seed + 4);
  limb(ctx, x + 2 * scale, top + 10 * scale, 132 * scale, 24 * scale, swing * 1.15, color, seed + 5);
  disc(ctx, x + 4 * scale, top - 40 * scale, 31 * scale, color, seed + 6, false);
  rect(ctx, x - 9 * scale, top - 14 * scale, 18 * scale, 18 * scale, color, seed + 7, false);
}

const NAMES = [
  { name: "john lennon", color: PAPER, align: "left" },
  { name: "ringo starr", color: INK, align: "right" },
  { name: "paul mccartney", color: GREY, align: "left" },
  { name: "george harrison", color: DENIM, align: "right" },
];

function sceneCrossing(ctx, b) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, VW, VH);
  const slide = outExpo(seg(b, 0, 1));
  const toRoad = inOutCubic(seg(b, 7, 8));
  const top = 330 + (600 - 330) * toRoad;
  const height = 240 + (170 - 240) * toRoad;
  ctx.save();
  ctx.translate((slide - 1) * VW, 0);
  crossing(ctx, top, height, b, (k) => seg(b, 1 + k * 0.5, 1.35 + k * 0.5), 100);
  ctx.restore();
  const out = inCubic(seg(b, 7, 7.8));
  const rev = seg(b, 4.5, 5.5);
  if (rev > 0) {
    ctx.save();
    ctx.translate(-out * 900, 0);
    cutText(ctx, "the beatles", 135, 290, 132, RED, { seed: 3, reveal: outCubic(rev) });
    sweep(ctx, 135, 180, 690, 130, rev, INK, 41);
    ctx.restore();
  }
  const flood = outExpo(seg(b, 7.2, 8));
  if (flood > 0) rect(ctx, -20, -20, VW + 40, (top + 28) * flood, OCHRE, 200, false);
}

function sceneFour(ctx, b) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, VW, VH);
  rect(ctx, -20, -20, VW + 40, 620, OCHRE, 200, false);
  crossing(ctx, 600, 170, b, () => 1, 100);
  const order = [0, 1, 2, 3];
  for (const i of order.slice().reverse()) {
    const x = -140 + (b - 8) * 150 - i * 250;
    if (x < -200 || x > VW + 200) continue;
    figure(ctx, x, 688, b + i * 0.5, NAMES[i].color, 300 + i * 20, 1.25);
  }
  NAMES.forEach((n, i) => {
    const start = 8.4 + i * 4;
    const rev = seg(b, start, start + 1);
    const gone = seg(b, start + 3.3, start + 3.9);
    if (rev <= 0 || gone >= 1) return;
    const x = n.align === "left" ? 110 : VW - 110;
    const size = 128;
    const y = 196;
    ctx.save();
    ctx.translate(0, -inCubic(gone) * 360);
    ctx.font = `700 ${size}px ${FONT}`;
    const total = cutText(ctx, n.name, x, y, size, INK, { seed: 11 + i, align: n.align, reveal: outCubic(rev) });
    const left = n.align === "left" ? x : x - total;
    sweep(ctx, left, y - size * 0.82, total, size * 0.98, rev, RED, 61 + i);
    const tag = seg(b, start + 0.9, start + 1.4);
    if (tag > 0) {
      const tw = 40 + 140 * outExpo(tag);
      rect(ctx, n.align === "left" ? left : x - tw, y + 30, tw, 14, n.color === INK ? RED : n.color, 80 + i);
    }
    ctx.restore();
  });
}

function sceneProducer(ctx, b) {
  if (b < 26.9) sceneFour(ctx, Math.min(b, 24));
  else sceneTitle(ctx, b);
  for (let k = 0; k < 8; k += 1) {
    const p = outExpo(seg(b, 24 + k * 0.3, 24.7 + k * 0.3));
    const leave = inCubic(seg(b, 27.7 + (k % 4) * 0.08, 28.5 + (k % 4) * 0.08));
    const fromTop = k % 2 === 0;
    const y = fromTop ? -VH + p * VH - leave * VH : VH - p * VH + leave * VH;
    rect(ctx, k * 200 - 2, y - 6, 204, VH + 12, INK, 500 + k, false);
  }
  const t1 = seg(b, 25.6, 26.1);
  const t2 = seg(b, 26.1, 27);
  const out = inCubic(seg(b, 27.6, 28.2));
  ctx.save();
  ctx.translate(0, -out * 120);
  ctx.globalAlpha = 1 - out;
  if (t1 > 0) cutText(ctx, "produced by", VW / 2, 380, 48, OCHRE, { seed: 30, align: "center", reveal: outCubic(t1), shadow: false });
  if (t2 > 0) {
    ctx.font = `700 132px ${FONT}`;
    const total = cutText(ctx, "george martin", VW / 2, 540, 132, PAPER, { seed: 31, align: "center", reveal: outCubic(t2), shadow: false });
    sweep(ctx, VW / 2 - total / 2, 540 - 132 * 0.82, total, 132 * 0.98, t2, OCHRE, 71);
  }
  ctx.restore();
}

function sceneTitle(ctx, b) {
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, VW, VH);
  const sun = outCubic(seg(b, 28.6, 31));
  disc(ctx, VW / 2 + 430, 820 - sun * 560, 140, OCHRE, 700);
  const letters = "abbey road";
  const idx = [];
  [...letters].forEach((ch, i) => {
    if (ch !== " ") idx.push(i);
  });
  const drop = (i) => {
    const order = idx.indexOf(i);
    return outBack(seg(b, 29 + order * 0.5, 29.6 + order * 0.5));
  };
  cutText(ctx, letters, VW / 2, 560, 250, PAPER, { seed: 50, align: "center", drop });
  for (let k = 0; k < 7; k += 1) {
    const p = outExpo(seg(b, 33.4 + k * 0.25, 33.9 + k * 0.25));
    const w = 110;
    const x = 135 + k * 220;
    rect(ctx, x, 640, w * p, 46, INK, 800 + k);
  }
  const credit = seg(b, 35, 35.6);
  if (credit > 0) cutText(ctx, "apple records  ·  1969", VW / 2, 790, 40, PAPER, { seed: 60, align: "center", reveal: outCubic(credit), shadow: false });
  for (let k = 0; k < 8; k += 1) {
    const p = outExpo(seg(b, 36.2 + k * 0.4, 37.05 + k * 0.4));
    if (p <= 0) continue;
    const x = VW - (k + 1) * 200 - 2;
    rect(ctx, x, -VH - 6 + p * (VH + 6), 204, VH + 12, PAPER, 900 + k, k < 7);
  }
}

export function drawScene(ctx, beat) {
  const b = ((beat % BEATS) + BEATS) % BEATS;
  if (b < 8) sceneCrossing(ctx, b);
  else if (b < 24) sceneFour(ctx, b);
  else if (b < 28.8) sceneProducer(ctx, b);
  else sceneTitle(ctx, b);
}
