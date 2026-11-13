import { createStage, clamp, mix } from "../_kit/stage";

// After Experimental Jetset's responsive W for the Whitney (2013): one rule,
// a zigzag that always touches all four sides of its frame. The identity
// worked because the W carried a whole poster: it filled whatever box the
// layout handed it. So here the format is a Swiss grid of frames with shared
// gutters, each frame holding its own solved W at one shared stroke weight.
// Drag a gutter and the frames on both sides re-proportion at once: one W
// goes flat and wide while its neighbour goes tall and narrow.
//
// The mark is solved, not scaled. Four parallel-sided bands share one
// slope s (dx per dy) and one perpendicular weight w. Each band is H = w·√(1+s²)
// wide measured horizontally. Walking the outer edges from the top-left
// corner, the far end lands at x0 + 4sD − 2H, so for the right end to sit on
// the right edge:   4sD − 2·w·√(1+s²) = W
// which squares to a quadratic in s. Every outline vertex is then a line
// intersection: the two top ends are cut flush with the top edge, and the
// three mitre tips land exactly on the bottom, top and bottom edges.

const STIFF = 210;
const ZETA = 0.82;
const HIT = 10; // px reach beyond a gutter's own width
const INK = "#000";
// A gutter in hand draws no rule. The Ws on either side of it step one
// weight heavier instead, quickly, and settle back when it is let go.
const HEAVY = 1.2;
const GRAB_MS = 120;
const LET_GO_MS = 200;
const outQuint = (t) => 1 - (1 - t) ** 5;

// Solve the slope for a frame W wide and D tall with stroke weight w.
function solveSlope(W, D, w) {
  const a = 16 * D * D - 4 * w * w;
  const b = -8 * D * W;
  const c = W * W - 4 * w * w;
  const disc = Math.max(0, b * b - 4 * a * c);
  return (-b + Math.sqrt(disc)) / (2 * a);
}

// The narrowest frame of height D the W can fill without its inner crotches
// rising through the top edge: 2wD / √(D² − w²).
const minWidth = (D, w) => (2 * w * D) / Math.sqrt(Math.max(1e-6, D * D - w * w));

// Outline of the W as 10 points, clockwise from the top-left corner.
function outline(l, t, r, b, w) {
  const W = r - l;
  const D = b - t;
  const s = solveSlope(W, D, w);
  const H = w * Math.sqrt(1 + s * s);
  // Each band edge as x = k + m·(y − t), m = ±s.
  const L = [
    [l, s], // 0: seg1 left
    [l + H, s], // 1: seg1 right
    [l + 2 * s * D - H, -s], // 2: seg2 left (x at y=t)
    [l + 2 * s * D, -s], // 3: seg2 right
    [l + 2 * s * D - 2 * H, s], // 4: seg3 left
    [l + 2 * s * D - H, s], // 5: seg3 right
    [l + 4 * s * D - 3 * H, -s], // 6: seg4 left
    [l + 4 * s * D - 2 * H, -s], // 7: seg4 right
  ];
  const meet = (i, j) => {
    const [ka, ma] = L[i];
    const [kb, mb] = L[j];
    const dy = (kb - ka) / (ma - mb);
    return [ka + ma * dy, t + dy];
  };
  return [
    [l, t],
    [l + H, t],
    meet(1, 2), // inner crotch, first V
    meet(2, 5), // outer tip, on the top edge
    meet(5, 6), // inner crotch, second V
    [r - H, t],
    [r, t],
    meet(7, 4), // outer tip, on the bottom edge
    meet(4, 3), // inner apex
    meet(3, 0), // outer tip, on the bottom edge
  ];
}

// Past a limit the gutter keeps following, but with resistance.
const rubber = (v, lo, hi, c = 48) => {
  if (v < lo) return lo - c * (1 - 1 / ((lo - v) / c + 1));
  if (v > hi) return hi + c * (1 - 1 / ((v - hi) / c + 1));
  return v;
};

// The poster as a guillotine grid: every split is one gutter. `x` splits
// side by side (a vertical gutter), `y` stacks (a horizontal gutter); k is
// the share of the space the first child takes. Leaves are "w" (a solved W)
// or "type" (the set exhibition line). In portrait the grid is transposed
// so the same composition stands up.
//
//   ┌─────┬───────────────────┐
//   │     │         B         │   A  tall W
//   │  A  ├─────────┬─────────┤   B  panoramic W
//   │     │         │    D    │   C  square W
//   │     │    C    ├─────────┤   D  wide, shallow W
//   │     │         │  E type │   E  the type, deeper than D
//   └─────┴─────────┴─────────┘
//
// The type sits under the wide W rather than beside it, so the gutter that
// narrows its column also re-proportions C and D: marks and lines answer
// the same drag. `pull` is where the hero still drags a gutter to.
const LAYOUT = {
  dir: "x",
  k: 0.3,
  pull: 0.15,
  a: "w",
  b: {
    dir: "y",
    k: 0.33,
    a: "w",
    b: { dir: "x", k: 0.49, pull: 0.7, a: "w", b: { dir: "y", k: 0.38, a: "w", b: "type" } },
  },
};

// The exhibition line the type frame sets. Invented, after the posters the
// Whitney system ran on: a title, what it is, when, where.
const TITLE = "Every Edge Touched";
// No-break spaces keep a date and a city whole when the column narrows.
const FACTS = [
  "Drawings for a responsive W",
  "12\u00a0November\u00a02026 – 21\u00a0February\u00a02027",
  "40 Gutter Street, New\u00a0York",
];
// Title steps from the type scale, largest first. The frame takes the
// largest that sets without breaking a word or running out of depth.
const STEPS = ["display", "title-xl", "title-lg", "title"];
const GAP = 16; // the least room between title and facts, as in zigzag.css

export function createZigzag(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(+params.get("t") || 0, 0, 1) : null;

  // Build live nodes from the layout. Each split keeps its rest share, its
  // current share, a target it settles on, a velocity, and how heavy it has
  // made the Ws beside it.
  const gutters = [];
  const build = (n) => {
    if (typeof n === "string") return { leaf: n };
    const node = { dir: n.dir, rest: n.k, pull: n.pull, k: n.k, target: n.k, v: 0, heat: null, a: build(n.a), b: build(n.b), box: null };
    gutters.push(node);
    return node;
  };
  const root = build(LAYOUT);
  // The hero pulls every gutter that has a pull: the root toward the
  // margin and the nested one under B toward the type, so a tall W, a
  // squarer W, a shallower W and a re-ragged column all answer at once.
  const pulled = gutters.filter((node) => node.pull != null);

  // The type frame: real DOM text over the canvas, set by the browser so
  // it rags and steps like a page would. Its box is the leaf's box.
  const type = document.createElement("div");
  type.className = "zigzag-type";
  type.setAttribute("aria-label", `${TITLE}. ${FACTS.join(". ")}.`);
  const title = document.createElement("h2");
  title.className = "zigzag-title";
  title.textContent = TITLE;
  const facts = document.createElement("p");
  facts.className = "zigzag-facts";
  FACTS.forEach((line, i) => {
    const el = document.createElement(i === 0 ? "strong" : "span");
    el.textContent = line;
    facts.appendChild(el);
  });
  type.append(title, facts);
  host.appendChild(type);
  // A hidden twin at the smallest step answers how deep the block must be
  // at a trial width, so a drag stops before the lines run out of room.
  const probe = type.cloneNode(true);
  probe.removeAttribute("aria-label");
  probe.setAttribute("aria-hidden", "true");
  probe.dataset.step = STEPS[STEPS.length - 1];
  Object.assign(probe.style, { visibility: "hidden", height: "auto", justifyContent: "flex-start" });
  host.appendChild(probe);
  const depthCache = new Map();
  let minTypeW = 0;
  const measure = () => {
    depthCache.clear();
    probe.style.width = "min-content";
    minTypeW = Math.ceil(probe.offsetWidth) + 1;
    typeBox = null;
  };
  // Geist may land after the first layout; measure again once it has.
  document.fonts?.ready.then(measure);
  const typeDepth = (w) => {
    const key = Math.round(w);
    let d = depthCache.get(key);
    if (d == null) {
      probe.style.width = `${key}px`;
      d = probe.offsetHeight;
      depthCache.set(key, d);
    }
    return d;
  };

  let BW = 1;
  let BH = 1;
  let portrait = false;
  let G = 16; // gutter: half a stroke
  let M = 32; // margin: one stroke
  let weight = 10;
  let drag = null; // { node, off }
  let hover = null; // node
  let demo = null;
  let hinted = false;
  let typeBox = null; // the box the type was last set in
  const t0 = performance.now();

  stage.onResize((w, h) => {
    BW = w;
    BH = h;
    portrait = h > w * 1.1;
    const short = Math.min(w, h);
    // One unit sets marks and spacing alike. The frames are parted by white
    // alone, half a stroke wide, and the margin is a whole stroke; both snap
    // to the 4px grid so the frames land on it too.
    weight = Math.max(5, Math.round(short * 0.038));
    G = Math.max(4, Math.round(weight / 2 / 4) * 4);
    M = Math.max(12, Math.round(weight / 4) * 4);
    measure();
  });

  // The axis a split works along, after transposing for portrait.
  const axis = (node) => (portrait ? (node.dir === "x" ? "y" : "x") : node.dir);

  // Lay out the tree into boxes. With `over` a single split can be given a
  // trial share without touching the live state.
  const lay = (node, box, leaves, over) => {
    if (node.leaf) {
      leaves.push({ kind: node.leaf, box });
      return;
    }
    node.box = box;
    const k = over && over.node === node ? over.k : node.k;
    const [x, y, w, h] = box;
    if (axis(node) === "x") {
      const a = k * (w - G);
      lay(node.a, [x, y, a, h], leaves, over);
      lay(node.b, [x + a + G, y, w - G - a, h], leaves, over);
    } else {
      const a = k * (h - G);
      lay(node.a, [x, y, w, a], leaves, over);
      lay(node.b, [x, y + a + G, w, h - G - a], leaves, over);
    }
  };
  const content = () => [M, M, BW - 2 * M, BH - 2 * M];
  const layout = (over) => {
    const leaves = [];
    lay(root, content(), leaves, over);
    return leaves;
  };

  // A frame is fillable when the W can still touch all four sides at the
  // shared weight: tall enough for the mitres, wide enough for the crotches.
  // The type frame is fillable while its words fit unbroken and its lines,
  // at the smallest title step, still clear its depth.
  // A W is held to its heavier weight, since that is what a drag shows.
  const fits = ({ kind, box: [, , w, h] }) => {
    if (kind === "type") return w >= minTypeW && h >= typeDepth(w);
    const wt = weight * HEAVY;
    return h >= wt * 2.6 && w >= minWidth(h, wt) * 1.08;
  };
  const leavesOf = (node, side) => {
    const out = [];
    const [x, y, w, h] = node.box;
    const k = node.k;
    const sub = side === "a" ? node.a : node.b;
    let box;
    if (axis(node) === "x") {
      const a = k * (w - G);
      box = side === "a" ? [x, y, a, h] : [x + a + G, y, w - G - a, h];
    } else {
      const a = k * (h - G);
      box = side === "a" ? [x, y, w, a] : [x, y + a + G, w, h - G - a];
    }
    lay(sub, box, out);
    return out;
  };
  // The range of shares a split can take before a frame on either side
  // can no longer hold its W. Each side is monotone in k, so bisect.
  const limits = (node) => {
    const save = node.k;
    const ok = (k, side) => {
      node.k = k;
      return leavesOf(node, side).every(fits);
    };
    let lo = 0;
    let hi = save;
    if (!ok(hi, "a")) hi = 1;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (ok(m, "a")) hi = m;
      else lo = m;
    }
    const kLo = hi;
    lo = save;
    hi = 1;
    if (!ok(lo, "b")) lo = 0;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (ok(m, "b")) lo = m;
      else hi = m;
    }
    const kHi = lo;
    node.k = save;
    return [kLo, Math.max(kLo, kHi)];
  };

  // Gutter geometry: span is the length the share is measured over, base its
  // start; the gutter's centre sits at base + k·span + G/2.
  const frameOf = (node) => {
    const [x, y, w, h] = node.box;
    return axis(node) === "x" ? { base: x, span: w - G } : { base: y, span: h - G };
  };
  const centre = (node) => {
    const { base, span } = frameOf(node);
    return base + node.k * span + G / 2;
  };

  // Whether a frame has this gutter as one of its own sides.
  const borders = (node, [lx, ly, lw, lh]) => {
    const [x, y, w, h] = node.box;
    const c = centre(node);
    const near = (e, f) => Math.abs(e - f) < 0.5;
    return axis(node) === "x"
      ? (near(lx + lw, c - G / 2) || near(lx, c + G / 2)) && ly >= y - 0.5 && ly + lh <= y + h + 0.5
      : (near(ly + lh, c - G / 2) || near(ly, c + G / 2)) && lx >= x - 0.5 && lx + lw <= x + w + 0.5;
  };

  // Take a gutter in hand (on = true) or let it go: its heat eases from
  // wherever it is now toward 1 or 0, out-quint.
  const heatOf = (node, ms) => {
    const h = node.heat;
    if (!h) return 0;
    const e = outQuint(clamp((ms - h.t0) / h.dur, 0, 1));
    return mix(h.from, h.to, e);
  };
  const grip = (node, on) => {
    const ms = performance.now();
    const to = on ? 1 : 0;
    if (node.heat && node.heat.to === to) return;
    node.heat = { from: heatOf(node, ms), to, t0: ms, dur: on ? GRAB_MS : LET_GO_MS };
  };

  const pick = (px, py) => {
    const leaves = layout();
    // On a gutter: the one under the pointer, within reach.
    let best = null;
    let bestD = G / 2 + HIT;
    for (const node of gutters) {
      const [x, y, w, h] = node.box;
      const c = centre(node);
      const along = axis(node) === "x" ? py >= y && py <= y + h : px >= x && px <= x + w;
      if (!along) continue;
      const d = Math.abs((axis(node) === "x" ? px : py) - c);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    if (best) return best;
    // Inside a frame: the nearest of its own sides that is a gutter.
    const leaf = leaves.find(({ box: [x, y, w, h] }) => px >= x && px <= x + w && py >= y && py <= y + h);
    if (!leaf) return null;
    bestD = Infinity;
    for (const node of gutters) {
      if (!borders(node, leaf.box)) continue;
      const c = centre(node);
      const d = Math.abs((axis(node) === "x" ? px : py) - c);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best;
  };

  const cursorFor = (node) => (node ? (axis(node) === "x" ? "col-resize" : "row-resize") : "default");

  // Put a gutter's centre at pixel position p, rubbery past its limits.
  const place = (node, p) => {
    const { base, span } = frameOf(node);
    const [lo, hi] = limits(node);
    const q = rubber(p - G / 2, base + lo * span, base + hi * span);
    node.k = clamp((q - base) / span, 0.001, 0.999);
  };

  stage.on("down", (p) => {
    if (still != null) return;
    if (demo) for (const n of pulled) grip(n, false);
    demo = null;
    hinted = true;
    const node = pick(p.x, p.y);
    if (!node) return;
    const pos = axis(node) === "x" ? p.x : p.y;
    drag = { node, off: centre(node) - pos };
    node.v = 0;
    grip(node, true);
    canvas.style.cursor = cursorFor(node);
  });
  stage.on("move", (p) => {
    if (drag) {
      layout();
      const pos = axis(drag.node) === "x" ? p.x : p.y;
      place(drag.node, pos + drag.off);
      return;
    }
    hover = pick(p.x, p.y);
    canvas.style.cursor = cursorFor(hover);
  });
  stage.on("up", (p) => {
    if (!drag) return;
    // The gutter stays where it was let go (pulled back inside its limits),
    // and the throw is handed to the spring.
    const node = drag.node;
    layout();
    const [lo, hi] = limits(node);
    node.target = clamp(node.k, lo, hi);
    const { span } = frameOf(node);
    node.v = clamp(axis(node) === "x" ? p.vx : p.vy, -3000, 3000) / Math.max(1, span);
    grip(node, false);
    drag = null;
  });

  const spring = (dt) => {
    const c = 2 * ZETA * Math.sqrt(STIFF);
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (const node of gutters) {
      if (drag && drag.node === node) continue;
      for (let i = 0; i < steps; i++) {
        const a = -STIFF * (node.k - node.target) - c * node.v;
        node.v += a * h;
        node.k += node.v * h;
      }
    }
  };

  // Move the type into its frame and, when the frame changed size, take the
  // largest title step whose words fit unbroken and whose lines clear the
  // depth. The browser re-rags the balanced title on every width.
  const setType = ([x, y, w, h]) => {
    type.style.transform = `translate(${x}px, ${y}px)`;
    if (typeBox && Math.abs(typeBox[0] - w) < 0.25 && Math.abs(typeBox[1] - h) < 0.25) return;
    typeBox = [w, h];
    type.style.width = `${w}px`;
    type.style.height = `${h}px`;
    for (const step of STEPS) {
      type.dataset.step = step;
      if (title.scrollWidth <= w + 0.5 && title.offsetHeight + GAP + facts.offsetHeight <= h + 0.5) break;
    }
  };

  const draw = () => {
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, BW, BH);
    const leaves = layout();
    const ms = performance.now();
    const hot = gutters.map((node) => [node, heatOf(node, ms)]).filter(([, h]) => h > 0.001);

    // No rules: the frames are parted by the gutter's white alone. The W's,
    // one per frame, at one weight, except beside a gutter in hand.
    ctx.fillStyle = INK;
    ctx.beginPath();
    for (const { kind, box } of leaves) {
      if (kind === "type") {
        setType(box);
        continue;
      }
      const [x, y, w, h] = box;
      let heat = 0;
      for (const [node, hv] of hot) if (hv > heat && borders(node, box)) heat = hv;
      const pts = outline(x, y, x + w, y + h, weight * mix(1, HEAVY, heat));
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }
    ctx.fill();
  };

  stage.onFrame((dt) => {
    if (still != null) {
      // The hero: the main gutter pulled toward the margin and the nested
      // one toward the type, so the tall, the panoramic and the square W
      // stand beside a column that has re-ragged for the same pull.
      for (const node of gutters) {
        node.k = node.pull != null ? mix(node.rest, node.pull, still) : node.rest;
        node.heat = null;
      }
      draw();
      return;
    }
    const ms = performance.now();
    // One hint, soon after load: the main gutter is pulled and let go, the
    // way a hand would, then it is left alone.
    if (!hinted && !drag && ms - t0 > 1400) {
      hinted = true;
      demo = { t0: ms, dur: 1300 };
      for (const node of pulled) grip(node, true);
    }
    if (demo && !drag) {
      const k = (ms - demo.t0) / demo.dur;
      if (k >= 0.75) {
        demo = null;
        for (const node of pulled) grip(node, false);
      } else {
        const e = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, k / 0.6));
        for (const node of pulled) {
          node.k = mix(node.rest, mix(node.rest, node.pull, 0.7), e);
          node.v = 0;
          node.target = node.rest;
        }
      }
    }
    if (!demo) spring(dt);
    draw();
  });

  return {
    destroy: () => {
      stage.destroy();
      type.remove();
      probe.remove();
    },
  };
}
