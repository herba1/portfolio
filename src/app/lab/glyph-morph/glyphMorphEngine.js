// One word, morphing letter by letter into the next. Each word is laid out
// once by the browser (real kerning, tracking from the house law), and every
// glyph is then set alone at the x the browser gave it. A glyph two words
// share is the same element in both: it slides on a spring from its place in
// the old word to its place in the new one. Glyphs only in the old word blur
// out where they stand; glyphs only in the new one blur in.

const WORDS = ["Help", "Hello", "Yellow", "Yes", "Yesterday", "Birthday", "Blackbird", "Bird", "Here", "There", "Helter"];

// Spring for shared glyphs, in Motion's terms: settles visually in ~0.5s
// with a hair of overshoot. Mass 1.
const VISUAL = 0.52;
const BOUNCE = 0.12;
const K = (2 * Math.PI / VISUAL) ** 2;
const C = 2 * (1 - BOUNCE) * Math.sqrt(K);
// The press: a stiffer, fully damped spring on the whole word.
const K_PRESS = 900;
const C_PRESS = 2 * Math.sqrt(K_PRESS);

const ENTER = { delay: 0.07, dur: 0.38 };
const EXIT = { delay: 0, dur: 0.2 };
const BLUR = 0.045; // in em, at fully transparent
const STEP = 1 / 240;
const AUTO_FIRST = 1.4;
const AUTO_EVERY = 2.2;
const AUTO_RESUME = 7;

const lawPx = (s) => -0.043 * (s - 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) ** 3;

export async function createGlyphMorph(stage, { embedded = false, onLive = () => {} } = {}) {
  const params = new URLSearchParams(window.location.search);
  const holdT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 5) : null;
  const startAt = clamp(parseInt(params.get("w") || "0", 10) || 0, 0, WORDS.length - 1);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const surface = document.createElement("div");
  surface.className = "gm-surface";
  surface.setAttribute("role", "button");
  surface.setAttribute("aria-label", "Next word");
  surface.tabIndex = 0;
  const wordEl = document.createElement("div");
  wordEl.className = "gm-word";
  surface.append(wordEl);
  const meter = document.createElement("div");
  meter.className = "gm-meter";
  meter.setAttribute("aria-hidden", "true");
  surface.append(meter);
  stage.append(surface);

  try {
    await document.fonts.load(`600 100px ${getComputedStyle(meter).fontFamily}`);
    await document.fonts.ready;
  } catch {}

  const box = stage.closest(".piece-box") || stage;
  let W = 0;
  let H = 0;
  let size = 0;
  let baseTop = 0; // top of a glyph box so its baseline sits on the line
  let layouts = []; // per word: { x: absolute lefts }
  let index = startAt;
  let glyphs = []; // the current word, in order
  let dying = [];
  let clock = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let destroyed = false;
  let press = 1;
  let pressV = 0;
  let pressT = 1;
  let autoTimer = 0;
  let originY = 0;

  const measureWord = (word) => {
    meter.textContent = word;
    const node = meter.firstChild;
    const origin = meter.getBoundingClientRect().left;
    const range = document.createRange();
    const lefts = [];
    for (let i = 0; i < word.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      lefts.push(range.getBoundingClientRect().left - origin);
    }
    range.setStart(node, word.length - 1);
    range.setEnd(node, word.length);
    const end = range.getBoundingClientRect().right - origin;
    return { lefts, end };
  };

  const setMeter = (s) => {
    meter.style.fontSize = `${s}px`;
    meter.style.lineHeight = `${Math.round(s)}px`;
    const track = lawPx(s);
    meter.style.letterSpacing = s >= 20 ? `${(track / s).toFixed(4)}em` : `${track.toFixed(2)}px`;
    return track;
  };

  const layout = () => {
    const r = box.getBoundingClientRect();
    W = r.width;
    H = r.height;
    if (!W || !H) return false;
    // Fit the widest word: width(s) = adv100 * s / 100 + law(s) * (n - 1).
    setMeter(100);
    meter.style.letterSpacing = "0";
    const side = Math.max(24, W * (W < 640 ? 0.07 : 0.1));
    const room = W - side * 2;
    let fit = Infinity;
    for (const w of WORDS) {
      const { end } = measureWord(w);
      const n = w.length - 1;
      fit = Math.min(fit, (room - 0.516 * n) / (end / 100 - 0.043 * n));
    }
    size = Math.round(clamp(Math.min(fit, H * 0.42, 340), 24, 340));
    const track = setMeter(size);
    // Baseline: a zero-size inline-block sits on it.
    meter.textContent = "H";
    const probe = document.createElement("span");
    probe.className = "gm-probe";
    meter.append(probe);
    const baseOff = probe.getBoundingClientRect().top - meter.getBoundingClientRect().top;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `600 ${size}px ${getComputedStyle(meter).fontFamily}`;
    const cap = ctx.measureText("H").actualBoundingBoxAscent || size * 0.71;
    // Centre the cap band, nudged a touch above true centre.
    const baseline = Math.round(H / 2 + cap / 2 - H * 0.015);
    baseTop = baseline - baseOff;
    originY = baseline - cap / 2;
    layouts = WORDS.map((w) => {
      const { lefts, end } = measureWord(w);
      const width = end - track; // drop the trailing tracking after the last glyph
      const x0 = (W - width) / 2;
      return { x: lefts.map((l) => x0 + l) };
    });
    meter.textContent = "";
    for (const g of [...glyphs, ...dying]) styleGlyph(g);
    wordEl.style.transformOrigin = `${W / 2}px ${originY}px`;
    return true;
  };

  const styleGlyph = (g) => {
    g.el.style.fontSize = `${size}px`;
    g.el.style.lineHeight = `${Math.round(size)}px`;
    g.el.style.top = `${baseTop}px`;
  };

  const makeGlyph = (ch, x) => {
    const el = document.createElement("span");
    el.className = "gm-glyph";
    el.setAttribute("aria-hidden", "true");
    el.textContent = ch;
    wordEl.append(el);
    const g = { ch, el, x, v: 0, tx: x, a: 0, fade: null, drawn: "" };
    styleGlyph(g);
    return g;
  };

  const fadeTo = (g, to, { delay, dur }) => {
    if (g.fade ? g.fade.to === to : g.a === to) return;
    g.fade = { from: g.a, to, start: clock, delay, dur: dur * Math.max(0.35, Math.abs(to - g.a)) };
  };

  const draw = (g) => {
    const blur = (1 - g.a) * BLUR * size;
    const s = `${g.x.toFixed(2)}|${g.a.toFixed(3)}`;
    if (s === g.drawn) return;
    g.drawn = s;
    g.el.style.transform = `translate3d(${g.x.toFixed(2)}px,0,0)`;
    g.el.style.opacity = g.a.toFixed(3);
    g.el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
  };

  // Which glyphs of the current word carry over: the longest run of letters
  // the two words share in order (so no glyph ever slides through another),
  // and among equally long runs the one that moves the glyphs least.
  const match = (from, word, xs) => {
    const n = from.length;
    const m = word.length;
    const best = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
    for (let i = n; i >= 0; i -= 1) {
      for (let j = m; j >= 0; j -= 1) {
        if (i === n || j === m) {
          best[i][j] = { c: 0, d: 0 };
          continue;
        }
        let pick = best[i + 1][j];
        const alt = best[i][j + 1];
        if (alt.c > pick.c || (alt.c === pick.c && alt.d < pick.d)) pick = alt;
        if (from[i].ch === word[j]) {
          const t = best[i + 1][j + 1];
          const take = { c: t.c + 1, d: t.d + Math.abs(from[i].tx - xs[j]) };
          if (take.c > pick.c || (take.c === pick.c && take.d < pick.d)) pick = { ...take, take: true };
        }
        best[i][j] = pick.take && pick !== best[i + 1][j] && pick !== best[i][j + 1] ? pick : { c: pick.c, d: pick.d };
      }
    }
    const pairs = new Map(); // new index -> old glyph
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const here = best[i][j];
      if (here.take) {
        pairs.set(j, from[i]);
        i += 1;
        j += 1;
      } else if (best[i + 1][j].c === here.c && best[i + 1][j].d === here.d) i += 1;
      else j += 1;
    }
    return pairs;
  };

  const show = (i, { instant = false } = {}) => {
    index = (i + WORDS.length) % WORDS.length;
    const word = WORDS[index];
    const xs = layouts[index].x;
    const pairs = instant ? new Map() : match(glyphs, word, xs);
    const kept = new Set(pairs.values());
    const next = [...word].map((ch, j) => {
      let g = pairs.get(j);
      if (!g && !instant) {
        // A glyph still on its way out, close by, comes back instead.
        let near = -1;
        let nd = size * 0.35;
        dying.forEach((o, k) => {
          const d = Math.abs(o.x - xs[j]);
          if (o.ch === ch && d < nd) {
            near = k;
            nd = d;
          }
        });
        if (near >= 0) [g] = dying.splice(near, 1);
      }
      if (g) {
        g.tx = xs[j];
        if (instant || reduced) {
          g.x = g.tx;
          g.v = 0;
        }
      } else g = makeGlyph(ch, xs[j]);
      if (instant) {
        g.a = 1;
        g.fade = null;
      } else fadeTo(g, 1, ENTER);
      return g;
    });
    for (const g of glyphs) {
      if (kept.has(g) || next.includes(g)) continue;
      if (instant) g.el.remove();
      else {
        fadeTo(g, 0, EXIT);
        dying.push(g);
      }
    }
    glyphs = next;
    onLive(word);
    kick();
  };

  const step = (dt) => {
    clock += dt;
    let busy = false;
    const all = [...glyphs, ...dying];
    for (const g of all) {
      const f = g.fade;
      if (f) {
        const t = clamp((clock - f.start - f.delay) / f.dur, 0, 1);
        g.a = f.from + (f.to - f.from) * easeOut(t);
        if (t >= 1) {
          g.a = f.to;
          g.fade = null;
        } else busy = true;
      }
      const acc2 = -K * (g.x - g.tx) - C * g.v;
      g.v += acc2 * dt;
      g.x += g.v * dt;
      if (Math.abs(g.x - g.tx) < 0.01 && Math.abs(g.v) < 0.01) {
        g.x = g.tx;
        g.v = 0;
      } else busy = true;
    }
    dying = dying.filter((g) => {
      if (g.fade || g.a > 0) return true;
      g.el.remove();
      return false;
    });
    pressV += (-K_PRESS * (press - pressT) - C_PRESS * pressV) * dt;
    press += pressV * dt;
    if (Math.abs(press - pressT) < 1e-4 && Math.abs(pressV) < 1e-4) {
      press = pressT;
      pressV = 0;
    } else busy = true;
    return busy;
  };

  const render = () => {
    for (const g of glyphs) draw(g);
    for (const g of dying) draw(g);
    wordEl.style.transform = press === 1 ? "" : `scale(${press.toFixed(4)})`;
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt;
    let busy = true;
    while (acc >= STEP) {
      busy = step(STEP);
      acc -= STEP;
    }
    render();
    if (busy) raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (raf || destroyed || holdT !== null) return;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  };

  const schedule = (sec) => {
    clearTimeout(autoTimer);
    if (holdT !== null || destroyed) return;
    autoTimer = setTimeout(() => {
      if (document.hidden) return schedule(AUTO_EVERY);
      show(index + 1);
      schedule(AUTO_EVERY);
    }, sec * 1000);
  };

  const advance = (dir) => {
    show(index + dir);
    schedule(AUTO_RESUME);
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    pressT = 0.985;
    kick();
  };
  const onUp = (e) => {
    if (pressT === 1) return;
    pressT = 1;
    kick();
    if (e.type === "pointerup") advance(e.shiftKey ? -1 : 1);
  };
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target !== surface && e.target !== document.body) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      if (e.repeat) return;
      advance(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      advance(-1);
    }
  };
  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointerup", onUp);
  surface.addEventListener("pointerleave", onUp);
  surface.addEventListener("pointercancel", onUp);
  const keyTarget = embedded ? surface : window;
  keyTarget.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => {
    const r = box.getBoundingClientRect();
    if (Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5) return;
    if (!layout()) return;
    // Snap to the settled word at the new size.
    for (const g of dying) g.el.remove();
    dying = [];
    show(index, { instant: true });
    render();
  });
  ro.observe(box);

  layout();
  show(index, { instant: true });
  if (holdT !== null) {
    // A still of the morph: from word w to w + 1, t seconds in.
    show(index + 1);
    const n = Math.round(holdT / STEP);
    for (let i = 0; i < n; i += 1) step(STEP);
  }
  render();
  requestAnimationFrame(() => surface.setAttribute("data-ready", ""));
  schedule(AUTO_FIRST);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(autoTimer);
      ro.disconnect();
      keyTarget.removeEventListener("keydown", onKey);
      surface.remove();
    },
  };
}
