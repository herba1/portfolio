import { createStage, clamp } from "../_kit/stage";

// Letters that come from the raster, after Crouwel's New Alphabet: every
// glyph is drawn once on a 5 x 9 design grid (a 5 x 5 body, two rows of
// ascender, two of descender) as runs of horizontal and vertical strokes, one
// design cell thick, with every outer corner cut at 45 degrees across the
// full stroke. The design grid is fixed on the page; the letters never move
// when the raster changes.
//
// The outline is never drawn. Every frame it is filled into an offscreen
// canvas at 8 x 8 samples per raster cell, and each cell takes the fraction
// of its area the letter covers, 0 to 1. That fraction is the dot: a pinpoint
// circle at the edge of a stroke, a round dot at half, a square that closes
// up to the full cell at one. The raster is pinned at the centre of the box
// and its pitch is continuous: drag and it slides between five and twenty
// cells across a letter. Where the pitch is a whole multiple of the design
// grid (5, 10, 15, 20) the two lock and the letters come out clean; anywhere
// between, stems and cuts land on every phase of the screen and the word
// fills with graded dots and beat bands that travel as the pitch moves.

const GLYPHS = {
  a: [5, "0,2 4,2 4,6 0,6 0,4 4,4"],
  b: [5, "0,0 0,6 4,6 4,2 0,2"],
  c: [5, "4,2 0,2 0,6 4,6"],
  d: [5, "4,0 4,6 0,6 0,2 4,2"],
  e: [5, "0,4 4,4 4,2 0,2 0,6 4,6"],
  f: [4, "3,0 1,0 1,6", "0,2 3,2"],
  g: [5, "4,6 0,6 0,2 4,2 4,8 0,8"],
  h: [5, "0,0 0,6", "0,2 4,2 4,6"],
  i: [1, "0,2 0,6", "0,0"],
  j: [3, "2,2 2,8 0,8", "2,0"],
  k: [5, "0,0 0,6", "0,4 4,4 4,6", "2,4 2,2 4,2"],
  l: [1, "0,0 0,6"],
  m: [7, "0,6 0,2 6,2 6,6", "3,2 3,6"],
  n: [5, "0,6 0,2 4,2 4,6"],
  o: [5, "0,2 4,2 4,6 0,6 z"],
  p: [5, "0,8 0,2 4,2 4,6 0,6"],
  q: [5, "4,8 4,2 0,2 0,6 4,6"],
  r: [4, "0,6 0,2 3,2"],
  s: [5, "4,2 0,2 0,4 4,4 4,6 0,6"],
  t: [4, "1,0 1,6 3,6", "0,2 3,2"],
  u: [5, "0,2 0,6 4,6 4,2"],
  v: [5, "0,2 0,6* 4,6* 4,2"],
  w: [7, "0,2 0,6* 6,6* 6,2", "3,2 3,6"],
  x: [5, "0,2 2,2 2,6 4,6", "4,2 4,3", "0,5 0,6"],
  y: [5, "0,2 0,6 4,6", "4,2 4,8 0,8"],
  z: [5, "0,2 4,2 4,4 0,4 0,6 4,6"],
  0: [5, "0,0 4,0 4,6 0,6 z"],
  1: [3, "0,0 2,0 2,6"],
  2: [5, "0,0 4,0 4,3 0,3 0,6 4,6"],
  3: [5, "0,0 4,0 4,6 0,6", "1,3 4,3"],
  4: [5, "0,0 0,4 4,4", "4,0 4,6"],
  5: [5, "4,0 0,0 0,3 4,3 4,6 0,6"],
  6: [5, "4,0 0,0 0,6 4,6 4,3 0,3"],
  7: [5, "0,0 4,0 4,6"],
  8: [5, "0,0 4,0 4,6 0,6 z", "0,3 4,3"],
  9: [5, "4,3 0,3 0,0 4,0 4,6 0,6"],
  "'": [1, "0,0 0,1"],
  ".": [1, "0,6"],
  ",": [1, "0,6 0,7"],
  "-": [3, "0,4 2,4"],
  "!": [1, "0,0 0,4", "0,6"],
  "?": [5, "0,0 4,0 4,3 2,3 2,4", "2,6"],
  "&": [5, "4,6 0,6 0,3 3,3 3,0 0,0 0,2"],
  " ": [0],
};

const parse = (src) => {
  const closed = /z\s*$/.test(src);
  const pts = src
    .replace(/z\s*$/, "")
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const deep = tok.endsWith("*");
      const [x, y] = tok.replace("*", "").split(",").map(Number);
      return { x, y, deep };
    });
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const dirs = [];
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    dirs.push([Math.sign(b.x - a.x), Math.sign(b.y - a.y)]);
  }
  return { pts, closed, dirs };
};

const DEFS = {};
for (const [ch, [cols, ...strokes]] of Object.entries(GLYPHS)) DEFS[ch] = { cols, strokes: strokes.map(parse) };

const W_MIN = 5;
const W_MAX = 20;
const INK = "#0b0b0b";
const ACCENT = "#e3311d";
const DOT = "#c4c4c0";
// Samples per raster cell, each way.
const SS = 8;

// The design grid, in design cells: a full-width letter is five across and
// nine tall, strokes and letter gaps are one, a word space two, the line
// leading three.
const M = { H: 9, gap: 1, lead: 3, space: 2, deep: 2 };
const glyphCells = (def) => (def.cols === 0 ? M.space : def.cols);

const lineCells = (chars) => {
  let w = 0;
  chars.forEach((ch, i) => {
    w += glyphCells(DEFS[ch] || DEFS[" "]) + (i ? M.gap : 0);
  });
  return w;
};

// Break on the design grid, so the lines never reshuffle while the raster
// changes underneath them.
const breakLines = (text, aspect) => {
  const words = text.split(" ").filter((w) => w.length);
  if (!words.length) return [[]];
  const wordW = words.map((w) => lineCells([...w]));
  const spaceW = M.space + 2 * M.gap;
  const total = wordW.reduce((a, b) => a + b, 0) + spaceW * (words.length - 1);
  let best = null;
  for (let max = Math.max(...wordW); max <= total; max++) {
    const lines = [[]];
    let w = 0;
    words.forEach((word, i) => {
      const add = (lines[lines.length - 1].length ? spaceW : 0) + wordW[i];
      if (lines[lines.length - 1].length && w + add > max) {
        lines.push([word]);
        w = wordW[i];
      } else {
        lines[lines.length - 1].push(word);
        w += add;
      }
    });
    if (lines.length > 4) continue;
    const widest = Math.max(...lines.map((l) => lineCells([...l.join(" ")])));
    const tall = lines.length * M.H + (lines.length - 1) * M.lead;
    const score = Math.min(aspect / widest, 1 / tall);
    if (!best || score > best.score * 1.04) best = { score, lines };
  }
  return best.lines.map((l) => [...l.join(" ")]);
};

const spring = (v) => ({ v, vel: 0, to: v });
const stepSpring = (s, dt, k, d) => {
  const a = (s.to - s.v) * k - s.vel * d;
  s.vel += a * dt;
  s.v += s.vel * dt;
};

// One halftone dot of coverage `a` in a cell of side `cell`, centred on
// (cx, cy), with area a x cell^2: a circle up to pi/4, where it touches the
// cell walls, then a square whose corner radius closes to zero at one.
const ROUND = Math.PI / 4;
const dot = (path, cx, cy, cell, a) => {
  const half = cell / 2;
  if (a >= 0.998) {
    path.rect(cx - half, cy - half, cell, cell);
  } else if (a <= ROUND) {
    const r = cell * Math.sqrt(a / Math.PI);
    path.moveTo(cx + r, cy);
    path.arc(cx, cy, r, 0, Math.PI * 2);
  } else {
    path.roundRect(cx - half, cy - half, cell, cell, half * Math.sqrt((1 - a) / (1 - ROUND)));
  }
};

export async function createRaster(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2 });
  const { canvas, ctx } = stage;
  canvas.style.cursor = "ns-resize";

  const q = new URLSearchParams(location.search);
  let text = (q.get("text") || "computer love").toLowerCase();
  // Raster cells across a full-width letter. Continuous.
  let Wf = clamp(+(q.get("w") || 7), W_MIN, W_MAX);
  const freezeFrom = q.has("from") ? clamp(+q.get("from"), W_MIN, W_MAX) : null;
  const freezeAt = q.has("at") ? +q.get("at") / 1000 : null;

  // Hidden input so phones raise a keyboard.
  const input = document.createElement("input");
  input.setAttribute("aria-label", "song title");
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  Object.assign(input.style, { position: "absolute", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", border: "0", padding: "0", pointerEvents: "none" });
  host.appendChild(input);

  let glyphs = []; // { ch, strokes: [{ def, pts:[{x,y}springs], h, c:[] , wait }] }
  let dying = [];
  let lines = [[]];
  // The raster is pinned to one point, the middle of the box; only its
  // pitch changes. The design grid `g` is pinned to the same point, so the
  // two lock wherever the pitch divides it.
  const raster = { cell: 0, g: 0 };
  const anchor = { x: 0, y: 0 };
  const caret = { x: spring(0), y: spring(0), w: spring(0), h: spring(0) };
  let lastKey = -10;
  let clock = 0;
  let dirty = true;
  // The coverage is only re-measured when the ink or the raster moved.
  let coverDirty = true;
  // A continuous pitch change shows the new sampling at once; a jump
  // (keys, resize, a new word) knocks the field back and lets it rebuild.
  let snapCells = false;

  const makeGlyph = (ch) => {
    const def = DEFS[ch] || DEFS["?"];
    return {
      ch,
      strokes: def.strokes.map((s) => ({
        def: s,
        pts: s.pts.map(() => ({ x: spring(0), y: spring(0) })),
        c: s.pts.map(() => spring(0)),
        h: spring(0),
        wait: 0,
        fresh: true,
      })),
    };
  };

  const syncGlyphs = () => {
    const chars = [...text];
    let keep = 0;
    while (keep < glyphs.length && keep < chars.length && glyphs[keep].ch === chars[keep]) keep++;
    for (const g of glyphs.slice(keep)) {
      for (const s of g.strokes) {
        s.h.to = 0;
        s.wait = 0;
      }
      dying.push(g);
    }
    glyphs = glyphs.slice(0, keep).concat(chars.slice(keep).map(makeGlyph));
  };

  let layoutAspect = 0;
  const relayout = (mode) => {
    const bw = stage.width;
    const bh = stage.height;
    const dpr = stage.dpr;
    const aspect = (bw * 0.82) / (bh * 0.62);
    if (mode === "text" || Math.abs(aspect - layoutAspect) > 0.01) {
      const flat = text.replace(/\s+/g, " ").trim();
      lines = breakLines(flat, aspect);
      layoutAspect = aspect;
    }
    const widest = Math.max(1, ...lines.map((l) => lineCells(l)));
    const tall = lines.length * M.H + (lines.length - 1) * M.lead;
    let g = Math.min((bw * 0.82) / widest, (bh * 0.62) / tall, (bh * 0.34) / M.H);
    g = Math.max(1 / dpr, Math.floor(g * dpr) / dpr);
    const snap = (v) => Math.round(v * dpr) / dpr;
    const was = { cell: raster.cell, x: anchor.x, y: anchor.y };
    anchor.x = snap(bw / 2);
    anchor.y = snap(bh / 2);
    raster.g = g;
    raster.cell = (g * 5) / Wf;
    if (was.cell && (was.cell !== raster.cell || was.x !== anchor.x || was.y !== anchor.y)) {
      if (mode === "drag") snapCells = true;
      else resample(was);
    }
    coverDirty = true;
    const ox = anchor.x - Math.floor(widest / 2) * g;
    const oy = anchor.y - Math.floor(tall / 2) * g;

    // Map the visible characters (spaces collapsed, as laid out) onto glyphs.
    let gi = 0;
    const chars = [...text];
    let cx = 0;
    let cy = 0;
    let lastRight = 0;
    let lastLine = 0;
    const place = (gl, x0, y0) => {
      gl.strokes.forEach((s, si) => {
        s.def.pts.forEach((p, pi) => {
          s.pts[pi].x.to = x0 + (p.x + 0.5) * g;
          s.pts[pi].y.to = y0 + (p.y + 0.5) * g;
          s.c[pi].to = p.deep ? M.deep * g : g;
        });
        s.h.to = g / 2;
        if (s.fresh) {
          s.fresh = false;
          s.pts.forEach((pt) => {
            pt.x.v = pt.x.to;
            pt.y.v = pt.y.to;
          });
          s.c.forEach((c) => (c.v = c.to));
          s.wait = si * 0.03;
        }
      });
    };
    lines.forEach((line, li) => {
      cx = 0;
      cy = li * (M.H + M.lead);
      line.forEach((ch, ci) => {
        // skip over whitespace runs in the source that the layout collapsed
        while (gi < chars.length && /\s/.test(chars[gi]) && ch !== " ") gi++;
        if (ci) cx += M.gap;
        const def = DEFS[ch] || DEFS["?"];
        const gl = glyphs[gi];
        if (gl) place(gl, ox + cx * g, oy + cy * g);
        cx += glyphCells(def);
        gi++;
      });
      lastRight = cx;
      lastLine = li;
    });
    // Leftover glyphs (trailing whitespace) have no strokes; nothing to place.
    const atEnd = text.endsWith(" ");
    caret.x.to = ox + (lastRight + (lastRight ? M.gap : 0) + (atEnd ? M.space + M.gap : 0)) * g;
    caret.y.to = oy + (lastLine * (M.H + M.lead) + 6) * g;
    caret.w.to = 5 * g;
    caret.h.to = g;
    dirty = true;
  };

  // `mode` "drag" for a continuous change, "grid" for a jump.
  const setW = (next, mode) => {
    next = clamp(next, W_MIN, W_MAX);
    if (Math.abs(next - Wf) < 1e-4) return;
    Wf = next;
    relayout(mode);
  };
  const setText = (next) => {
    text = next.slice(0, 32);
    syncGlyphs();
    lastKey = clock;
    relayout("text");
  };

  // ---- input
  let drag = null;
  stage.on("down", (p) => {
    drag = { y: p.y, x: p.x, w: Wf, moved: false };
  });
  stage.on("move", (p) => {
    if (!drag) return;
    const dy = p.y - drag.y;
    if (Math.abs(dy) > 4 || Math.abs(p.x - drag.x) > 4) drag.moved = true;
    setW(drag.w - dy / 24, "drag");
  });
  stage.on("up", () => {
    if (drag && !drag.moved) input.focus({ preventScroll: true });
    drag = null;
  });
  const onWheel = (e) => {
    e.preventDefault();
    setW(Wf - e.deltaY / 240, "drag");
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      setText(text.slice(0, -1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setW(Math.round(Wf) + (e.key === "ArrowUp" ? 1 : -1), "grid");
    } else if (e.key.length === 1) {
      const ch = e.key.toLowerCase();
      if (!DEFS[ch]) return;
      e.preventDefault();
      if (ch === " " && (text.endsWith(" ") || !text.length)) return;
      setText(text + ch);
    }
  };
  window.addEventListener("keydown", onKey);
  input.addEventListener("input", () => {
    input.value = "";
  });

  // ---- drawing
  // The paper is one dot tile repeated: drawn once per pitch at a whole
  // number of device pixels, then scaled by the pattern to the exact cell.
  let tileKey = "";
  let pat = null;
  const tile = (color, size, r) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const t = c.getContext("2d");
    t.fillStyle = color;
    t.beginPath();
    t.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    t.fill();
    return c;
  };
  const dotRadius = (cell) => clamp(cell * 0.075, 0.7, 1.5);
  const dotPatterns = (dpr, cell, ox, oy) => {
    const size = Math.max(2, Math.ceil(cell * dpr));
    const r = dotRadius(cell) * dpr * (size / (cell * dpr));
    const key = size + ":" + r.toFixed(2);
    if (key !== tileKey) {
      tileKey = key;
      pat = ctx.createPattern(tile(DOT, size, r), "repeat");
    }
    const k = (cell * dpr) / size;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, ox * dpr, oy * dpr]));
  };

  // ---- cells
  // The outlines are filled into `cover` at SS x SS pixels per raster cell,
  // over the box that holds the ink, and the alpha of each block is summed:
  // that sum over SS^2 is the share of the cell the letter covers. Lit and
  // fading cells live in a map keyed by their index from the anchor, each
  // with its own stiffness so they arrive and leave out of step.
  const cover = document.createElement("canvas");
  const cctx = cover.getContext("2d", { willReadFrequently: true });
  const cells = new Map();
  const OFF = 4096;
  const keyOf = (i, j) => (i + OFF) * 8192 + (j + OFF);
  const hash = (i, j) => {
    let h = Math.imul(i + OFF, 374761393) ^ Math.imul(j + OFF, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  let cov = null;
  const sampleCover = () => {
    const cell = raster.cell;
    const strokes = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const g of glyphs.concat(dying)) {
      for (const st of g.strokes) {
        const path = new Path2D();
        if (!outline(st, path)) continue;
        strokes.push(path);
        const m = Math.max(0, st.h.v) * 2 + 1;
        for (const p of st.pts) {
          x0 = Math.min(x0, p.x.v - m);
          y0 = Math.min(y0, p.y.v - m);
          x1 = Math.max(x1, p.x.v + m);
          y1 = Math.max(y1, p.y.v + m);
        }
      }
    }
    if (!strokes.length) return { i0: 0, j0: 0, cols: 0, rows: 0, a: new Float32Array(0) };
    const i0 = Math.floor((x0 - anchor.x) / cell) - 1;
    const j0 = Math.floor((y0 - anchor.y) / cell) - 1;
    const cols = Math.ceil((x1 - anchor.x) / cell) + 1 - i0;
    const rows = Math.ceil((y1 - anchor.y) / cell) + 1 - j0;
    // Fewer samples only if the fine raster would make a huge buffer.
    const ss = Math.max(4, Math.min(SS, Math.floor(Math.sqrt(3.2e6 / (cols * rows)))));
    const pw = cols * ss;
    const ph = rows * ss;
    if (cover.width !== pw || cover.height !== ph) {
      cover.width = pw;
      cover.height = ph;
    } else {
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, pw, ph);
    }
    const k = ss / cell;
    cctx.setTransform(k, 0, 0, k, -anchor.x * k - i0 * ss, -anchor.y * k - j0 * ss);
    cctx.fillStyle = "#000";
    for (const path of strokes) cctx.fill(path);
    const px = new Uint32Array(cctx.getImageData(0, 0, pw, ph).data.buffer);
    const sum = new Float32Array(cols * rows);
    for (let y = 0; y < ph; y++) {
      const base = ((y / ss) | 0) * cols;
      let n = y * pw;
      for (let i = 0; i < cols; i++) {
        let s = 0;
        for (let x = 0; x < ss; x++) s += px[n++] >>> 24;
        if (s) sum[base + i] += s;
      }
    }
    const norm = 1 / (255 * ss * ss);
    for (let n = 0; n < sum.length; n++) sum[n] = Math.min(1, sum[n] * norm);
    return { i0, j0, cols, rows, a: sum };
  };
  const coverage = (c, i, j) => {
    const x = i - c.i0;
    const y = j - c.j0;
    return x >= 0 && y >= 0 && x < c.cols && y < c.rows ? c.a[y * c.cols + x] : 0;
  };
  // Stiffness 60..340: the fastest cells land in a tenth of a second, the
  // slowest take about half.
  function makeCell(i, j, v) {
    const k = 60 + 280 * hash(i, j) ** 1.6;
    return { i, j, v, vel: 0, k, d: 2 * Math.sqrt(k) * 0.82 };
  }
  const enlist = (c, settle) => {
    for (let y = 0; y < c.rows; y++) {
      for (let x = 0; x < c.cols; x++) {
        const a = c.a[y * c.cols + x];
        if (a < 0.004) continue;
        const i = x + c.i0;
        const j = y + c.j0;
        const key = keyOf(i, j);
        if (cells.has(key)) continue;
        cells.set(key, makeCell(i, j, settle ? a : 0));
      }
    }
  };
  const stepCells = (dt) => {
    if (coverDirty || !cov) {
      cov = sampleCover();
      coverDirty = false;
    }
    if (snapCells) {
      snapCells = false;
      cells.clear();
      enlist(cov, true);
      return true;
    }
    enlist(cov, false);
    let moving = false;
    const sub = dt > 1 / 70 ? Math.ceil(dt / (1 / 70)) : 1;
    const h = dt / sub;
    for (const [key, cl] of cells) {
      const to = coverage(cov, cl.i, cl.j);
      if (Math.abs(to - cl.v) < 0.003 && Math.abs(cl.vel) < 0.01) {
        cl.v = to;
        cl.vel = 0;
        if (to < 0.004) cells.delete(key);
        continue;
      }
      moving = true;
      for (let n = 0; n < sub; n++) {
        cl.vel += ((to - cl.v) * cl.k - cl.vel * cl.d) * h;
        cl.v += cl.vel * h;
      }
    }
    return moving;
  };
  // On a jump in pitch, carry what is lit over to the new raster by area:
  // going fine, the old dots are redrawn in small cells; going coarse, each
  // big cell takes the average of what it covers. Then every cell springs
  // to its own coverage.
  function resample(was) {
    if (!cells.size) return;
    const nc = raster.cell;
    const oc = was.cell;
    const acc = new Map();
    for (const cl of cells.values()) {
      if (cl.v < 0.02) continue;
      const x0 = was.x + cl.i * oc;
      const y0 = was.y + cl.j * oc;
      const ia = Math.floor((x0 - anchor.x) / nc);
      const ib = Math.floor((x0 + oc - anchor.x - 1e-6) / nc);
      const ja = Math.floor((y0 - anchor.y) / nc);
      const jb = Math.floor((y0 + oc - anchor.y - 1e-6) / nc);
      for (let j = ja; j <= jb; j++) {
        const oy = Math.min(y0 + oc, anchor.y + (j + 1) * nc) - Math.max(y0, anchor.y + j * nc);
        for (let i = ia; i <= ib; i++) {
          const ox = Math.min(x0 + oc, anchor.x + (i + 1) * nc) - Math.max(x0, anchor.x + i * nc);
          const key = keyOf(i, j);
          acc.set(key, (acc.get(key) || 0) + (ox * oy * Math.min(1, cl.v)) / (nc * nc));
        }
      }
    }
    cells.clear();
    for (const [key, v] of acc) {
      const j = (key % 8192) - OFF;
      const i = Math.round((key - (j + OFF)) / 8192) - OFF;
      // ...and each cell is knocked back by its own amount, so the word
      // breaks up into the dot field at the jump and builds itself again
      // cell by cell.
      const left = Math.min(1, v) * (0.12 + 0.88 * hash(j * 7 + 3, i * 13 - 5) ** 0.8);
      if (left < 0.04) continue;
      const cl = makeCell(i, j, left);
      cells.set(key, cl);
    }
  }
  const settleCells = () => {
    cells.clear();
    cov = sampleCover();
    coverDirty = false;
    enlist(cov, true);
  };

  const outline = (s, path) => {
    const P = s.pts;
    const n = P.length;
    const h = Math.max(0, s.h.v);
    if (h < 0.01) return false;
    const { dirs, closed } = s.def;
    const nrm = (d) => [-d[1], d[0]];
    if (n === 1) {
      const { x, y } = { x: P[0].x.v, y: P[0].y.v };
      path.rect(x - h, y - h, 2 * h, 2 * h);
      return true;
    }
    const L = [];
    const R = [];
    const corner = (i, d0, d1) => {
      const px = P[i].x.v;
      const py = P[i].y.v;
      const n0 = nrm(d0);
      const n1 = nrm(d1);
      if (d0[0] === d1[0] && d0[1] === d1[1]) {
        L.push([px + n0[0] * h, py + n0[1] * h]);
        R.push([px - n0[0] * h, py - n0[1] * h]);
        return;
      }
      const c = Math.min(Math.max(0, s.c[i].v), 4 * h + 999);
      for (const sgn of [1, -1]) {
        const qx = px + sgn * h * (n0[0] + n1[0]);
        const qy = py + sgn * h * (n0[1] + n1[1]);
        const inner = sgn * (n0[0] * d1[0] + n0[1] * d1[1]) > 0;
        const side = sgn === 1 ? L : R;
        const ci = s.def.pts[i].deep ? c - 1.17 * h : 0;
        if (inner && ci > 0.01) side.push([qx - d0[0] * ci, qy - d0[1] * ci], [qx + d1[0] * ci, qy + d1[1] * ci]);
        else if (inner) side.push([qx, qy]);
        else side.push([qx - d0[0] * c, qy - d0[1] * c], [qx + d1[0] * c, qy + d1[1] * c]);
      }
    };
    if (closed) {
      for (let i = 0; i < n; i++) corner(i, dirs[(i - 1 + n) % n], dirs[i]);
      const loop = (pts) => {
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
        path.closePath();
      };
      loop(L);
      loop(R.reverse());
      return true;
    }
    const d0 = dirs[0];
    const n0 = nrm(d0);
    const sx = P[0].x.v - d0[0] * h;
    const sy = P[0].y.v - d0[1] * h;
    L.push([sx + n0[0] * h, sy + n0[1] * h]);
    R.push([sx - n0[0] * h, sy - n0[1] * h]);
    for (let i = 1; i < n - 1; i++) corner(i, dirs[i - 1], dirs[i]);
    const dl = dirs[n - 2];
    const nl = nrm(dl);
    const ex = P[n - 1].x.v + dl[0] * h;
    const ey = P[n - 1].y.v + dl[1] * h;
    L.push([ex + nl[0] * h, ey + nl[1] * h]);
    R.push([ex - nl[0] * h, ey - nl[1] * h]);
    const all = L.concat(R.reverse());
    path.moveTo(all[0][0], all[0][1]);
    for (let i = 1; i < all.length; i++) path.lineTo(all[i][0], all[i][1]);
    path.closePath();
    return true;
  };

  let lastCount = 0;
  const K = 420;
  const D = 2 * Math.sqrt(K) * 0.86;
  const simulate = (dt, withCells = true) => {
    let moving = false;
    let inkMoving = false;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    const step = (sp) => {
      if (Math.abs(sp.to - sp.v) < 0.002 && Math.abs(sp.vel) < 0.01) {
        sp.v = sp.to;
        sp.vel = 0;
        return false;
      }
      for (let i = 0; i < sub; i++) stepSpring(sp, h, K, D);
      return true;
    };
    for (const sp of [caret.x, caret.y, caret.w, caret.h]) if (step(sp)) moving = true;
    for (const g of glyphs.concat(dying)) {
      for (const s of g.strokes) {
        if (s.wait > 0) {
          s.wait -= dt;
          moving = true;
          continue;
        }
        for (const p of s.pts) {
          if (step(p.x)) inkMoving = true;
          if (step(p.y)) inkMoving = true;
        }
        for (const c of s.c) if (step(c)) inkMoving = true;
        if (step(s.h)) inkMoving = true;
      }
    }
    const before = dying.length;
    dying = dying.filter((g) => g.strokes.some((s) => s.h.v > 0.02 || s.h.vel > 0.01));
    if (dying.length !== before) inkMoving = true;
    if (inkMoving) {
      coverDirty = true;
      moving = true;
    }
    if (withCells && (stepCells(dt) || cells.size > lastCount)) moving = true;
    lastCount = cells.size;
    return moving;
  };

  let lastCaretOn = null;
  const render = () => {
    const w = stage.width;
    const h = stage.height;
    const dpr = stage.dpr;
    const cell = raster.cell;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    dotPatterns(dpr, cell, anchor.x, anchor.y);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Every lit cell is one dot of solid ink; its size is the tone.
    const ink = new Path2D();
    for (const cl of cells.values()) {
      const a = clamp(cl.v, 0, 1);
      if (a < 0.004) continue;
      const x0 = anchor.x + cl.i * cell;
      const y0 = anchor.y + cl.j * cell;
      if (x0 > w || y0 > h || x0 + cell < 0 || y0 + cell < 0) continue;
      dot(ink, x0 + cell / 2, y0 + cell / 2, cell, a);
    }
    ctx.fillStyle = INK;
    ctx.fill(ink);

    // Caret: the one accent, a bar on the baseline where the next letter
    // goes, screened by the same raster.
    if (caretOn() && caret.w.v > 0.5) {
      const cx0 = caret.x.v;
      const cy0 = caret.y.v;
      const cx1 = cx0 + caret.w.v;
      const cy1 = cy0 + caret.h.v;
      const bar = new Path2D();
      const ia = Math.floor((cx0 - anchor.x) / cell);
      const ib = Math.ceil((cx1 - anchor.x) / cell);
      const ja = Math.floor((cy0 - anchor.y) / cell);
      const jb = Math.ceil((cy1 - anchor.y) / cell);
      for (let j = ja; j < jb; j++) {
        const y0 = anchor.y + j * cell;
        const oy = Math.min(cy1, y0 + cell) - Math.max(cy0, y0);
        for (let i = ia; i < ib; i++) {
          const x0 = anchor.x + i * cell;
          const a = (oy * (Math.min(cx1, x0 + cell) - Math.max(cx0, x0))) / (cell * cell);
          if (a > 0.004) dot(bar, x0 + cell / 2, y0 + cell / 2, cell, Math.min(1, a));
        }
      }
      ctx.fillStyle = ACCENT;
      ctx.fill(bar);
    }
  };
  const caretOn = () => {
    if (embedded) return false;
    const since = clock - lastKey;
    return since < 0.5 || Math.floor((since - 0.5) / 0.53) % 2 === 1;
  };

  stage.onResize(() => {
    syncGlyphs();
    relayout("resize");
  });

  // A held still: settle at `from`, jump to `w`, stop after `at` ms.
  let frozen = false;
  if (freezeFrom != null) {
    stage.onResize(() => {
      if (frozen) {
        render();
        return;
      }
      const target = Wf;
      Wf = freezeFrom;
      syncGlyphs();
      relayout("resize");
      for (let i = 0; i < 400; i++) simulate(1 / 60, false);
      settleCells();
      Wf = target;
      relayout("grid");
      let t = 0;
      while (t < (freezeAt ?? 0.15)) {
        simulate(1 / 120);
        t += 1 / 120;
      }
      frozen = true;
      render();
    });
  }

  // Idle tile: glide the pitch slowly coarse and fine, through the lock
  // points and the beats between them.
  let demoT = 0;
  stage.onFrame((dt) => {
    clock += dt;
    if (frozen) return;
    if (embedded && stage.idleFor() > 2500 && !drag) {
      demoT += dt;
      setW(9.5 - 4.5 * Math.cos(demoT * 0.45), "drag");
    }
    const moving = simulate(dt);
    const on = caretOn();
    if (moving || dirty || on !== lastCaretOn) {
      render();
      dirty = false;
      lastCaretOn = on;
    }
  });

  return {
    destroy() {
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("wheel", onWheel);
      input.remove();
      stage.destroy();
    },
  };
}
