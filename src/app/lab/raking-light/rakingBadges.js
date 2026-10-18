export const CELL = 640;

const KIND_HARD = 85;
const KIND_SATIN = 170;
const KIND_TWILL = 255;

export const BADGES = [
  { key: "abbey-road", name: "Abbey Road", detail: "Enamel pin", year: 1969, widthMm: 46, tilt: -0.07 },
  { key: "revolver", name: "Revolver", detail: "Embroidered patch", year: 1966, widthMm: 76, tilt: 0.04 },
  { key: "sgt-pepper", name: "Sgt. Pepper", detail: "Drum badge", year: 1967, widthMm: 44, tilt: 0.1 },
];

function canvas2d() {
  const c = document.createElement("canvas");
  c.width = CELL;
  c.height = CELL;
  return c.getContext("2d", { willReadFrequently: true });
}

function maskOf(draw) {
  const ctx = canvas2d();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  draw(ctx);
  const px = ctx.getImageData(0, 0, CELL, CELL).data;
  const out = new Float32Array(CELL * CELL);
  for (let i = 0; i < out.length; i += 1) out[i] = px[i * 4] / 255;
  return out;
}

function blur(src, radius) {
  if (radius < 0.5) return src.slice();
  const r = Math.max(1, Math.round(radius));
  const n = CELL;
  let a = src.slice();
  let b = new Float32Array(n * n);
  const norm = 1 / (2 * r + 1);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < n; y += 1) {
      let acc = 0;
      const row = y * n;
      for (let x = -r; x <= r; x += 1) acc += a[row + Math.min(n - 1, Math.max(0, x))];
      for (let x = 0; x < n; x += 1) {
        b[row + x] = acc * norm;
        acc += a[row + Math.min(n - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < n; x += 1) {
      let acc = 0;
      for (let y = -r; y <= r; y += 1) acc += b[Math.min(n - 1, Math.max(0, y)) * n + x];
      for (let y = 0; y < n; y += 1) {
        a[y * n + x] = acc * norm;
        acc += b[Math.min(n - 1, y + r + 1) * n + x] - b[Math.max(0, y - r) * n + x];
      }
    }
  }
  return a;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function angleCode(theta) {
  const t = ((theta % Math.PI) + Math.PI) % Math.PI;
  return 1 + Math.round((t / Math.PI) * 253);
}

function figure(ctx, x, foot, s, stride) {
  const head = foot - 150 * s;
  ctx.beginPath();
  ctx.ellipse(x + 2 * s, head + 13 * s, 11 * s, 13 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 14 * s, head + 30 * s);
  ctx.quadraticCurveTo(x, head + 24 * s, x + 16 * s, head + 30 * s);
  ctx.lineTo(x + 14 * s, head + 86 * s);
  ctx.lineTo(x - 12 * s, head + 86 * s);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 10 * s;
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, head + 82 * s);
  ctx.lineTo(x - 22 * s * stride, foot - 4 * s);
  ctx.moveTo(x + 6 * s, head + 82 * s);
  ctx.lineTo(x + 26 * s * stride, foot - 4 * s);
  ctx.stroke();
  ctx.lineWidth = 8 * s;
  ctx.beginPath();
  ctx.moveTo(x - 11 * s, head + 34 * s);
  ctx.lineTo(x - 22 * s * stride, head + 74 * s);
  ctx.moveTo(x + 13 * s, head + 34 * s);
  ctx.lineTo(x + 20 * s * stride, head + 72 * s);
  ctx.stroke();
}

function buildBuffers(albedoCtx, height, layers) {
  const n = CELL * CELL;
  const mat = new Uint8Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    for (const layer of layers) {
      const w = layer.mask[i];
      if (w < 0.02) continue;
      mat[i * 4] = layer.metal ? 255 : 0;
      mat[i * 4 + 1] = Math.round(layer.gloss * 255);
      mat[i * 4 + 2] = layer.angle ? layer.angle[i] : 0;
      mat[i * 4 + 3] = layer.kind;
    }
  }
  return { albedo: albedoCtx.canvas, height, mat };
}

function abbeyRoad(sans) {
  const X0 = 40;
  const Y0 = 112;
  const W = 560;
  const H = 416;
  const WX = 64;
  const WY = 136;
  const WW = 512;
  const WH = 300;
  const barY = 452;
  const figures = [
    { x: 196, color: "#f1ede2", stride: 1 },
    { x: 290, color: "#1b1b1d", stride: -0.9 },
    { x: 384, color: "#4a4d52", stride: 1.05 },
    { x: 478, color: "#3e5f90", stride: -1 },
  ];
  const foot = 404;
  const stripes = [];
  for (let i = 0; i < 8; i += 1) {
    const cx = WX + 20 + i * 66;
    stripes.push([cx - 18, 356, cx + 18, 356, cx + 28, 436, cx - 28, 436]);
  }
  const trees = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(WX, 300);
    ctx.lineTo(WX, 226);
    const bumps = [40, 30, 52, 36, 46, 30, 44, 38, 50, 34, 42];
    let x = WX;
    bumps.forEach((r, i) => {
      const nx = Math.min(WX + WW, x + r * 1.1);
      ctx.quadraticCurveTo((x + nx) / 2, 196 - (i % 2 ? 6 : 22), nx, 222 + (i % 3) * 6);
      x = nx;
    });
    ctx.lineTo(WX + WW, 300);
    ctx.closePath();
  };
  const road = (ctx) => ctx.fillRect(WX, 300, WW, WH - 164);
  const stripePaths = (ctx) => {
    for (const s of stripes) {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(s[2], s[3]);
      ctx.lineTo(s[4], s[5]);
      ctx.lineTo(s[6], s[7]);
      ctx.closePath();
      ctx.fill();
    }
  };

  const al = canvas2d();
  roundRect(al, X0, Y0, W, H, 52);
  al.fillStyle = "#d4ae5a";
  al.fill();
  al.save();
  roundRect(al, WX, WY, WW, WH, 30);
  al.clip();
  al.fillStyle = "#c7d5dd";
  al.fillRect(WX, WY, WW, WH);
  al.fillStyle = "#3d6a3c";
  trees(al);
  al.fill();
  al.fillStyle = "#6f7270";
  road(al);
  al.fillStyle = "#f3f1ea";
  stripePaths(al);
  al.lineCap = "round";
  for (const f of figures) {
    al.fillStyle = f.color;
    al.strokeStyle = f.color;
    figure(al, f.x, foot, 0.98, f.stride);
  }
  al.restore();
  roundRect(al, WX, barY, WW, 52, 20);
  al.fillStyle = "#17171a";
  al.fill();
  al.fillStyle = "#d4ae5a";
  al.font = `640 34px ${sans}`;
  al.textAlign = "center";
  al.textBaseline = "middle";
  al.fillText("Abbey Road", CELL / 2, barY + 27);

  const plate = maskOf((c) => {
    roundRect(c, X0, Y0, W, H, 52);
    c.fill();
  });
  const windowMask = maskOf((c) => {
    roundRect(c, WX, WY, WW, WH, 30);
    c.fill();
    roundRect(c, WX, barY, WW, 52, 20);
    c.fill();
  });
  const lines = maskOf((c) => {
    c.lineWidth = 6;
    c.save();
    roundRect(c, WX, WY, WW, WH, 30);
    c.clip();
    trees(c);
    c.stroke();
    c.beginPath();
    c.moveTo(WX, 300);
    c.lineTo(WX + WW, 300);
    c.stroke();
    for (const s of stripes) {
      c.beginPath();
      c.moveTo(s[0], s[1]);
      c.lineTo(s[2], s[3]);
      c.lineTo(s[4], s[5]);
      c.lineTo(s[6], s[7]);
      c.closePath();
      c.stroke();
    }
    c.restore();
    c.font = `640 34px ${sans}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("Abbey Road", CELL / 2, barY + 27);
  });
  const figureLines = maskOf((c) => {
    for (const f of figures) {
      c.save();
      c.lineCap = "round";
      figure(c, f.x, foot, 1.04, f.stride);
      c.restore();
    }
  });
  const figureFill = maskOf((c) => {
    for (const f of figures) figure(c, f.x, foot, 0.98, f.stride);
  });
  const n = CELL * CELL;
  const metalTop = new Float32Array(n);
  const enamel = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const outline = Math.max(lines[i], Math.max(0, figureLines[i] - figureFill[i]) * 1.4);
    const top = Math.min(1, Math.max(plate[i] * (1 - windowMask[i]), outline * windowMask[i]));
    metalTop[i] = top;
    enamel[i] = Math.max(0, plate[i] * windowMask[i] - top);
  }
  const pB = blur(plate, 4);
  const mB = blur(metalTop, 1.4);
  const fB = blur(figureFill, 2);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i += 1) height[i] = 9 * pB[i] + 5.5 * mB[i] + 3.8 * plate[i] * windowMask[i] * (1 - metalTop[i]) + 0.8 * fB[i];
  return buildBuffers(al, height, [
    { mask: plate, metal: true, gloss: 0.82, kind: KIND_HARD },
    { mask: enamel, metal: false, gloss: 0.96, kind: KIND_HARD },
    { mask: metalTop, metal: true, gloss: 0.82, kind: KIND_HARD },
  ]);
}

function revolver(sans) {
  const C = CELL / 2;
  const R = 292;
  const ring0 = 258;
  const strands = [];
  const rand = (() => {
    let s = 1966;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();
  for (let i = 0; i < 30; i += 1) {
    const t = i / 29;
    const x0 = C - 190 + t * 330 + (rand() - 0.5) * 16;
    const y0 = C - 96 - Math.sin(t * Math.PI) * 56 + (rand() - 0.5) * 12;
    const sway = Math.sin(t * 5.2) * 40 + (rand() - 0.5) * 30;
    const fall = 250 + Math.sin(t * Math.PI) * 90 + rand() * 30;
    strands.push({
      p: [x0, y0, x0 - 70 + sway, y0 + fall * 0.3, x0 + 60 + sway, y0 + fall * 0.65, x0 + sway * 0.5 + (t - 0.5) * 60, y0 + fall],
      w: 5 + rand() * 4,
    });
  }
  const bez = (p, t) => {
    const u = 1 - t;
    const x = u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6];
    const y = u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7];
    return [x, y];
  };
  const clipInner = (c) => {
    c.beginPath();
    c.arc(C, C, ring0 - 8, 0, Math.PI * 2);
    c.clip();
  };
  const drawStrands = (c, colorFor) => {
    for (const s of strands) {
      let prev = bez(s.p, 0);
      for (let k = 1; k <= 48; k += 1) {
        const t = k / 48;
        const cur = bez(s.p, t);
        const taper = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.8 + 0.2;
        c.lineWidth = s.w * taper;
        if (colorFor) c.strokeStyle = colorFor(Math.atan2(cur[1] - prev[1], cur[0] - prev[0]) + Math.PI / 2);
        c.beginPath();
        c.moveTo(prev[0], prev[1]);
        c.lineTo(cur[0], cur[1]);
        c.stroke();
        prev = cur;
      }
    }
  };
  const title = (c) => {
    c.font = `680 60px ${sans}`;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillText("Revolver", C, 168);
  };

  const al = canvas2d();
  al.beginPath();
  al.arc(C, C, R, 0, Math.PI * 2);
  al.fillStyle = "#151515";
  al.fill();
  al.beginPath();
  al.arc(C, C, ring0, 0, Math.PI * 2);
  al.fillStyle = "#ebe5d4";
  al.fill();
  al.save();
  clipInner(al);
  al.strokeStyle = "#141414";
  al.lineCap = "round";
  drawStrands(al, null);
  al.restore();
  al.fillStyle = "#141414";
  title(al);

  const disc = maskOf((c) => {
    c.beginPath();
    c.arc(C, C, R, 0, Math.PI * 2);
    c.fill();
  });
  const satin = maskOf((c) => {
    c.save();
    clipInner(c);
    drawStrands(c, null);
    c.restore();
    title(c);
  });
  const angleCtx = canvas2d();
  angleCtx.lineCap = "round";
  angleCtx.save();
  clipInner(angleCtx);
  drawStrands(angleCtx, (a) => {
    const v = angleCode(a);
    return `rgb(${v} ${v} ${v})`;
  });
  angleCtx.restore();
  const tv = angleCode(Math.PI / 2);
  angleCtx.fillStyle = `rgb(${tv} ${tv} ${tv})`;
  title(angleCtx);
  const angleData = angleCtx.getImageData(0, 0, CELL, CELL).data;
  const n = CELL * CELL;
  const angle = new Uint8Array(n);
  const ring = new Float32Array(n);
  const twill = new Float32Array(n);
  const satinOnly = new Float32Array(n);
  const height = new Float32Array(n);
  const sB = blur(satin, 2.5);
  const dB = blur(disc, 4);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const r = Math.hypot(dx, dy);
      const inRing = r >= ring0 - 1 && r <= R + 1 ? 1 : 0;
      ring[i] = inRing * disc[i];
      const mid = (ring0 + R) / 2;
      const half = (R - ring0) / 2 + 3;
      const q = Math.min(1, Math.abs(r - mid) / half);
      const roll = Math.sqrt(Math.max(0, 1 - q * q));
      if (inRing) angle[i] = angleCode(Math.atan2(dy, dx));
      else if (satin[i] > 0.5) angle[i] = angleData[i * 4];
      else angle[i] = angleCode(Math.PI / 4);
      satinOnly[i] = inRing ? 0 : satin[i];
      twill[i] = Math.max(0, disc[i] - satinOnly[i] - ring[i]);
      height[i] = (5 + 7 * roll * inRing) * dB[i] + 4.2 * sB[i] * (1 - inRing);
    }
  }
  return buildBuffers(al, height, [
    { mask: twill, metal: false, gloss: 0.2, kind: KIND_TWILL, angle },
    { mask: satinOnly, metal: false, gloss: 0.5, kind: KIND_SATIN, angle },
    { mask: ring, metal: false, gloss: 0.5, kind: KIND_SATIN, angle },
  ]);
}

function sgtPepper(sans) {
  const C = CELL / 2;
  const R = 280;
  const rim = 256;
  const red0 = 196;
  const serif = "Georgia, 'Times New Roman', serif";
  const letters = (c) => {
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.font = `italic 600 54px ${serif}`;
    c.fillText("Sgt. Pepper’s", C, C - 58);
    c.font = `700 62px ${serif}`;
    c.fillText("Lonely Hearts", C, C + 26);
    c.font = `italic 600 54px ${serif}`;
    c.fillText("Club Band", C, C + 100);
  };
  const studs = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    studs.push([C + Math.cos(a) * 226, C + Math.sin(a) * 226]);
  }
  const zig = (c) => {
    c.beginPath();
    for (let i = 0; i <= 32; i += 1) {
      const a = (i / 32) * Math.PI * 2;
      const r = i % 2 ? 214 : 238;
      const x = C + Math.cos(a) * r;
      const y = C + Math.sin(a) * r;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
  };

  const al = canvas2d();
  al.beginPath();
  al.arc(C, C, R, 0, Math.PI * 2);
  al.fillStyle = "#d6b25e";
  al.fill();
  al.beginPath();
  al.arc(C, C, rim, 0, Math.PI * 2);
  al.fillStyle = "#b8232c";
  al.fill();
  al.beginPath();
  al.arc(C, C, red0, 0, Math.PI * 2);
  al.fillStyle = "#f2dc8c";
  al.fill();
  al.fillStyle = "#d6b25e";
  letters(al);
  al.strokeStyle = "#d6b25e";
  al.lineWidth = 5;
  zig(al);
  al.stroke();
  for (const [x, y] of studs) {
    al.beginPath();
    al.arc(x, y, 7, 0, Math.PI * 2);
    al.fill();
  }
  al.fillStyle = "#2f5aa8";
  al.beginPath();
  al.moveTo(C, C + 176);
  al.bezierCurveTo(C - 30, C + 150, C - 24, C + 128, C, C + 140);
  al.bezierCurveTo(C + 24, C + 128, C + 30, C + 150, C, C + 176);
  al.fill();

  const disc = maskOf((c) => {
    c.beginPath();
    c.arc(C, C, R, 0, Math.PI * 2);
    c.fill();
  });
  const raised = maskOf((c) => {
    c.beginPath();
    c.arc(C, C, R, 0, Math.PI * 2);
    c.arc(C, C, rim, 0, Math.PI * 2, true);
    c.fill("evenodd");
    c.lineWidth = 7;
    c.beginPath();
    c.arc(C, C, red0, 0, Math.PI * 2);
    c.stroke();
    letters(c);
    c.lineWidth = 5;
    zig(c);
    c.stroke();
    for (const [x, y] of studs) {
      c.beginPath();
      c.arc(x, y, 7, 0, Math.PI * 2);
      c.fill();
    }
  });
  const n = CELL * CELL;
  const enamel = new Float32Array(n);
  const height = new Float32Array(n);
  const dB = blur(disc, 3);
  const rB = blur(raised, 1.2);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const r = Math.hypot(x + 0.5 - C, y + 0.5 - C) / R;
      const dome = 1 - r * r;
      enamel[i] = Math.max(0, disc[i] - raised[i]);
      height[i] = dB[i] * (7 + 9 * Math.max(0, dome)) + 3.2 * rB[i];
    }
  }
  return buildBuffers(al, height, [
    { mask: disc, metal: true, gloss: 0.85, kind: KIND_HARD },
    { mask: enamel, metal: false, gloss: 0.97, kind: KIND_HARD },
  ]);
}

export function buildBadges(sans) {
  return [abbeyRoad(sans), revolver(sans), sgtPepper(sans)];
}
