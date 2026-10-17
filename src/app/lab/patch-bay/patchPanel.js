function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise1D(random, length, wavelength) {
  const knots = Math.ceil(length / wavelength) + 2;
  const values = new Float32Array(knots);
  for (let i = 0; i < knots; i += 1) values[i] = random() * 2 - 1;
  const out = new Float32Array(length);
  for (let x = 0; x < length; x += 1) {
    const f = x / wavelength;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    out[x] = values[i] * (1 - s) + values[(i + 1) % knots] * s;
  }
  return out;
}

export function makeTextures() {
  const random = rng(7);
  const bw = 1024;
  const bh = 256;
  const brushed = document.createElement("canvas");
  brushed.width = bw;
  brushed.height = bh;
  const bctx = brushed.getContext("2d");
  const bdata = bctx.createImageData(bw, bh);
  const rows = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y += 1) {
    const amp = 0.4 + random() * 0.9;
    const long = valueNoise1D(random, bw, 180 + random() * 260);
    const mid = valueNoise1D(random, bw, 18 + random() * 40);
    const bias = (random() - 0.5) * 0.7;
    for (let x = 0; x < bw; x += 1) rows[y * bw + x] = bias + amp * (long[x] * 0.6 + mid[x] * 0.4);
  }
  for (let y = 0; y < bh; y += 1) {
    const up = ((y - 1 + bh) % bh) * bw;
    const here = y * bw;
    const down = ((y + 1) % bh) * bw;
    for (let x = 0; x < bw; x += 1) {
      const v = rows[here + x] * 0.6 + rows[up + x] * 0.2 + rows[down + x] * 0.2 + (random() - 0.5) * 0.35;
      const g = Math.max(0, Math.min(255, 128 + v * 46));
      const o = (here + x) * 4;
      bdata.data[o] = g;
      bdata.data[o + 1] = g;
      bdata.data[o + 2] = g;
      bdata.data[o + 3] = 255;
    }
  }
  bctx.putImageData(bdata, 0, 0);
  const gs = 256;
  const grain = document.createElement("canvas");
  grain.width = gs;
  grain.height = gs;
  const gctx = grain.getContext("2d");
  const gdata = gctx.createImageData(gs, gs);
  for (let i = 0; i < gs * gs; i += 1) {
    const g = 128 + (random() + random() + random() - 1.5) * 70;
    gdata.data[i * 4] = g;
    gdata.data[i * 4 + 1] = g;
    gdata.data[i * 4 + 2] = g;
    gdata.data[i * 4 + 3] = 255;
  }
  gctx.putImageData(gdata, 0, 0);
  return { brushed, grain };
}

export const INK = {
  alu: "rgb(24 24 26 / 0.9)",
  black: "rgb(236 231 220 / 0.92)",
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function texture(ctx, tex, x, y, w, h, alpha, mode, scale = 1) {
  const pattern = ctx.createPattern(tex, "repeat");
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix().scale(scale, scale));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawScrew(ctx, x, y, r, angle) {
  ctx.save();
  const shadow = ctx.createRadialGradient(x, y + r * 0.5, r * 0.6, x, y + r * 0.5, r * 1.8);
  shadow.addColorStop(0, "rgb(0 0 0 / 0.35)");
  shadow.addColorStop(0.5, "rgb(0 0 0 / 0.12)");
  shadow.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.5, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  const head = ctx.createLinearGradient(x, y - r, x, y + r);
  head.addColorStop(0, "#f2f2f1");
  head.addColorStop(0.35, "#c9cacb");
  head.addColorStop(0.7, "#8e9093");
  head.addColorStop(1, "#5f6164");
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgb(0 0 0 / 0.35)";
  ctx.lineWidth = Math.max(0.5, r * 0.08);
  ctx.stroke();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = "rgb(30 30 32 / 0.85)";
  ctx.lineWidth = r * 0.26;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, 0);
  ctx.lineTo(r * 0.58, 0);
  ctx.moveTo(0, -r * 0.58);
  ctx.lineTo(0, r * 0.58);
  ctx.stroke();
  ctx.strokeStyle = "rgb(255 255 255 / 0.35)";
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, r * 0.16);
  ctx.lineTo(r * 0.5, r * 0.16);
  ctx.stroke();
  ctx.restore();
}

function drawNut(ctx, x, y, r, face, park) {
  ctx.save();
  const shadow = ctx.createRadialGradient(x, y + r * 0.35, r * 0.7, x, y + r * 0.35, r * 1.55);
  shadow.addColorStop(0, "rgb(0 0 0 / 0.45)");
  shadow.addColorStop(0.45, "rgb(0 0 0 / 0.16)");
  shadow.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.35, r * 1.55, 0, Math.PI * 2);
  ctx.fill();
  const body = ctx.createLinearGradient(x, y - r, x, y + r);
  body.addColorStop(0, "#f4f4f3");
  body.addColorStop(0.3, "#cfd0d1");
  body.addColorStop(0.62, "#9a9c9f");
  body.addColorStop(1, "#6a6c70");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const ridges = 44;
  for (let i = 0; i < ridges; i += 1) {
    const a = (i / ridges) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const lit = -sa * 0.6 - ca * 0.2;
    ctx.strokeStyle = lit > 0 ? `rgb(255 255 255 / ${0.12 + lit * 0.4})` : `rgb(20 20 22 / ${0.2 - lit * 0.4})`;
    ctx.lineWidth = Math.max(0.6, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(x + ca * r * 0.8, y + sa * r * 0.8);
    ctx.lineTo(x + ca * r * 0.98, y + sa * r * 0.98);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgb(0 0 0 / 0.4)";
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  const face2 = ctx.createLinearGradient(x, y - r * 0.8, x, y + r * 0.8);
  face2.addColorStop(0, "#e6e7e7");
  face2.addColorStop(0.5, "#b5b7b9");
  face2.addColorStop(1, "#86888b");
  ctx.fillStyle = face2;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgb(0 0 0 / 0.22)";
  ctx.lineWidth = Math.max(0.5, r * 0.04);
  for (const k of [0.66, 0.58]) {
    ctx.beginPath();
    ctx.arc(x, y, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (park) {
    const cap = ctx.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.05, x, y, r * 0.5);
    cap.addColorStop(0, "#5a5b5e");
    cap.addColorStop(0.6, "#2a2b2d");
    cap.addColorStop(1, "#151516");
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const hole = ctx.createRadialGradient(x, y - r * 0.12, r * 0.05, x, y, r * 0.4);
    hole.addColorStop(0, "#020202");
    hole.addColorStop(0.7, "#0b0b0c");
    hole.addColorStop(1, "#262628");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgb(255 255 255 / 0.28)";
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.37, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
  ctx.restore();
  return face;
}

function text(ctx, value, x, y, size, weight, family, color, align = "center") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

export function vuAngle(db) {
  const v = Math.pow(10, db / 20);
  const p = (v - 0.1) / (Math.pow(10, 3 / 20) - 0.1);
  return (-50 + 100 * Math.max(-0.08, Math.min(1.06, p))) * (Math.PI / 180);
}

export function vuGeometry(vu) {
  const inset = Math.max(3, vu.h * 0.06);
  const fx = vu.x + inset;
  const fy = vu.y + inset;
  const fw = vu.w - inset * 2;
  const fh = vu.h - inset * 2;
  const pivotX = fx + fw / 2;
  const pivotY = fy + fh * 1.08;
  const radius = fh * 0.86;
  return { fx, fy, fw, fh, pivotX, pivotY, radius, inset };
}

function drawVuFace(ctx, vu, u, fonts) {
  const g = vuGeometry(vu);
  ctx.save();
  const sh = ctx.createLinearGradient(0, vu.y, 0, vu.y + vu.h + 10 * u);
  sh.addColorStop(0, "rgb(0 0 0 / 0)");
  sh.addColorStop(1, "rgb(0 0 0 / 0.3)");
  ctx.shadowColor = "rgb(0 0 0 / 0.45)";
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 4 * u;
  roundRect(ctx, vu.x, vu.y, vu.w, vu.h, 6 * u);
  const bezel = ctx.createLinearGradient(0, vu.y, 0, vu.y + vu.h);
  bezel.addColorStop(0, "#3a3a3d");
  bezel.addColorStop(0.5, "#1d1d1f");
  bezel.addColorStop(1, "#0f0f10");
  ctx.fillStyle = bezel;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, g.fx, g.fy, g.fw, g.fh, 3.5 * u);
  ctx.clip();
  const face = ctx.createLinearGradient(0, g.fy, 0, g.fy + g.fh);
  face.addColorStop(0, "#f4ecd6");
  face.addColorStop(0.55, "#eee3c6");
  face.addColorStop(1, "#ddd0ae");
  ctx.fillStyle = face;
  ctx.fillRect(g.fx, g.fy, g.fw, g.fh);
  const ink = "rgb(32 28 22 / 0.88)";
  ctx.lineCap = "butt";
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.8, 1.1 * u);
  ctx.beginPath();
  ctx.arc(g.pivotX, g.pivotY, g.radius, -Math.PI / 2 + vuAngle(-20), -Math.PI / 2 + vuAngle(0));
  ctx.stroke();
  ctx.strokeStyle = "rgb(184 46 32 / 0.92)";
  ctx.lineWidth = Math.max(2, 3.4 * u);
  ctx.beginPath();
  ctx.arc(g.pivotX, g.pivotY, g.radius + 1.2 * u, -Math.PI / 2 + vuAngle(0), -Math.PI / 2 + vuAngle(3));
  ctx.stroke();
  const marks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
  const labels = { "-20": "20", "-10": "10", "-7": "7", "-5": "5", "-3": "3", 0: "0", 3: "3" };
  for (const db of marks) {
    const a = vuAngle(db) - Math.PI / 2;
    const long = labels[db] !== undefined;
    const r0 = g.radius + (long ? 2 : 1) * u;
    const r1 = g.radius + (long ? 7.5 : 5) * u;
    ctx.strokeStyle = db > 0 ? "rgb(184 46 32 / 0.95)" : ink;
    ctx.lineWidth = Math.max(0.8, 1 * u);
    ctx.beginPath();
    ctx.moveTo(g.pivotX + Math.cos(a) * r0, g.pivotY + Math.sin(a) * r0);
    ctx.lineTo(g.pivotX + Math.cos(a) * r1, g.pivotY + Math.sin(a) * r1);
    ctx.stroke();
    if (long) {
      const rt = g.radius + 14 * u;
      text(ctx, labels[db], g.pivotX + Math.cos(a) * rt, g.pivotY + Math.sin(a) * rt, Math.max(7, 8 * u), 520, fonts.mono, db > 0 ? "rgb(184 46 32 / 0.95)" : ink);
    }
  }
  text(ctx, "dB", g.pivotX, g.fy + g.fh * 0.62, Math.max(7, 9 * u), 560, fonts.sans, ink);
  const vignette = ctx.createRadialGradient(g.pivotX, g.fy + g.fh * 0.3, g.fw * 0.1, g.pivotX, g.fy + g.fh * 0.4, g.fw * 0.75);
  vignette.addColorStop(0, "rgb(0 0 0 / 0)");
  vignette.addColorStop(0.7, "rgb(60 40 10 / 0.06)");
  vignette.addColorStop(1, "rgb(40 25 5 / 0.22)");
  ctx.fillStyle = vignette;
  ctx.fillRect(g.fx, g.fy, g.fw, g.fh);
  ctx.restore();
}

export function drawPanel(ctx, L, tex, fonts) {
  const { u } = L;
  const W = L.width;
  const H = L.height;
  const ground = ctx.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, "#ecebe7");
  ground.addColorStop(0.5, "#e6e4df");
  ground.addColorStop(1, "#dcd9d3");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);
  texture(ctx, tex.grain, 0, 0, W, H, 0.05, "overlay");
  const C = L.case;
  ctx.save();
  ctx.shadowColor = "rgb(30 24 16 / 0.32)";
  ctx.shadowBlur = 48 * u;
  ctx.shadowOffsetY = 22 * u;
  roundRect(ctx, C.x, C.y, C.w, C.h, 8 * u);
  ctx.fillStyle = "#121212";
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = "rgb(30 24 16 / 0.35)";
  ctx.shadowBlur = 6 * u;
  ctx.shadowOffsetY = 3 * u;
  roundRect(ctx, C.x, C.y, C.w, C.h, 8 * u);
  const shell = ctx.createLinearGradient(0, C.y, 0, C.y + C.h);
  shell.addColorStop(0, "#2a2a2b");
  shell.addColorStop(0.08, "#1a1a1b");
  shell.addColorStop(0.9, "#121213");
  shell.addColorStop(1, "#0b0b0c");
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, C.x + 0.5, C.y + 0.5, C.w - 1, C.h - 1, 8 * u);
  ctx.strokeStyle = "rgb(255 255 255 / 0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  const gap = Math.max(1, 1.2 * u);
  for (const m of L.modules) {
    const top = m.y - L.rail;
    const height = m.h + L.rail * 2;
    const x = m.x + gap / 2;
    const w = m.w - gap;
    ctx.save();
    roundRect(ctx, x, top + gap / 2, w, height - gap, 1.5 * u);
    ctx.clip();
    if (m.face === "alu") {
      const g = ctx.createLinearGradient(0, top, 0, top + height);
      g.addColorStop(0, "#dfe0e1");
      g.addColorStop(0.3, "#d3d5d7");
      g.addColorStop(0.7, "#c6c8cb");
      g.addColorStop(1, "#b7b9bd");
      ctx.fillStyle = g;
      ctx.fillRect(x, top, w, height);
      texture(ctx, tex.brushed, x, top, w, height, 0.42, "overlay", Math.max(0.6, u));
      const sheen = ctx.createLinearGradient(x, top, x + w, top + height);
      sheen.addColorStop(0, "rgb(255 255 255 / 0)");
      sheen.addColorStop(0.38, "rgb(255 255 255 / 0.1)");
      sheen.addColorStop(0.5, "rgb(255 255 255 / 0.16)");
      sheen.addColorStop(0.62, "rgb(255 255 255 / 0.06)");
      sheen.addColorStop(1, "rgb(255 255 255 / 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(x, top, w, height);
    } else {
      const g = ctx.createLinearGradient(0, top, 0, top + height);
      g.addColorStop(0, "#313134");
      g.addColorStop(0.25, "#252527");
      g.addColorStop(0.7, "#1d1d1f");
      g.addColorStop(1, "#161617");
      ctx.fillStyle = g;
      ctx.fillRect(x, top, w, height);
      texture(ctx, tex.brushed, x, top, w, height, 0.1, "overlay", Math.max(0.6, u));
      texture(ctx, tex.grain, x, top, w, height, 0.14, "overlay");
      const sheen = ctx.createLinearGradient(x, top, x + w * 0.6, top + height);
      sheen.addColorStop(0, "rgb(255 255 255 / 0.05)");
      sheen.addColorStop(0.45, "rgb(255 255 255 / 0.02)");
      sheen.addColorStop(1, "rgb(255 255 255 / 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(x, top, w, height);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = m.face === "alu" ? "rgb(255 255 255 / 0.65)" : "rgb(255 255 255 / 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 1, top + gap / 2 + 0.5);
    ctx.lineTo(x + w - 1, top + gap / 2 + 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgb(0 0 0 / 0.35)";
    ctx.beginPath();
    ctx.moveTo(x + 1, top + height - gap / 2 - 0.5);
    ctx.lineTo(x + w - 1, top + height - gap / 2 - 0.5);
    ctx.stroke();
    ctx.restore();
    const screwR = Math.max(2.6, 4.4 * u);
    const screwInset = Math.max(8, 12 * u);
    drawScrew(ctx, x + screwInset, top + L.rail * 0.5 + gap, screwR, 0.3 + m.index * 0.7);
    drawScrew(ctx, x + w - screwInset, top + height - L.rail * 0.5 - gap, screwR, 1.1 + m.index * 0.45);
    const ink = INK[m.face];
    const titleY = m.y + Math.max(12, 18 * u);
    text(ctx, m.title, m.cx, titleY, Math.max(10, 15 * u), 560, fonts.sans, ink);
    text(ctx, m.number, x + Math.max(8, 12 * u), m.y + Math.max(6, 6 * u) - L.rail * 0.1, Math.max(7, 8.5 * u), 520, fonts.mono, ink, "left");
    const compact = u < 0.8;
    if (m.kind === "park" && !compact) {
      text(ctx, "Spare cables", m.cx, titleY + Math.max(11, 15 * u), Math.max(7, 9.5 * u), 440, fonts.sans, ink);
    }
    if (m.kind === "source" && !compact) {
      text(ctx, "Loop", m.cx, titleY + Math.max(11, 15 * u), Math.max(7, 9.5 * u), 440, fonts.sans, ink);
    }
    if (m.vu) drawVuFace(ctx, m.vu, u, fonts);
  }
  for (const k of L.knobs) {
    const ink = INK[k.module.face];
    const r = k.r;
    const tickIn = r * (k.small ? 1.3 : 1.36);
    const tickOut = r * (k.small ? 1.48 : 1.52);
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    const count = k.small ? 7 : 11;
    for (let i = 0; i < count; i += 1) {
      const v = i / (count - 1);
      const a = ((-135 + 270 * v) * Math.PI) / 180 - Math.PI / 2;
      const major = i === 0 || i === count - 1 || i === (count - 1) / 2;
      ctx.lineWidth = Math.max(0.7, (major ? 1.5 : 1) * u);
      const o = major ? tickOut + 2 * u : tickOut;
      ctx.beginPath();
      ctx.moveTo(k.x + Math.cos(a) * tickIn, k.y + Math.sin(a) * tickIn);
      ctx.lineTo(k.x + Math.cos(a) * o, k.y + Math.sin(a) * o);
      ctx.stroke();
    }
    const compact = u < 0.8;
    if (!k.small) {
      const rn = r * 1.86;
      const size = Math.max(7, 8.5 * u);
      for (const [v, label] of compact
        ? []
        : [
            [0, "0"],
            [0.5, "5"],
            [1, "10"],
          ]) {
        const a = ((-135 + 270 * v) * Math.PI) / 180 - Math.PI / 2;
        text(ctx, label, k.x + Math.cos(a) * rn, k.y + Math.sin(a) * rn, size, 520, fonts.mono, ink);
      }
      text(ctx, k.label, k.x, k.y + r * 2.02 + 4 * u, Math.max(8, 11 * u), 490, fonts.sans, ink);
    } else {
      text(ctx, k.label, k.x, k.y - r * 2.05, Math.max(8, 10.5 * u), 490, fonts.sans, ink);
    }
    ctx.restore();
  }
  const byModule = new Map();
  for (const j of L.jacks) {
    if (!byModule.has(j.module)) byModule.set(j.module, []);
    byModule.get(j.module).push(j);
  }
  for (const [m, list] of byModule) {
    const ink = INK[m.face];
    for (const j of list) {
      if (j.kind === "jack") {
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(0.7, 1 * u);
        ctx.beginPath();
        ctx.arc(j.x, j.y, L.nutR * 1.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (u >= 0.8) text(ctx, j.label, j.x, j.y - L.nutR * 2.15, Math.max(8, 10.5 * u), 490, fonts.sans, ink);
      }
    }
    const io = list.filter((j) => j.kind === "jack");
    if (io.length === 2) {
      const wideLabels = u >= 0.8;
      const y = wideLabels ? io[0].y - L.nutR * 2.15 : io[0].y;
      const x0 = wideLabels ? io[0].x + 12 * u : io[0].x + L.nutR * 1.75;
      const x1 = wideLabels ? io[1].x - 14 * u : io[1].x - L.nutR * 1.75;
      if (x1 - x0 > 8 * u) {
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = Math.max(0.7, 1 * u);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.moveTo(x1 - 3.5 * u, y - 3 * u);
        ctx.lineTo(x1, y);
        ctx.lineTo(x1 - 3.5 * u, y + 3 * u);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const j of list) drawNut(ctx, j.x, j.y, L.nutR, m.face, j.kind === "park");
  }
  const light = ctx.createLinearGradient(0, C.y, 0, C.y + C.h);
  light.addColorStop(0, "rgb(255 250 240 / 0.07)");
  light.addColorStop(0.35, "rgb(255 250 240 / 0.02)");
  light.addColorStop(0.7, "rgb(0 0 0 / 0.04)");
  light.addColorStop(1, "rgb(0 0 0 / 0.12)");
  ctx.save();
  roundRect(ctx, C.x, C.y, C.w, C.h, 8 * u);
  ctx.clip();
  ctx.fillStyle = light;
  ctx.fillRect(C.x, C.y, C.w, C.h);
  ctx.restore();
}
