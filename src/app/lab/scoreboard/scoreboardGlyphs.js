const STROKE = 0.17;
const GAP = 0.13;

const WIDTHS = {
  0: 0.58,
  1: 0.42,
  2: 0.58,
  3: 0.58,
  4: 0.6,
  5: 0.58,
  6: 0.58,
  7: 0.56,
  8: 0.58,
  9: 0.58,
  G: 0.6,
  U: 0.58,
  L: 0.5,
  S: 0.58,
  M: 0.74,
  I: 0.17,
  E: 0.52,
  R: 0.58,
  H: 0.6,
  A: 0.62,
  K: 0.6,
  O: 0.6,
  N: 0.6,
  T: 0.56,
};

function box(w) {
  const h = STROKE / 2;
  const L = h;
  const R = w - h;
  const T = h;
  const B = 1 - h;
  const cx = w / 2;
  const r = (R - L) / 2;
  return { L, R, T, B, cx, r, M: 0.5 };
}

const PATHS = {
  0(c, g) {
    c.moveTo(g.L, g.T + g.r);
    c.arc(g.cx, g.T + g.r, g.r, Math.PI, Math.PI * 2);
    c.lineTo(g.R, g.B - g.r);
    c.arc(g.cx, g.B - g.r, g.r, 0, Math.PI);
    c.closePath();
  },
  1(c, g) {
    const x = g.R - 0.02;
    c.moveTo(g.L - 0.02, g.T + 0.16);
    c.lineTo(x, g.T - 0.01);
    c.lineTo(x, g.B + STROKE / 2);
  },
  2(c, g) {
    c.moveTo(g.L, g.T + g.r + 0.02);
    c.arc(g.cx, g.T + g.r, g.r, Math.PI, Math.PI * 2 + 0.42);
    c.lineTo(g.L, g.B);
    c.lineTo(g.R + STROKE / 2, g.B);
  },
  3(c, g) {
    const ru = (g.M - g.T) / 2 + 0.01;
    const rl = (g.B - g.M) / 2 + 0.01;
    c.moveTo(g.L, g.T + ru * 0.85);
    c.ellipse(g.cx, g.T + ru, g.r, ru, 0, Math.PI * 1.08, Math.PI * 2.5);
    c.ellipse(g.cx, g.B - rl, g.r * 1.02, rl, 0, -Math.PI * 0.5, Math.PI * 0.94);
  },
  4(c, g) {
    const stem = g.R - 0.1;
    const bar = g.B - 0.3;
    c.moveTo(stem, g.B + STROKE / 2);
    c.lineTo(stem, g.T);
    c.lineTo(g.L, bar);
    c.lineTo(g.R + STROKE / 2, bar);
  },
  5(c, g) {
    const top = g.M - 0.06;
    const rb = (g.B - top) / 2;
    const cy = g.B - rb;
    c.moveTo(g.R + 0.02, g.T);
    c.lineTo(g.L + 0.02, g.T);
    c.lineTo(g.L, top + 0.02);
    c.ellipse(g.cx, cy, g.r * 1.04, rb, 0, -Math.PI * 0.8, Math.PI * 0.88);
  },
  6(c, g) {
    const rb = (g.B - g.M + 0.06) / 2;
    const cy = g.B - rb;
    c.moveTo(g.R - 0.02, g.T + 0.02);
    c.quadraticCurveTo(g.L, g.T + 0.06, g.L, cy);
    c.moveTo(g.L + g.r * 2, cy);
    c.ellipse(g.cx, cy, g.r, rb, 0, 0, Math.PI * 2);
  },
  7(c, g) {
    c.moveTo(g.L - 0.01, g.T);
    c.lineTo(g.R, g.T);
    c.lineTo(g.cx - 0.06, g.B + STROKE / 2);
  },
  8(c, g) {
    const ru = (g.M - g.T) / 2 + 0.005;
    const rl = (g.B - g.M) / 2 + 0.03;
    c.moveTo(g.cx + g.r * 0.88, g.T + ru);
    c.ellipse(g.cx, g.T + ru, g.r * 0.88, ru, 0, 0, Math.PI * 2);
    c.moveTo(g.cx + g.r, g.B - rl);
    c.ellipse(g.cx, g.B - rl, g.r, rl, 0, 0, Math.PI * 2);
  },
  9(c, g) {
    const rb = (g.B - g.M + 0.06) / 2;
    const cy = g.T + rb;
    c.moveTo(g.L + 0.02, g.B - 0.02);
    c.quadraticCurveTo(g.R, g.B - 0.06, g.R, cy);
    c.moveTo(g.L + g.r * 2, cy);
    c.ellipse(g.cx, cy, g.r, rb, 0, 0, Math.PI * 2);
  },
  G(c, g) {
    c.moveTo(g.R, g.T + g.r * 0.7);
    c.arc(g.cx, g.T + g.r, g.r, -0.32, Math.PI, true);
    c.lineTo(g.L, g.B - g.r);
    c.arc(g.cx, g.B - g.r, g.r, Math.PI, 0, true);
    c.lineTo(g.R, g.M + 0.02);
    c.lineTo(g.cx + 0.02, g.M + 0.02);
  },
  U(c, g) {
    c.moveTo(g.L, g.T - STROKE / 2);
    c.lineTo(g.L, g.B - g.r);
    c.arc(g.cx, g.B - g.r, g.r, Math.PI, 0, true);
    c.lineTo(g.R, g.T - STROKE / 2);
  },
  L(c, g) {
    c.moveTo(g.L, g.T - STROKE / 2);
    c.lineTo(g.L, g.B);
    c.lineTo(g.R + STROKE / 2, g.B);
  },
  S(c, g) {
    const ru = (g.M - g.T) / 2 + 0.01;
    const rl = (g.B - g.M) / 2 + 0.01;
    c.moveTo(g.R, g.T + ru * 0.7);
    c.ellipse(g.cx, g.T + ru, g.r, ru, 0, -0.3, -Math.PI * 1.5, true);
    c.ellipse(g.cx, g.B - rl, g.r * 1.02, rl, 0, -Math.PI * 0.5, Math.PI * 0.88);
  },
  M(c, g) {
    c.moveTo(g.L, g.B + STROKE / 2);
    c.lineTo(g.L, g.T);
    c.lineTo(g.cx, g.M + 0.14);
    c.lineTo(g.R, g.T);
    c.lineTo(g.R, g.B + STROKE / 2);
  },
  I(c, g) {
    c.moveTo(g.cx, g.T - STROKE / 2);
    c.lineTo(g.cx, g.B + STROKE / 2);
  },
  E(c, g) {
    c.moveTo(g.R + STROKE / 2, g.T);
    c.lineTo(g.L, g.T);
    c.lineTo(g.L, g.B);
    c.lineTo(g.R + STROKE / 2, g.B);
    c.moveTo(g.L, g.M);
    c.lineTo(g.R - 0.04, g.M);
  },
  R(c, g) {
    const rb = (g.M - g.T) / 2 + 0.02;
    c.moveTo(g.L, g.B + STROKE / 2);
    c.lineTo(g.L, g.T);
    c.lineTo(g.R - rb, g.T);
    c.arc(g.R - rb, g.T + rb, rb, -Math.PI / 2, Math.PI / 2);
    c.lineTo(g.L, g.T + rb * 2);
    c.moveTo(g.cx - 0.02, g.T + rb * 2);
    c.lineTo(g.R + 0.02, g.B + STROKE / 2);
  },
  H(c, g) {
    c.moveTo(g.L, g.T - STROKE / 2);
    c.lineTo(g.L, g.B + STROKE / 2);
    c.moveTo(g.R, g.T - STROKE / 2);
    c.lineTo(g.R, g.B + STROKE / 2);
    c.moveTo(g.L, g.M);
    c.lineTo(g.R, g.M);
  },
  A(c, g) {
    c.moveTo(g.L - 0.02, g.B + STROKE / 2);
    c.lineTo(g.cx, g.T - 0.02);
    c.lineTo(g.R + 0.02, g.B + STROKE / 2);
    c.moveTo(g.L + 0.1, g.B - 0.28);
    c.lineTo(g.R - 0.1, g.B - 0.28);
  },
  K(c, g) {
    c.moveTo(g.L, g.T - STROKE / 2);
    c.lineTo(g.L, g.B + STROKE / 2);
    c.moveTo(g.R + 0.02, g.T - 0.02);
    c.lineTo(g.L, g.M + 0.06);
    c.moveTo(g.L + 0.14, g.M - 0.04);
    c.lineTo(g.R + 0.02, g.B + STROKE / 2);
  },
  O(c, g) {
    PATHS[0](c, g);
  },
  N(c, g) {
    c.moveTo(g.L, g.B + STROKE / 2);
    c.lineTo(g.L, g.T);
    c.lineTo(g.R, g.B);
    c.lineTo(g.R, g.T - STROKE / 2);
  },
  T(c, g) {
    c.moveTo(g.L - 0.02, g.T);
    c.lineTo(g.R + 0.02, g.T);
    c.moveTo(g.cx, g.T);
    c.lineTo(g.cx, g.B + STROKE / 2);
  },
};

export function measureText(text, height, squeeze = 1) {
  let w = 0;
  for (let i = 0; i < text.length; i += 1) {
    w += (WIDTHS[text[i]] ?? 0.4) * squeeze;
    if (i < text.length - 1) w += GAP * squeeze;
  }
  return w * height;
}

export function strokeText(ctx, text, x, y, height, { squeeze = 1, weight = 1, jitter = null } = {}) {
  let pen = x;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const w = WIDTHS[ch] ?? 0.4;
    const draw = PATHS[ch];
    if (draw) {
      ctx.save();
      ctx.translate(pen, y);
      if (jitter) ctx.rotate(jitter());
      ctx.scale(height * squeeze, height);
      ctx.beginPath();
      draw(ctx, box(w));
      ctx.lineWidth = STROKE * weight;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.miterLimit = 4;
      ctx.stroke();
      ctx.restore();
    }
    pen += (w + GAP) * height * squeeze;
  }
}
