import { TILT } from "./patchLayout";
import { vuGeometry } from "./patchPanel";

const LX = -0.32;
const LY = -0.95;
const VIEW_Z = 1 / Math.sqrt(1 + TILT * TILT);
const VIEW_Y = -TILT * VIEW_Z;
const SHADOW_DROP = 0.6;
const SHADOW_SKEW = 0.1;

export function rgb(c, f = 1, a = 1) {
  const r = Math.max(0, Math.min(255, Math.round(c[0] * f)));
  const g = Math.max(0, Math.min(255, Math.round(c[1] * f)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] * f)));
  return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
}

function mix(c, t, w) {
  return [c[0] + (t[0] - c[0]) * w, c[1] + (t[1] - c[1]) * w, c[2] + (t[2] - c[2]) * w];
}

export function makeShadowSprites(levels = 12) {
  const size = 64;
  const sprites = [];
  for (let i = 0; i < levels; i += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    const dark = 1 - (i + 1) / levels;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const steps = 8;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const fall = Math.exp(-t * t * 4.2) * (1 - t * t);
      const k = (1 - dark) * fall;
      g.addColorStop(t, `rgb(${Math.round(255 * (1 - k))} ${Math.round(255 * (1 - k * 1.02))} ${Math.round(255 * (1 - k * 1.06))})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    sprites.push(canvas);
  }
  return sprites;
}

export function shadowDab(ctx, sprites, x, y, z, radius, strength) {
  const spread = radius + z * 0.42;
  const reach = Math.max(1, spread * 1.9);
  const contact = strength / (1 + z / (radius * 7));
  const level = Math.max(0, Math.min(sprites.length - 1, Math.round(contact * (sprites.length - 1))));
  if (contact < 0.04) return;
  const sx = x + z * SHADOW_SKEW;
  const sy = y + z * SHADOW_DROP;
  ctx.drawImage(sprites[level], sx - reach, sy - reach, reach * 2, reach * 2);
}

function smoothPath(ctx, xs, ys, n) {
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n - 1; i += 1) {
    ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
  }
  ctx.lineTo(xs[n - 1], ys[n - 1]);
}

export function drawCable(ctx, cable, buffers, d, dpr) {
  const { sx, sy, ox, oy, ux, uy } = buffers;
  const n = cable.screenCount;
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = sx[b] - sx[a];
    let ty = sy[b] - sy[a];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let nx = -ty;
    let ny = tx;
    let s = nx * LX + ny * LY;
    if (s < 0) {
      nx = -nx;
      ny = -ny;
      s = -s;
    }
    ox[i] = nx * (0.12 + 0.88 * s);
    oy[i] = ny * (0.12 + 0.88 * s);
    ux[i] = nx;
    uy[i] = ny;
  }
  const c = cable.color;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  smoothPath(ctx, sx, sy, n);
  ctx.shadowColor = "rgb(0 0 0 / 0.3)";
  ctx.shadowBlur = d * 0.7 * dpr;
  ctx.shadowOffsetY = d * 0.5 * dpr;
  ctx.strokeStyle = rgb(c, 0.42);
  ctx.lineWidth = d;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = rgb(c, 0.8);
  ctx.lineWidth = d * 0.82;
  ctx.stroke();
  const tmpX = buffers.tx;
  const tmpY = buffers.ty;
  for (let i = 0; i < n; i += 1) {
    tmpX[i] = sx[i] + ox[i] * d * 0.09;
    tmpY[i] = sy[i] + oy[i] * d * 0.09;
  }
  smoothPath(ctx, tmpX, tmpY, n);
  ctx.strokeStyle = rgb(c, 0.98);
  ctx.lineWidth = d * 0.58;
  ctx.stroke();
  for (let i = 0; i < n; i += 1) {
    tmpX[i] = sx[i] - ux[i] * d * 0.3;
    tmpY[i] = sy[i] - uy[i] * d * 0.3;
  }
  smoothPath(ctx, tmpX, tmpY, n);
  ctx.strokeStyle = rgb(c, 0.34, 0.45);
  ctx.lineWidth = d * 0.2;
  ctx.stroke();
  const twist = cable.twist || 0;
  for (let i = 0; i < n; i += 1) {
    const wander = Math.sin(i * 0.31 + twist) * 0.07;
    tmpX[i] = sx[i] + ox[i] * d * 0.2 + ux[i] * d * wander;
    tmpY[i] = sy[i] + oy[i] * d * 0.2 + uy[i] * d * wander;
  }
  smoothPath(ctx, tmpX, tmpY, n);
  ctx.strokeStyle = rgb(mix(c, [255, 255, 255], 0.35), 1, 0.42);
  ctx.lineWidth = d * 0.3;
  ctx.stroke();
  for (let i = 0; i < n; i += 1) {
    const wander = Math.sin(i * 0.31 + twist) * 0.09;
    tmpX[i] = sx[i] + ox[i] * d * 0.24 + ux[i] * d * wander;
    tmpY[i] = sy[i] + oy[i] * d * 0.24 + uy[i] * d * wander;
  }
  smoothPath(ctx, tmpX, tmpY, n);
  ctx.strokeStyle = "rgb(255 255 255 / 0.34)";
  ctx.lineWidth = Math.max(0.8, d * 0.1);
  ctx.stroke();
  ctx.restore();
}

function project(p) {
  return [p[0], p[1] + TILT * p[2]];
}

function cylinder(ctx, a, b, ra, rb, axis, paint, capPaint) {
  const pa = project(a);
  const pb = project(b);
  let dx = pb[0] - pa[0];
  let dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  const facing = Math.abs(axis[1] * VIEW_Y + axis[2] * VIEW_Z);
  let rot = 0;
  if (len > 1e-3) {
    dx /= len;
    dy /= len;
    rot = Math.atan2(dy, dx);
  } else {
    dx = 1;
    dy = 0;
  }
  const px = -dy;
  const py = dx;
  const nearB = b[1] * VIEW_Y + b[2] * VIEW_Z >= a[1] * VIEW_Y + a[2] * VIEW_Z;
  const near = nearB ? pb : pa;
  const nearR = nearB ? rb : ra;
  const far = nearB ? pa : pb;
  const farR = nearB ? ra : rb;
  const mx = (pa[0] + pb[0]) / 2;
  const my = (pa[1] + pb[1]) / 2;
  const rm = Math.max(ra, rb);
  let lx = px;
  let ly = py;
  if (lx * LX + ly * LY < 0) {
    lx = -lx;
    ly = -ly;
  }
  ctx.fillStyle = paint(ctx, mx + lx * rm, my + ly * rm, mx - lx * rm, my - ly * rm);
  ctx.beginPath();
  ctx.ellipse(far[0], far[1], Math.max(0.01, farR * facing), farR, rot, 0, Math.PI * 2);
  ctx.fill();
  if (len > 0.3) {
    ctx.beginPath();
    ctx.moveTo(pa[0] + px * ra, pa[1] + py * ra);
    ctx.lineTo(pb[0] + px * rb, pb[1] + py * rb);
    ctx.lineTo(pb[0] - px * rb, pb[1] - py * rb);
    ctx.lineTo(pa[0] - px * ra, pa[1] - py * ra);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = capPaint ? capPaint(ctx, near[0], near[1], nearR) : ctx.fillStyle;
  ctx.beginPath();
  ctx.ellipse(near[0], near[1], Math.max(0.01, nearR * facing), nearR, rot, 0, Math.PI * 2);
  ctx.fill();
  return { near, nearR, rot, facing };
}

function bandGradient(stops) {
  return (ctx, x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [t, color] of stops) g.addColorStop(t, color);
    return g;
  };
}

const NICKEL = bandGradient([
  [0, "#7d7f83"],
  [0.18, "#f6f6f5"],
  [0.34, "#c9cbcd"],
  [0.6, "#8a8c90"],
  [0.85, "#505257"],
  [1, "#2e2f32"],
]);

const CHROME = bandGradient([
  [0, "#5b5d61"],
  [0.14, "#ffffff"],
  [0.26, "#b9bbbe"],
  [0.5, "#5f6165"],
  [0.72, "#9a9ca0"],
  [0.9, "#3a3b3e"],
  [1, "#1f2022"],
]);

function bootGradient(c) {
  return bandGradient([
    [0, rgb(c, 0.55)],
    [0.16, rgb(mix(c, [255, 255, 255], 0.38))],
    [0.32, rgb(c, 1.02)],
    [0.62, rgb(c, 0.72)],
    [1, rgb(c, 0.32)],
  ]);
}

export function drawPlug(ctx, end, plugDims, d) {
  const a = end.axis;
  const f = end.front;
  const at = (t) => [f[0] + a[0] * t, f[1] + a[1] * t, f[2] + a[2] * t];
  const { sleeve, collar, body, boot } = plugDims;
  const c = end.cable.color;
  const seated = end.state === "seated" || end.state === "gripped";
  const parts = [];
  if (!seated || end.depth > 0.2) {
    const reveal = seated ? 0 : Math.min(1, end.reveal);
    if (reveal > 0.02) {
      const s = sleeve * reveal;
      parts.push({ from: -s, to: -s * 0.12, ra: d * 0.4, rb: d * 0.4, paint: NICKEL });
      parts.push({ from: -s * 0.12, to: 0, ra: d * 0.42, rb: d * 0.42, paint: CHROME });
      parts.push({ from: -s - d * 0.02, to: -s + d * 0.36, ra: d * 0.3, rb: d * 0.4, paint: NICKEL, tip: true });
    }
  }
  parts.push({ from: 0, to: collar, ra: d * 0.86, rb: d * 0.86, paint: NICKEL, knurl: true });
  parts.push({ from: collar, to: collar + body, ra: d * 0.74, rb: d * 0.7, paint: CHROME });
  parts.push({ from: collar + body, to: collar + body + boot, ra: d * 0.66, rb: d * 0.5, paint: bootGradient(c) });
  const tipFirst = a[1] * VIEW_Y + a[2] * VIEW_Z >= 0;
  const order = tipFirst ? parts : parts.slice().reverse();
  for (const part of order) {
    const A = at(part.from);
    const B = at(part.to);
    const cap = part.knurl
      ? (cx, x, y, r) => {
          const g = cx.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.1, x, y, r);
          g.addColorStop(0, "#f4f4f3");
          g.addColorStop(0.6, "#b7b9bc");
          g.addColorStop(1, "#6d6f73");
          return g;
        }
      : part.paint === CHROME
        ? (cx, x, y, r) => {
            const g = cx.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.05, x, y, r);
            g.addColorStop(0, "#ffffff");
            g.addColorStop(0.35, "#c3c5c8");
            g.addColorStop(0.8, "#6b6d71");
            g.addColorStop(1, "#45474a");
            return g;
          }
        : part.tip
          ? null
          : (cx, x, y, r) => {
              const g = cx.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.05, x, y, r);
              g.addColorStop(0, rgb(mix(c, [255, 255, 255], 0.25)));
              g.addColorStop(0.55, rgb(c, 0.85));
              g.addColorStop(1, rgb(c, 0.5));
              return g;
            };
    const res = cylinder(ctx, A, B, part.ra, part.rb, a, part.paint, cap);
    if (part.knurl && res.facing < 0.995) {
      const pa = project(A);
      const pb = project(B);
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      if (len > 1.5) {
        ctx.save();
        ctx.strokeStyle = "rgb(30 30 32 / 0.28)";
        ctx.lineWidth = Math.max(0.5, d * 0.05);
        const ux = (pb[0] - pa[0]) / len;
        const uy = (pb[1] - pa[1]) / len;
        const qx = -uy;
        const qy = ux;
        for (let k = -4; k <= 4; k += 1) {
          const o = (k / 4.6) * part.ra;
          ctx.beginPath();
          ctx.moveTo(pa[0] + qx * o, pa[1] + qy * o);
          ctx.lineTo(pb[0] + qx * o, pb[1] + qy * o);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
  const tail = project(at(collar + body + boot));
  return tail;
}

export function drawKnob(ctx, k, u, face) {
  const r = k.r;
  const height = (k.small ? 14 : 22) * u;
  const skirt = r * (k.small ? 1.12 : 1.2);
  const angle = ((-135 + 270 * k.shown) * Math.PI) / 180;
  const x = k.x;
  const y = k.y;
  const top = y + TILT * height;
  const squash = VIEW_Z;
  ctx.save();
  const sk = ctx.createLinearGradient(x, y - skirt, x, y + skirt);
  if (face === "alu") {
    sk.addColorStop(0, "#3c3c3f");
    sk.addColorStop(0.5, "#1a1a1c");
    sk.addColorStop(1, "#0c0c0d");
  } else {
    sk.addColorStop(0, "#f2f2f1");
    sk.addColorStop(0.4, "#b9bbbd");
    sk.addColorStop(1, "#6a6c70");
  }
  ctx.fillStyle = sk;
  ctx.beginPath();
  ctx.ellipse(x, y + TILT * 3 * u, skirt, skirt * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = face === "alu" ? "rgb(255 255 255 / 0.18)" : "rgb(255 255 255 / 0.6)";
  ctx.lineWidth = Math.max(0.6, 0.8 * u);
  ctx.beginPath();
  ctx.ellipse(x, y + TILT * 3 * u, skirt - 0.6 * u, (skirt - 0.6 * u) * squash, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  const side = ctx.createLinearGradient(x - r, 0, x + r, 0);
  if (face === "alu") {
    side.addColorStop(0, "#0b0b0c");
    side.addColorStop(0.3, "#3a3a3d");
    side.addColorStop(0.55, "#222224");
    side.addColorStop(1, "#070708");
  } else {
    side.addColorStop(0, "#6b6d71");
    side.addColorStop(0.28, "#f1f1f0");
    side.addColorStop(0.55, "#a7a9ac");
    side.addColorStop(1, "#4f5155");
  }
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.ellipse(x, y + TILT * 4 * u, r, r * squash, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(x + r, top);
  ctx.ellipse(x, top, r, r * squash, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  const ridges = k.small ? 24 : 36;
  ctx.lineWidth = Math.max(0.6, (k.small ? 0.7 : 0.9) * u);
  for (let i = 0; i < ridges; i += 1) {
    const a = angle + (i / ridges) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    if (sa > 0.05) continue;
    const lit = -sa * 0.7 - ca * 0.3;
    ctx.strokeStyle = face === "alu" ? `rgb(255 255 255 / ${Math.max(0, lit) * 0.22})` : `rgb(${lit > 0 ? "255 255 255" : "0 0 0"} / ${0.1 + Math.abs(lit) * 0.3})`;
    const bx = x + ca * r;
    const by = y + TILT * 4 * u + sa * r * squash;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, top + sa * r * squash);
    ctx.stroke();
  }
  const cap = ctx.createRadialGradient(x - r * 0.3, top - r * 0.45, r * 0.05, x, top, r * 1.05);
  if (face === "alu") {
    cap.addColorStop(0, "#3d3d40");
    cap.addColorStop(0.5, "#1e1e20");
    cap.addColorStop(1, "#0d0d0e");
  } else {
    cap.addColorStop(0, "#f7f7f6");
    cap.addColorStop(0.45, "#c8cacc");
    cap.addColorStop(1, "#7a7c80");
  }
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.ellipse(x, top, r, r * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  if (face === "alu") {
    const insetR = r * 0.64;
    let insert;
    if (typeof ctx.createConicGradient === "function") {
      insert = ctx.createConicGradient(-Math.PI / 2 + angle * 0.0, x, top);
      const stops = [
        [0, "#d9dadc"],
        [0.12, "#9fa1a5"],
        [0.25, "#e9eaeb"],
        [0.37, "#8d8f93"],
        [0.5, "#cfd0d2"],
        [0.62, "#9a9ca0"],
        [0.75, "#eeeeef"],
        [0.88, "#999b9f"],
        [1, "#d9dadc"],
      ];
      for (const [t, col] of stops) insert.addColorStop(t, col);
    } else {
      insert = "#bfc1c4";
    }
    ctx.fillStyle = insert;
    ctx.beginPath();
    ctx.ellipse(x, top, insetR, insetR * squash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgb(0 0 0 / 0.5)";
    ctx.lineWidth = Math.max(0.6, 0.8 * u);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgb(0 0 0 / 0.16)";
    ctx.lineWidth = Math.max(0.5, 0.6 * u);
    for (const f of [0.82, 0.6, 0.38]) {
      ctx.beginPath();
      ctx.ellipse(x, top, r * f, r * f * squash, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const ix = Math.sin(angle);
  const iy = -Math.cos(angle) * squash;
  ctx.lineCap = "round";
  ctx.strokeStyle = face === "alu" ? "#f4f1ea" : "#141415";
  ctx.lineWidth = Math.max(1.2, (k.small ? 1.6 : 2.2) * u);
  ctx.beginPath();
  ctx.moveTo(x + ix * r * (face === "alu" ? 0.7 : 0.3), top + iy * r * (face === "alu" ? 0.7 : 0.3));
  ctx.lineTo(x + ix * r * 0.94, top + iy * r * 0.94);
  ctx.stroke();
  if (face === "alu") {
    ctx.strokeStyle = "#1a1a1b";
    ctx.lineWidth = Math.max(1, 1.6 * u);
    ctx.beginPath();
    ctx.moveTo(x + ix * r * 0.12, top + iy * r * 0.12);
    ctx.lineTo(x + ix * r * 0.56, top + iy * r * 0.56);
    ctx.stroke();
  }
  ctx.restore();
}

export function knobShadow(ctx, sprites, k, u) {
  const height = (k.small ? 14 : 22) * u;
  for (let i = 0; i <= 4; i += 1) {
    const z = (height * i) / 4;
    shadowDab(ctx, sprites, k.x, k.y, z, k.r * 0.95, 0.7);
  }
}

export function drawRing(ctx, j, nutR, face, u) {
  const g = j.glow;
  if (g < 0.01) return;
  ctx.save();
  const r = nutR * 1.42;
  ctx.globalCompositeOperation = face === "black" ? "lighter" : "source-over";
  const halo = ctx.createRadialGradient(j.x, j.y, r * 0.7, j.x, j.y, r * 2);
  halo.addColorStop(0, `rgb(255 166 72 / ${0.32 * g})`);
  halo.addColorStop(0.35, `rgb(255 140 50 / ${0.14 * g})`);
  halo.addColorStop(1, "rgb(255 120 40 / 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(j.x, j.y, r * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgb(255 ${Math.round(150 + 60 * g)} ${Math.round(80 + 60 * g)} / ${0.95 * g})`;
  ctx.lineWidth = Math.max(1.2, 1.9 * u);
  ctx.beginPath();
  ctx.arc(j.x, j.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgb(255 245 225 / ${0.7 * g})`;
  ctx.lineWidth = Math.max(0.5, 0.6 * u);
  ctx.stroke();
  ctx.restore();
}

export function drawLed(ctx, x, y, r, level, face) {
  ctx.save();
  const off = face === "alu" ? "#5a1d16" : "#3d1612";
  ctx.fillStyle = off;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
  ctx.fillStyle = face === "alu" ? "rgb(0 0 0 / 0.3)" : "rgb(0 0 0 / 0.6)";
  ctx.fill();
  const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  body.addColorStop(0, level > 0.02 ? `rgb(255 ${Math.round(190 + 50 * level)} ${Math.round(140 + 80 * level)})` : "#a2483b");
  body.addColorStop(0.5, level > 0.02 ? `rgb(250 ${Math.round(90 + 60 * level)} 50)` : "#6e2219");
  body.addColorStop(1, level > 0.02 ? "rgb(170 40 20)" : "#3c110c");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (level > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    glow.addColorStop(0, `rgb(255 120 60 / ${0.45 * level})`);
    glow.addColorStop(0.4, `rgb(255 80 30 / ${0.12 * level})`);
    glow.addColorStop(1, "rgb(255 60 20 / 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawVu(ctx, vu, u, lamp) {
  const g = vuGeometry(vu);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(g.fx, g.fy, g.fw, g.fh, 3.5 * u);
  ctx.clip();
  if (lamp > 0.01) {
    const warm = ctx.createRadialGradient(g.pivotX, g.fy + g.fh * 0.7, g.fw * 0.05, g.pivotX, g.fy + g.fh * 0.6, g.fw * 0.7);
    warm.addColorStop(0, `rgb(255 196 110 / ${0.34 * lamp})`);
    warm.addColorStop(0.6, `rgb(255 170 80 / ${0.14 * lamp})`);
    warm.addColorStop(1, "rgb(255 150 60 / 0)");
    ctx.fillStyle = warm;
    ctx.fillRect(g.fx, g.fy, g.fw, g.fh);
  }
  const a = vu.angle - Math.PI / 2;
  const tipR = g.radius + 6 * u;
  ctx.strokeStyle = "rgb(0 0 0 / 0.14)";
  ctx.lineWidth = Math.max(1, 1.4 * u);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(g.pivotX + 2 * u, g.pivotY + 2 * u);
  ctx.lineTo(g.pivotX + Math.cos(a) * tipR + 2.5 * u, g.pivotY + Math.sin(a) * tipR + 3 * u);
  ctx.stroke();
  ctx.strokeStyle = "#1b1712";
  ctx.lineWidth = Math.max(0.8, 1.1 * u);
  ctx.beginPath();
  ctx.moveTo(g.pivotX, g.pivotY);
  ctx.lineTo(g.pivotX + Math.cos(a) * tipR, g.pivotY + Math.sin(a) * tipR);
  ctx.stroke();
  const coverTop = g.fy + g.fh * 0.8;
  const cover = ctx.createLinearGradient(0, coverTop, 0, g.fy + g.fh);
  cover.addColorStop(0, "#2c2c2e");
  cover.addColorStop(0.2, "#1b1b1c");
  cover.addColorStop(1, "#0e0e0f");
  ctx.fillStyle = cover;
  ctx.beginPath();
  ctx.moveTo(g.fx, g.fy + g.fh);
  ctx.lineTo(g.fx, coverTop + g.fh * 0.06);
  ctx.quadraticCurveTo(g.pivotX, coverTop - g.fh * 0.08, g.fx + g.fw, coverTop + g.fh * 0.06);
  ctx.lineTo(g.fx + g.fw, g.fy + g.fh);
  ctx.closePath();
  ctx.fill();
  const glass = ctx.createLinearGradient(g.fx, g.fy, g.fx + g.fw * 0.7, g.fy + g.fh);
  glass.addColorStop(0, "rgb(255 255 255 / 0.32)");
  glass.addColorStop(0.28, "rgb(255 255 255 / 0.1)");
  glass.addColorStop(0.42, "rgb(255 255 255 / 0)");
  glass.addColorStop(0.8, "rgb(255 255 255 / 0)");
  glass.addColorStop(1, "rgb(255 255 255 / 0.06)");
  ctx.fillStyle = glass;
  ctx.fillRect(g.fx, g.fy, g.fw, g.fh);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgb(0 0 0 / 0.55)";
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  ctx.roundRect(g.fx, g.fy, g.fw, g.fh, 3.5 * u);
  ctx.stroke();
  ctx.restore();
}
