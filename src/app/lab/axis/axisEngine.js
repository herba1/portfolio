import { createStage, clamp } from "../_kit/stage";

// One word on Geist's weight axis. Pointer x is the axis: hairline at the
// left edge, black at the right. That weight is a crest under the pointer
// that falls to hairline a few letters away, so the word always holds a
// gradient through the axis, and each letter springs onto its own weight
// a beat behind its neighbour nearer the pointer, so a sweep travels
// through the word as a wave.
//
// A press puts the gesture on the same axis a second way. Pressing pins the
// crest where it is and inks it to black; dragging (up or down, or sideways
// while held) changes REACH, the steepness of the ramp: wide, the word is a
// six-step specimen from hairline to black; narrow, one black letter stands
// among hairlines. Release and REACH relaxes back to its rest value. Every
// frame is real Geist at a real weight with its true spacing: nothing is
// sheared, scaled or synthesised.
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

// The wave, in letters: the crest's weight is held at full strength on the
// letter under the hand and falls to hairline REACH letters either side, so
// a crest on the t at rest REACH steps down the word one weight a letter.
// The fall is bowed (GRADE) because darkness is not linear in weight: a
// straight line in weight reads as a step, the middle weights already
// looking bold at this size. A press drags REACH between a hard step and a ramp
// slightly longer than the word.
const REACH_REST = 5;
const REACH_MIN = 0.6;
const REACH_MAX = 6.2;
const GRADE = 1.35;
const LAG = 0.55; // how much slower each letter further out responds
const REST = 0.95; // where the intro leaves the pointer: the crest on the t

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

export async function createAxis(host, { embedded = false } = {}) {
  await loadFont();
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas, pointer } = stage;
  canvas.style.cursor = "grab";

  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(+params.get("t") || 0, 0, 1) : null;
  // ?pin=<letter index> presses on that letter after the sweep, and
  // ?reach=<letters> is where the drag takes REACH while it is held.
  const stillPin = params.has("pin") ? clamp(+params.get("pin") || 0, 0, WORD.length - 1) : null;
  const stillReach = params.has("reach") ? clamp(+params.get("reach") || REACH_REST, REACH_MIN, REACH_MAX) : REACH_REST;
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
  // Ink left edge of a glyph, in em from its pen position, per weight: the
  // line is aligned on the W's ink, not its sidebearing, so the hairline
  // stroke sits on the margin at every weight.
  const lsbCache = new Map();
  const lsb = (ch, w) => {
    const k = ch + w;
    let v = lsbCache.get(k);
    if (v === undefined) {
      mctx.font = fontAt(w, REF);
      v = -mctx.measureText(ch).actualBoundingBoxLeft / REF;
      lsbCache.set(k, v);
    }
    return v;
  };
  mctx.font = fontAt(500, REF);
  const capH = mctx.measureText("H").actualBoundingBoxAscent / REF;

  const chars = [...WORD];
  const n = chars.length;
  const glyphs = chars.map(() => ({ w: W_MIN + 200, wv: 0 }));

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
  let margin = 16; // the fixed left margin the W's ink is set against
  let unit = 1; // one average letter advance in px, at a book weight
  let lastSig = "";
  stage.onResize((w, h) => {
    lastSig = ""; // the canvas was cleared
    W = w;
    H = h;
    // Flush left on a fixed margin, like a line of metal type locked up
    // against the left of the chase: weight only ever pushes letters to the
    // right. The size is set so the all-black word overruns the right edge
    // by about an eighth of the frame, while the all-hairline word still
    // closes inside the right margin, so the bleed belongs to the weight
    // axis, not to the layout.
    margin = Math.max(16, Math.round((W * 0.04) / 4) * 4);
    const span = (w, s) => (layoutEm(chars.map(() => w))[n] - lsb(chars[0], w)) * s + lawPx(s) * (n - 1);
    const fit = (w, right) => (right - margin - 0.043 * 12 * (n - 1)) / (layoutEm(chars.map(() => w))[n] - lsb(chars[0], w) - 0.043 * (n - 1));
    size = fit(W_MAX, W * 1.12);
    if (margin + span(W_MIN, size) > W - margin) size = fit(W_MIN, W - margin);
    size = Math.min(size, (H * 0.74) / capH);
    track = lawPx(size);
    unit = (layoutEm(chars.map(() => 500))[n] * size + track * (n - 1)) / n;
    baseline = Math.round(H / 2 + (capH * size) / 2);
  });

  // Source of truth for the pointer: real input, or a scripted path for the
  // intro, the embedded tile's idle drift and the ?t= still.
  let px = 0.18;
  let weightX = 0.18; // where the weight was last set from
  let drag = null;
  let pin = null; // the crest held by a press, in letters along the word
  let reachTo = REACH_REST; // where REACH is headed
  let reach = REACH_REST;
  let reachV = 0;
  let touched = false;
  const weightOf = (fx) => {
    const f = clamp((fx - 0.06) / 0.88, 0, 1);
    // Slight ease toward the ends so hairline and black each get room.
    const e = f * f * (3 - 2 * f) * 0.35 + f * 0.65;
    return W_MIN + (W_MAX - W_MIN) * e;
  };

  // Pointer x in letters along the word: the centres of the letters as last
  // drawn, interpolated, and extended past either end at one letter a unit.
  const centres = new Float64Array(n);
  const letterAt = (x) => {
    if (x <= centres[0]) return (x - centres[0]) / unit;
    if (x >= centres[n - 1]) return n - 1 + (x - centres[n - 1]) / unit;
    let i = 0;
    while (x > centres[i + 1]) i += 1;
    return i + (x - centres[i]) / Math.max(1, centres[i + 1] - centres[i]);
  };
  // The letter whose advance the pointer is over: a press holds the crest on
  // a whole letter, so a steep REACH always leaves one letter at black.
  const lefts = new Float64Array(n + 1);
  const letterUnder = (x) => {
    let i = 0;
    while (i < n - 1 && x >= lefts[i + 1]) i += 1;
    return i;
  };

  // REACH lives on a log scale, so the same drag halves or doubles it
  // wherever it starts. Up or left steepens; down or right widens. The
  // spring on REACH softens the stops at either end.
  const lnMin = Math.log(REACH_MIN / REACH_REST);
  const lnMax = Math.log(REACH_MAX / REACH_REST);
  const reachFor = (dx, dy) => REACH_REST * Math.exp(clamp((dx + dy) / Math.max(110, H * 0.16), lnMin, lnMax));

  stage.on("down", (p, e) => {
    touched = true;
    drag = { x: p.x, y: p.y, touch: e.pointerType === "touch" };
    canvas.style.cursor = "grabbing";
    px = p.x / W;
    // A finger has no hover, so on touch the crest goes where the finger is
    // and keeps following it sideways; only the vertical drag sets REACH.
    if (drag.touch) weightX = px;
    else pin = letterUnder(p.x);
  });
  stage.on("move", (p) => {
    touched = true;
    px = p.x / W;
    if (!drag) {
      weightX = px;
      return;
    }
    if (drag.touch) weightX = px;
    reachTo = reachFor(drag.touch ? 0 : p.x - drag.x, p.y - drag.y);
  });
  stage.on("up", () => {
    drag = null;
    pin = null;
    reachTo = REACH_REST;
    canvas.style.cursor = "grab";
  });

  const ease = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
  const easeInOut = (u) => {
    u = clamp(u, 0, 1);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  };

  let simT = 0;

  const step = (dt) => {
    simT += dt;
    if (still !== null) {
      // Hold at hairline, then one sweep to t; the frame freezes mid-wave.
      // With ?pin, the sweep ends in a press on that letter and a drag that
      // takes REACH to ?reach.
      const u = (simT - 0.8) / stillDur;
      const fx = 0.08 + (still - 0.08) * ease(u);
      px = fx;
      weightX = fx;
      if (stillPin !== null && u >= 1) {
        pin = stillPin;
        reachTo = stillReach;
      }
    } else if (!touched || (embedded && stage.idleFor() > 5000)) {
      // Intro: from hairline across to black, then settle with the crest
      // on the t so the word rests as a ramp from hairline W to a black t;
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

    // REACH: the same critically damped spring as the weights, so it
    // follows a drag closely and relaxes back on release without overshoot.
    const orr = reduced ? 40 : 14;
    reachV += (orr * orr * (reachTo - reach) - 2 * orr * reachV) * dt;
    reach = clamp(reach + reachV * dt, REACH_MIN * 0.9, REACH_MAX * 1.1);

    // The wave: the crest's weight falls to hairline over REACH letters, so
    // the word always reads as a gradient through the axis. Unpressed, the
    // crest is under the pointer and its weight is the pointer's place on
    // the axis; pressed, it is held where it was and inked to black. Each
    // letter springs onto its own target, softer the further out it sits,
    // so the crest trails a moving hand by a beat per letter. (A spring
    // rather than a delay line: it is interruptible, and a reversal never
    // has to finish an old wave first.)
    const tw = pin !== null ? W_MAX : weightOf(weightX);
    const at = pin !== null ? pin : letterAt(px * W);
    for (let i = 0; i < n; i += 1) {
      const g = glyphs[i];
      const dl = Math.abs(i - at); // in letters
      const target = W_MIN + (tw - W_MIN) * Math.pow(1 - clamp(dl / reach, 0, 1), GRADE);
      // Weight: critically damped, so it never overshoots past the axis.
      const om = reduced ? 30 : 22 / (1 + LAG * dl);
      const a = om * om * (target - g.w) - 2 * om * g.wv;
      g.wv += a * dt;
      g.w = clamp(g.w + g.wv * dt, W_MIN, W_MAX);
    }
  };

  // Big glyphs are filled as paths every frame, and a weight the canvas has
  // not drawn yet costs a new font instance, so a settled word is not redrawn.
  const draw = () => {
    const dpr = stage.dpr;
    let sig = `${W}|${H}|${dpr}`;
    for (const g of glyphs) sig += `|${Math.round(g.w)}`;
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
    // The W's ink edge is pinned to the margin at its current weight.
    // Nothing on the left ever moves; only the right side does.
    const x0 = margin - lsb(chars[0], weights[0]) * size;
    for (let i = 0; i < n; i += 1) {
      const x = x0 + em[i] * size + track * i;
      // Each letter's box runs to halfway through the tracking either side.
      lefts[i] = x - track / 2;
      centres[i] = x + (adv(chars[i], weights[i]) * size) / 2;
      ctx.font = fontAt(weights[i], size);
      ctx.fillText(chars[i], x, baseline);
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
