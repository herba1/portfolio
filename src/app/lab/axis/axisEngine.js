import { createStage, clamp } from "../_kit/stage";

// One word on Geist's weight axis. Pointer x is the axis: hairline at the
// left edge, black at the right. That weight is a crest under the pointer
// that falls to hairline a few letters away, so the word always holds a
// gradient through the axis, and each letter springs onto its own weight
// a beat behind its neighbour nearer the pointer, so a sweep travels
// through the word as a wave. A drag shears the letters into an oblique
// about their x-height centre; release springs them upright.
//
// Spacing is set, not approximated: every letter's advance and every pair's
// kerning are measured from the font at the exact (integer) weight drawn,
// and the house tracking law (-0.043 x (size - 12) px) is added between
// each pair, at the size the word is set.

const FAMILY = "AxisGeist";
const WORD = "Weight";
const INK = "#0d0d0c";
const GROUND = "#f2f0eb";
const W_MIN = 100;
const W_MAX = 900;
const lawPx = (s) => -0.043 * (s - 12);

const MAX_LEAN = (12 * Math.PI) / 180; // a real oblique, not a cartoon
const BACK_LEAN = (4 * Math.PI) / 180; // backslant kept modest
const SPREAD = 3.2; // how much slower the lean is a box-width away
// The wave, in letter widths: the pointer's weight is held at full strength
// under the hand and falls to hairline over REACH letters either side, so
// any frame holds hairline and black in the same word.
const REACH = 4.5;
const LAG = 0.55; // how much slower each letter-width further out responds
const REST = 0.84; // where the intro leaves the pointer
const smooth = (u) => u * u * (3 - 2 * u);

let fontPromise = null;
function loadFont() {
  if (!fontPromise) {
    const face = new FontFace(FAMILY, "url(/fonts/Geist-Variable.woff2)", { weight: "100 900", style: "normal" });
    fontPromise = face.load().then((f) => {
      document.fonts.add(f);
      return f;
    });
  }
  return fontPromise;
}

// Soft limit: linear near zero, easing into the cap so a long drag never
// slams into a wall.
const soft = (v, cap) => cap * Math.tanh(v / cap);

export async function createAxis(host, { embedded = false } = {}) {
  await loadFont();
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas, pointer } = stage;
  canvas.style.cursor = "grab";

  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(+params.get("t") || 0, 0, 1) : null;
  const stillLean = params.has("lean") ? +params.get("lean") : 0;
  const stillAt = params.has("at") ? +params.get("at") : 0.2;
  const stillDur = params.has("dur") ? Math.max(0.05, +params.get("dur")) : 0.55;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Metrics at a reference size, per integer weight, cached.
  const REF = 200;
  const mctx = document.createElement("canvas").getContext("2d");
  mctx.fontKerning = "normal";
  const fontAt = (w, s) => `${w} ${s}px ${FAMILY}`;
  const advCache = new Map();
  const kernCache = new Map();
  const adv = (ch, w) => {
    const k = ch + w;
    let v = advCache.get(k);
    if (v === undefined) {
      mctx.font = fontAt(w, REF);
      v = mctx.measureText(ch).width / REF;
      advCache.set(k, v);
    }
    return v;
  };
  const kern = (a, b, w) => {
    const k = a + b + w;
    let v = kernCache.get(k);
    if (v === undefined) {
      mctx.font = fontAt(w, REF);
      v = (mctx.measureText(a + b).width - mctx.measureText(a).width - mctx.measureText(b).width) / REF;
      kernCache.set(k, v);
    }
    return v;
  };
  mctx.font = fontAt(500, REF);
  const capH = mctx.measureText("H").actualBoundingBoxAscent / REF;
  const xH = mctx.measureText("x").actualBoundingBoxAscent / REF;

  const chars = [...WORD];
  const n = chars.length;
  const glyphs = chars.map(() => ({ w: W_MIN + 200, wv: 0, lean: 0, lv: 0, x: 0, adv: 0 }));

  // Layout in em at a weight per glyph; tracking added separately in px.
  const layoutEm = (weights) => {
    const out = [];
    let x = 0;
    for (let i = 0; i < n; i += 1) {
      out.push(x);
      x += adv(chars[i], weights[i]);
      if (i < n - 1) x += kern(chars[i], chars[i + 1], Math.round((weights[i] + weights[i + 1]) / 2));
    }
    out.push(x);
    return out;
  };

  let W = 1;
  let H = 1;
  let size = 200;
  let track = 0;
  let baseline = 0;
  let unit = 1; // one average letter advance in px, at a book weight
  let lastSig = "";
  stage.onResize((w, h) => {
    lastSig = ""; // the canvas was cleared
    W = w;
    H = h;
    // Set the size so the black cut runs a little past both edges: the word
    // is cropped at the heavy end of the axis and breathes at the light end.
    const em900 = layoutEm(chars.map(() => W_MAX))[n];
    const target = W * 1.14;
    size = (target - (n - 1) * 0.043 * 12) / (em900 - 0.043 * (n - 1));
    size = Math.min(size, (H * 0.74) / capH);
    track = lawPx(size);
    unit = (layoutEm(chars.map(() => 500))[n] * size + track * (n - 1)) / n;
    baseline = Math.round(H / 2 + (capH * size) / 2);
  });

  // Source of truth for the pointer: real input, or a scripted path for the
  // intro, the embedded tile's idle drift and the ?t= still.
  let px = 0.18;
  let weightX = 0.18; // where the weight was last set from
  let lean = 0; // target lean in radians
  let drag = null;
  let touched = false;
  const weightOf = (fx) => {
    const f = clamp((fx - 0.06) / 0.88, 0, 1);
    // Slight ease toward the ends so hairline and black each get room.
    const e = f * f * (3 - 2 * f) * 0.35 + f * 0.65;
    return W_MIN + (W_MAX - W_MIN) * e;
  };

  stage.on("down", (p, e) => {
    touched = true;
    drag = { x: p.x, y: p.y, touch: e.pointerType === "touch" };
    canvas.style.cursor = "grabbing";
    if (drag.touch) weightX = p.x / W;
  });
  stage.on("move", (p) => {
    touched = true;
    px = p.x / W;
    if (!drag) {
      weightX = px;
      return;
    }
    const dx = drag.touch ? 0 : p.x - drag.x;
    const dy = drag.touch ? drag.y - p.y : 0;
    if (drag.touch) weightX = px;
    const raw = ((dx + dy) / Math.max(240, W * 0.32)) * MAX_LEAN * 1.4;
    lean = raw >= 0 ? soft(raw, MAX_LEAN) : -soft(-raw, BACK_LEAN);
  });
  stage.on("up", () => {
    drag = null;
    lean = 0;
    canvas.style.cursor = "grab";
  });

  const ease = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
  const easeInOut = (u) => {
    u = clamp(u, 0, 1);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  };

  let simT = 0;
  const centres = new Float64Array(n);

  const step = (dt) => {
    simT += dt;
    if (still !== null) {
      // Hold at hairline, then one sweep to t; the frame freezes mid-wave.
      const u = (simT - 0.8) / stillDur;
      const fx = 0.08 + (still - 0.08) * ease(u);
      px = fx;
      weightX = fx;
      lean = simT > 0.8 ? stillLean * (Math.PI / 180) * ease(u * 1.4) : 0;
    } else if (!touched || (embedded && stage.idleFor() > 5000)) {
      // Intro: from hairline across to black, then settle just short of it
      // so the word rests as a ramp from hairline W to a black t;
      // embedded tiles keep drifting slowly when nobody is there.
      const t = embedded && touched ? simT : simT;
      const period = 7.5;
      const ph = (t % period) / period;
      const fx = ph < 0.5 ? 0.1 + 0.8 * easeInOut(ph / 0.5) : 0.9 - 0.8 * easeInOut((ph - 0.5) / 0.5);
      px = fx;
      weightX = fx;
      if (!embedded && !touched && simT > period * 0.5 + 0.2) {
        // On the page the intro runs once and comes to rest.
        const r = clamp((simT - period * 0.5 - 0.2) / 2.2, 0, 1);
        px = weightX = 0.9 - (0.9 - REST) * easeInOut(r);
      }
    }

    // The wave: the pointer's weight is a crest that falls to hairline over
    // REACH letter widths, so the word always reads as a gradient through
    // the axis. Each letter springs onto its own target, softer the further
    // out it sits, so the crest trails a moving hand by a beat per letter.
    // (A spring rather than a delay line: it is interruptible, and a
    // reversal never has to finish an old wave first.)
    const tw = weightOf(weightX);
    const pX = px * W;
    for (let i = 0; i < n; i += 1) {
      const g = glyphs[i];
      const dl = Math.abs(centres[i] - pX) / unit; // in letter widths
      const target = tw + (W_MIN - tw) * smooth(clamp(dl / REACH, 0, 1));
      const d = reduced ? 0 : Math.min(1, Math.abs(centres[i] - pX) / Math.max(1, W));
      // Weight: critically damped, so it never overshoots past the axis.
      const om = reduced ? 30 : 22 / (1 + LAG * dl);
      const a = om * om * (target - g.w) - 2 * om * g.wv;
      g.wv += a * dt;
      g.w = clamp(g.w + g.wv * dt, W_MIN, W_MAX);
      // Lean: held firmly under the hand; on release a little under
      // critical, so the letters settle upright with one soft give.
      const ol = (drag ? 26 : 17) / (1 + SPREAD * 0.6 * d);
      const zl = drag ? 1 : 0.7;
      const al = ol * ol * (lean - g.lean) - 2 * zl * ol * g.lv;
      g.lv += al * dt;
      g.lean += g.lv * dt;
    }
  };

  // Big glyphs are filled as paths every frame, and a weight the canvas has
  // not drawn yet costs a new font instance, so a settled word is not redrawn.
  const draw = () => {
    const dpr = stage.dpr;
    let sig = `${W}|${H}|${dpr}`;
    for (const g of glyphs) sig += `|${Math.round(g.w)}|${Math.round(g.lean * 2000)}`;
    if (sig === lastSig) return;
    lastSig = sig;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK;
    ctx.textBaseline = "alphabetic";
    ctx.fontKerning = "none"; // kerning is placed by hand, per pair weight

    const weights = glyphs.map((g) => Math.round(g.w));
    const em = layoutEm(weights);
    const total = em[n] * size + track * (n - 1);
    const x0 = (W - total) / 2;
    const pivot = baseline - (xH * size) / 2;
    for (let i = 0; i < n; i += 1) {
      const g = glyphs[i];
      const x = x0 + em[i] * size + track * i;
      centres[i] = x + (adv(chars[i], weights[i]) * size) / 2;
      ctx.font = fontAt(weights[i], size);
      const k = Math.tan(g.lean);
      // Shear about the x-height centre: x' = x - k (y - pivot).
      ctx.setTransform(dpr, 0, -k * dpr, dpr, (x + k * pivot) * dpr, 0);
      ctx.fillText(chars[i], 0, baseline);
    }
  };

  const FIXED = 1 / 120;
  let acc = 0;
  let frozen = false;
  stage.onFrame((dt) => {
    if (frozen) return draw();
    acc += dt;
    while (acc >= FIXED) {
      acc -= FIXED;
      step(FIXED);
      if (still !== null && simT >= 0.8 + stillAt) {
        frozen = true;
        break;
      }
    }
    draw();
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
