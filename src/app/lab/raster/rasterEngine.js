import { createStage, clamp } from "../_kit/stage";

// Letters that come from the raster, after Crouwel's New Alphabet: every
// glyph is drawn once on a 5 x 9 design grid (a 5 x 5 body, two rows of
// ascender, two of descender) as runs of horizontal and vertical strokes.
// At any resolution the design grid is mapped onto the real one, each stroke
// snaps to whole cells and is one weight thick, and its outer corners are cut
// at 45 degrees across the full stroke. Changing the raster changes the
// targets; every stroke vertex slides there on a spring.

// Stroke syntax: "x,y x,y ..." on the design grid. A trailing "z" closes the
// stroke; a "*" after a vertex cuts that corner deep (half a body).
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
const DOT_IN_INK = "#3c3c3c";

// Resolution: W cells across a full-width letter.
const metrics = (W) => {
  const H = Math.round((W * 9) / 5);
  const t = Math.max(1, Math.round(W / 5.6));
  const col = (c) => Math.round((c * (W - t)) / 4);
  const row = (r) => Math.round((r * (H - t)) / 8);
  const gap = Math.max(1, Math.round(W / 5));
  const lead = Math.round((W * 3) / 5);
  return { W, H, t, col, row, gap, lead, space: col(1) + t, deep: col(2) };
};
const glyphCells = (m, def) => (def.cols === 0 ? m.space : m.col(def.cols - 1) + m.t);

const lineCells = (m, chars) => {
  let w = 0;
  chars.forEach((ch, i) => {
    w += glyphCells(m, DEFS[ch] || DEFS[" "]) + (i ? m.gap : 0);
  });
  return w;
};

// Break once, at the coarsest raster, so the lines don't reshuffle while
// the grid changes underneath them.
const breakLines = (text, aspect) => {
  const m = metrics(W_MIN);
  const words = text.split(" ").filter((w) => w.length);
  if (!words.length) return [[]];
  const wordW = words.map((w) => lineCells(m, [...w]));
  const spaceW = m.space + 2 * m.gap;
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
    const widest = Math.max(...lines.map((l) => lineCells(m, [...l.join(" ")])));
    const tall = lines.length * m.H + (lines.length - 1) * m.lead;
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

export async function createRaster(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2 });
  const { canvas, ctx } = stage;
  canvas.style.cursor = "ns-resize";

  const q = new URLSearchParams(location.search);
  let text = (q.get("text") || "computer love").toLowerCase();
  let Wf = clamp(+(q.get("w") || 7), W_MIN, W_MAX);
  let W = Math.round(Wf);
  const freezeFrom = q.has("from") ? clamp(Math.round(+q.get("from")), W_MIN, W_MAX) : null;
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
  const raster = { cell: spring(10), ox: spring(0), oy: spring(0) };
  const caret = { x: spring(0), y: spring(0), w: spring(0), h: spring(0) };
  let lastKey = -10;
  let clock = 0;
  let dirty = true;

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
  const relayout = (stagger) => {
    const bw = stage.width;
    const bh = stage.height;
    const dpr = stage.dpr;
    const aspect = (bw * 0.82) / (bh * 0.62);
    if (stagger === "text" || Math.abs(aspect - layoutAspect) > 0.01) {
      const flat = text.replace(/\s+/g, " ").trim();
      lines = breakLines(flat, aspect);
      layoutAspect = aspect;
    }
    const m = metrics(W);
    const widest = Math.max(1, ...lines.map((l) => lineCells(m, l)));
    const tall = lines.length * m.H + (lines.length - 1) * m.lead;
    let cell = Math.min((bw * 0.82) / widest, (bh * 0.62) / tall, (bh * 0.34) / m.H);
    cell = Math.max(1 / dpr, Math.floor(cell * dpr) / dpr);
    const snap = (v) => Math.round(v * dpr) / dpr;
    const ox = snap((bw - widest * cell) / 2);
    const oy = snap((bh - tall * cell) / 2);
    raster.cell.to = cell;
    raster.ox.to = ox;
    raster.oy.to = oy;

    // Map the visible characters (spaces collapsed, as laid out) onto glyphs.
    let gi = 0;
    const chars = [...text];
    let cx = 0;
    let cy = 0;
    let lastRight = 0;
    let lastLine = 0;
    const place = (g, x0, y0, order) => {
      g.strokes.forEach((s, si) => {
        const deepC = m.deep * cell;
        s.def.pts.forEach((p, pi) => {
          s.pts[pi].x.to = x0 + (m.col(p.x) + m.t / 2) * cell;
          s.pts[pi].y.to = y0 + (m.row(p.y) + m.t / 2) * cell;
          s.c[pi].to = p.deep ? deepC : m.t * cell;
        });
        s.h.to = (m.t * cell) / 2;
        s.wait = stagger === "grid" ? order * 0.022 + si * 0.035 : 0;
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
    let order = 0;
    lines.forEach((line, li) => {
      cx = 0;
      cy = li * (m.H + m.lead);
      line.forEach((ch, ci) => {
        // skip over whitespace runs in the source that the layout collapsed
        while (gi < chars.length && /\s/.test(chars[gi]) && ch !== " ") gi++;
        if (ci) cx += m.gap;
        const def = DEFS[ch] || DEFS["?"];
        const g = glyphs[gi];
        if (g) place(g, ox + cx * cell, oy + cy * cell, order++);
        cx += glyphCells(m, def);
        gi++;
      });
      lastRight = cx;
      lastLine = li;
    });
    // Leftover glyphs (trailing whitespace) have no strokes; nothing to place.
    const atEnd = text.endsWith(" ");
    caret.x.to = ox + (lastRight + (lastRight ? m.gap : 0) + (atEnd ? m.space + m.gap : 0)) * cell;
    caret.y.to = oy + (lastLine * (m.H + m.lead) + m.row(6)) * cell;
    caret.w.to = (m.col(4) + m.t) * cell;
    caret.h.to = m.t * cell;
    dirty = true;
  };

  const setW = (next) => {
    if (next === W) return;
    W = next;
    relayout("grid");
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
    Wf = clamp(drag.w - dy / 22, W_MIN, W_MAX);
    setW(Math.round(Wf));
  });
  stage.on("up", () => {
    if (drag && !drag.moved) input.focus({ preventScroll: true });
    drag = null;
    Wf = W;
  });
  let wheelAcc = 0;
  const onWheel = (e) => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40) {
      setW(clamp(W + (wheelAcc < 0 ? 1 : -1), W_MIN, W_MAX));
      Wf = W;
      wheelAcc = 0;
    }
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      setText(text.slice(0, -1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setW(clamp(W + (e.key === "ArrowUp" ? 1 : -1), W_MIN, W_MAX));
      Wf = W;
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
  // The raster is one dot tile repeated: drawn once per pitch at a whole
  // number of device pixels, then scaled by the pattern to the exact cell.
  let tileKey = "";
  let pat = null;
  let inkPat = null;
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
  const dotPatterns = (dpr, cell, ox, oy) => {
    const size = Math.max(2, Math.ceil(cell * dpr));
    const r = clamp(cell * 0.075, 0.7, 1.5) * dpr * (size / (cell * dpr));
    const key = size + ":" + r.toFixed(2);
    if (key !== tileKey) {
      tileKey = key;
      pat = ctx.createPattern(tile(DOT, size, r), "repeat");
      inkPat = ctx.createPattern(tile(DOT_IN_INK, size, r), "repeat");
    }
    const k = (cell * dpr) / size;
    const m = new DOMMatrix([k, 0, 0, k, ox * dpr, oy * dpr]);
    pat.setTransform(m);
    inkPat.setTransform(new DOMMatrix([k / dpr, 0, 0, k / dpr, ox, oy]));
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

  const K = 420;
  const D = 2 * Math.sqrt(K) * 0.86;
  const simulate = (dt) => {
    let moving = false;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    const all = [raster.cell, raster.ox, raster.oy, caret.x, caret.y, caret.w, caret.h];
    for (const g of glyphs.concat(dying)) {
      for (const s of g.strokes) {
        if (s.wait > 0) {
          s.wait -= dt;
          moving = true;
          continue;
        }
        for (const p of s.pts) all.push(p.x, p.y);
        for (const c of s.c) all.push(c);
        all.push(s.h);
      }
    }
    for (const sp of all) {
      if (Math.abs(sp.to - sp.v) < 0.002 && Math.abs(sp.vel) < 0.01) {
        sp.v = sp.to;
        sp.vel = 0;
        continue;
      }
      moving = true;
      for (let i = 0; i < sub; i++) stepSpring(sp, h, K, D);
    }
    dying = dying.filter((g) => g.strokes.some((s) => s.h.v > 0.02 || s.h.vel > 0.01));
    return moving;
  };

  let lastCaretOn = null;
  const render = () => {
    const w = stage.width;
    const h = stage.height;
    const dpr = stage.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    dotPatterns(dpr, raster.cell.v, raster.ox.v, raster.oy.v);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = INK;
    const ink = new Path2D();
    for (const g of glyphs.concat(dying)) {
      for (const s of g.strokes) {
        const path = new Path2D();
        if (outline(s, path)) {
          ctx.fill(path);
          ink.addPath(path);
        }
      }
    }
    // The raster carries on through the ink, a shade off black.
    ctx.fillStyle = inkPat;
    ctx.fill(ink);
    // Caret: the one accent, a baseline bar where the next letter goes.
    if (caretOn()) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(caret.x.v, caret.y.v, caret.w.v, caret.h.v);
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

  // A held still: settle at `from`, switch to `w`, stop after `at` ms.
  let frozen = false;
  if (freezeFrom != null) {
    stage.onResize(() => {
      if (frozen) {
                render();
        return;
      }
      W = freezeFrom;
      syncGlyphs();
      relayout("resize");
      for (let i = 0; i < 400; i++) simulate(1 / 60);
      W = Math.round(Wf);
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

  // Idle tile: breathe the raster coarse and fine.
  let demoT = 0;
  let demoDir = 1;
  stage.onFrame((dt) => {
    clock += dt;
    if (frozen) return;
    if (embedded && stage.idleFor() > 2500 && !drag) {
      demoT += dt;
      if (demoT > 0.9) {
        demoT = 0;
        if (W >= 14) demoDir = -1;
        if (W <= W_MIN) demoDir = 1;
        setW(W + demoDir * 3 > 14 ? 14 : Math.max(W_MIN, W + demoDir * 3));
        Wf = W;
      }
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
