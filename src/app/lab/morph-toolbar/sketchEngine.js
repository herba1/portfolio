const DPR_CAP = 2;

export const PAPER = "#fbfaf7";

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function dot(ctx, p, cx, cy) {
  ctx.beginPath();
  ctx.arc(p[0] + cx, p[1] + cy, Math.max(0.5, p[2] / 2), 0, Math.PI * 2);
  ctx.fill();
}

function segment(ctx, pts, i, cx, cy) {
  const p = pts[i];
  const prev = pts[i - 1];
  ctx.lineWidth = Math.max(0.5, p[2]);
  ctx.beginPath();
  if (i === 1) {
    ctx.moveTo(prev[0] + cx, prev[1] + cy);
    const m = mid(prev, p);
    ctx.lineTo(m[0] + cx, m[1] + cy);
  } else {
    const a = mid(pts[i - 2], prev);
    const b = mid(prev, p);
    ctx.lineWidth = Math.max(0.5, prev[2]);
    ctx.moveTo(a[0] + cx, a[1] + cy);
    ctx.quadraticCurveTo(prev[0] + cx, prev[1] + cy, b[0] + cx, b[1] + cy);
  }
  ctx.stroke();
}

function tail(ctx, pts, cx, cy) {
  const n = pts.length;
  if (n < 2) return;
  const last = pts[n - 1];
  const m = mid(pts[n - 2], last);
  ctx.lineWidth = Math.max(0.5, last[2]);
  ctx.beginPath();
  ctx.moveTo(m[0] + cx, m[1] + cy);
  ctx.lineTo(last[0] + cx, last[1] + cy);
  ctx.stroke();
}

function prepare(ctx, stroke) {
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function renderStroke(ctx, stroke, cx, cy) {
  const pts = stroke.pts;
  prepare(ctx, stroke);
  if (pts.length === 1) {
    dot(ctx, pts[0], cx, cy);
    return;
  }
  for (let i = 1; i < pts.length; i += 1) segment(ctx, pts, i, cx, cy);
  tail(ctx, pts, cx, cy);
}

export function createSketch(base, live, scratch) {
  const bctx = base.getContext("2d");
  const lctx = live.getContext("2d");
  const sctx = scratch.getContext("2d");
  const state = { w: 0, h: 0, dpr: 1, strokes: [], current: null, drawn: 0 };

  function center() {
    return [state.w / 2, state.h / 2];
  }

  function commit(stroke) {
    const [cx, cy] = center();
    if (stroke.tool === "eraser") {
      bctx.save();
      bctx.globalCompositeOperation = "destination-out";
      renderStroke(bctx, { ...stroke, color: "#000" }, cx, cy);
      bctx.restore();
      return;
    }
    if (stroke.opacity >= 1 && stroke.tool !== "highlighter") {
      renderStroke(bctx, stroke, cx, cy);
      return;
    }
    sctx.clearRect(0, 0, state.w, state.h);
    renderStroke(sctx, stroke, cx, cy);
    bctx.save();
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalAlpha = stroke.opacity;
    bctx.globalCompositeOperation = stroke.tool === "highlighter" ? "multiply" : "source-over";
    bctx.drawImage(scratch, 0, 0);
    bctx.restore();
  }

  function redraw() {
    bctx.clearRect(0, 0, state.w, state.h);
    for (const s of state.strokes) commit(s);
  }

  function resize(w, h) {
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    if (w === state.w && h === state.h && dpr === state.dpr) return;
    state.w = w;
    state.h = h;
    state.dpr = dpr;
    for (const [c, ctx] of [[base, bctx], [live, lctx], [scratch, sctx]]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    redraw();
  }

  function begin(stroke) {
    state.current = stroke;
    state.drawn = 0;
  }

  function flush() {
    const s = state.current;
    if (!s) return;
    const [cx, cy] = center();
    const pts = s.pts;
    const target = s.tool === "eraser" ? bctx : lctx;
    if (s.tool === "eraser") {
      bctx.save();
      bctx.globalCompositeOperation = "destination-out";
    }
    prepare(target, s.tool === "eraser" ? { color: "#000" } : s);
    if (state.drawn === 0 && pts.length > 0) {
      dot(target, pts[0], cx, cy);
      state.drawn = 1;
    }
    for (let i = Math.max(1, state.drawn); i < pts.length; i += 1) segment(target, pts, i, cx, cy);
    state.drawn = pts.length;
    if (s.tool === "eraser") bctx.restore();
  }

  function end() {
    const s = state.current;
    if (!s) return;
    flush();
    const [cx, cy] = center();
    if (s.tool === "eraser") {
      bctx.save();
      bctx.globalCompositeOperation = "destination-out";
      prepare(bctx, { color: "#000" });
      tail(bctx, s.pts, cx, cy);
      bctx.restore();
    } else {
      lctx.clearRect(0, 0, state.w, state.h);
      commit(s);
    }
    state.strokes.push(s);
    state.current = null;
  }

  function undo() {
    if (!state.strokes.length) return false;
    state.strokes.pop();
    redraw();
    return true;
  }

  function seed(strokes) {
    state.strokes = strokes;
    redraw();
  }

  return { state, resize, begin, flush, end, undo, seed, center };
}

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function handPath(points, { size, rand, closed = false, wobble = 1.1, taper = true }) {
  const src = closed ? [...points, points[0], points[1]] : points;
  const out = [];
  const ph1 = rand() * 6.28;
  const ph2 = rand() * 6.28;
  let total = 0;
  for (let i = 1; i < src.length; i += 1) total += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
  let walked = 0;
  for (let i = 1; i < src.length; i += 1) {
    const a = src[i - 1];
    const b = src[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(len / 4));
    const nx = -(b[1] - a[1]) / (len || 1);
    const ny = (b[0] - a[0]) / (len || 1);
    for (let j = i === 1 ? 0 : 1; j <= steps; j += 1) {
      const f = j / steps;
      const d = walked + len * f;
      const off = wobble * (Math.sin(d * 0.045 + ph1) * 0.7 + Math.sin(d * 0.11 + ph2) * 0.3);
      const t = total ? d / total : 0;
      const w = taper ? size * (0.62 + 0.5 * (1 - Math.sin(Math.PI * t)) ** 2) : size;
      out.push([a[0] + (b[0] - a[0]) * f + nx * off, a[1] + (b[1] - a[1]) * f + ny * off, w]);
    }
    walked += len;
  }
  return out;
}

function arc(cx, cy, r, from, to, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = from + (to - from) * (i / n);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function quad(a, c, b, n) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return pts;
}

function roundRect(x, y, w, h, r) {
  return [
    ...arc(x + w - r, y + r, r, -Math.PI / 2, 0, 6),
    ...arc(x + w - r, y + h - r, r, 0, Math.PI / 2, 6),
    ...arc(x + r, y + h - r, r, Math.PI / 2, Math.PI, 6),
    ...arc(x + r, y + r, r, Math.PI, Math.PI * 1.5, 6),
  ];
}

export function seedSketch(boxW, boxH, ink) {
  const rand = rng(1963);
  const s = Math.max(0.62, Math.min(1.25, Math.min((boxW - 56) / 400, (boxH - 220) / 330)));
  const oy = -40 * s;
  const P = (x, y) => [x * s, y * s + oy];
  const pen = (pts, opts = {}) => ({
    tool: "pen",
    color: opts.color || ink,
    size: 2.6,
    opacity: 1,
    pts: handPath(pts.map(([x, y]) => P(x, y)), { size: (opts.size || 2.6) * Math.min(1.1, s + 0.15), rand, ...opts }),
  });
  const strokes = [];
  strokes.push({
    tool: "highlighter",
    color: "#f5c518",
    size: 18,
    opacity: 0.42,
    pts: handPath([P(-118, 72), P(10, 69)], { size: 22 * s, rand, wobble: 0.6, taper: false }),
  });
  strokes.push(pen(roundRect(-150, -150, 300, 300, 22), { closed: true, wobble: 1.4 }));
  strokes.push(pen([[-122, -122], [-122, 38], [38, 38], [38, -122], [-121, -121]], { wobble: 1 }));
  strokes.push(pen([[-122, -122], [38, 38]], { size: 1.8, wobble: 0.8 }));
  strokes.push(pen([[38, -122], [-122, 38]], { size: 1.8, wobble: 0.8 }));
  strokes.push(pen([[-120, 70], [8, 70]], { size: 3.2, wobble: 0.5 }));
  strokes.push(pen([[-120, 98], [-30, 98]], { size: 2, wobble: 0.5 }));
  strokes.push(pen(arc(94, 112, 18, -Math.PI * 0.9, Math.PI * 1.15, 22), { size: 2.2 }));
  strokes.push(pen([[89, 103], [89, 121], [104, 112], [89, 103]], { size: 2.2, wobble: 0.4 }));
  strokes.push(pen(arc(95, 111, 31, Math.PI * 1.2, Math.PI * 3.35, 40).map(([x, y], i) => [x + i * 0.12, y * 0.92 + 8]), { color: "#ef4444", size: 2.2, wobble: 1.2 }));
  strokes.push(pen(quad([186, -128], [150, -150], [62, -92], 24), { color: "#3b82f6", size: 2.2, wobble: 0.5 }));
  strokes.push(pen([[74, -110], [62, -92], [84, -88]], { color: "#3b82f6", size: 2.2, wobble: 0.3 }));
  return strokes;
}
