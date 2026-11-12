// One word, morphing letter by letter into the next. Each word is laid out
// once by the browser (real kerning, tracking from the house law), and every
// glyph is then set alone at the x the browser gave it. A glyph two words
// share is the same element in both: it slides on a spring from its place in
// the old word to its place in the new one.
//
// A glyph only in the new word has no spring of its own while the word moves:
// it is bound to its kept neighbours (x = anchor.x + its offset from the
// anchor in the new word), so it rides in with the sliding word and can never
// land on it. It wipes in, full ink, out of the neighbour's side, and is let go
// to its own spring once its anchors have settled. A glyph only in the old
// word keeps full ink and is cut away: the live word closing over it trims it
// edge by edge, and a short wipe out of its own box finishes it.

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

const ENTER = { delay: 0.05, dur: 0.34, stagger: 0.035 };
const EXIT = { delay: 0.06, dur: 0.32 };
const GUTTER = 0.04; // em of ground between a live glyph and one being cut
const SLIVER = 0.09; // em: narrower than this between two walls, a cut glyph is gone
const PAD = 0.03; // em of slack around a glyph's ink, so wipes start clean
const STEP = 1 / 240;
const AUTO_FIRST = 1.4;
const AUTO_EVERY = 2.2;
const AUTO_RESUME = 7;

const lawPx = (s) => -0.043 * (s - 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

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
  let inkCtx = null;
  let inkCache = new Map();

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
    inkCtx = document.createElement("canvas").getContext("2d");
    inkCtx.font = `600 ${size}px ${getComputedStyle(meter).fontFamily}`;
    inkCache = new Map();
    const cap = inkCtx.measureText("H").actualBoundingBoxAscent || size * 0.71;
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

  // A glyph's ink, left and right of its own box's left edge, with slack.
  const inkOf = (ch) => {
    let m = inkCache.get(ch);
    if (!m) {
      const t = inkCtx ? inkCtx.measureText(ch) : null;
      const l = t ? -(t.actualBoundingBoxLeft || 0) : 0;
      const r = t ? t.actualBoundingBoxRight || t.width : size * 0.6;
      m = { l: l - PAD * size, r: r + PAD * size, il: l, ir: r };
      inkCache.set(ch, m);
    }
    return m;
  };

  const styleGlyph = (g) => {
    g.el.style.fontSize = `${size}px`;
    g.el.style.lineHeight = `${Math.round(size)}px`;
    g.el.style.top = `${baseTop}px`;
    g.ink = inkOf(g.ch);
    g.drawn = "";
  };

  const makeGlyph = (ch, x) => {
    const el = document.createElement("span");
    el.className = "gm-glyph";
    el.setAttribute("aria-hidden", "true");
    el.textContent = ch;
    wordEl.append(el);
    const g = { ch, el, x, v: 0, tx: x, lo: 0, hi: 0, wipe: null, anchor: null, side: -1, left: [], right: [], drawn: "" };
    styleGlyph(g);
    return g;
  };

  // The visible span of a glyph is [lo, hi] across its ink, 0..1. Entering
  // grows it from one side, exiting collapses it toward one side.
  const wipeTo = (g, lo, hi, { delay, dur, ease = easeOut }) => {
    if (g.wipe ? g.wipe.lo === lo && g.wipe.hi === hi : g.lo === lo && g.hi === hi) return;
    const amount = Math.max(Math.abs(lo - g.lo), Math.abs(hi - g.hi));
    g.wipe = { flo: g.lo, fhi: g.hi, lo, hi, start: clock, delay, dur: dur * Math.max(0.35, amount), ease };
  };

  // Visible ink edges, relative to the glyph's own box, from its wipe alone.
  const span = (g) => {
    const w = g.ink.r - g.ink.l;
    return [g.ink.l + g.lo * w, g.ink.l + g.hi * w];
  };

  // Where a live glyph's visible ink ends on one side, in stage px.
  const inkEdge = (h, side) => {
    const [a, b] = span(h);
    if (b - a <= 0) return side === "right" ? -Infinity : Infinity;
    return side === "right" ? h.x + Math.min(b, h.ink.ir) : h.x + Math.max(a, h.ink.il);
  };

  // Where it cuts a leaving glyph: its ink edge plus a gutter of ground. The
  // gutter grows in with how far the edge has come since the morph began, so
  // a neighbour standing still in a tightly tracked word bites nothing. Caught
  // between two walls, the gutter also claims half the space the new word
  // keeps between them, so the glyph is gone exactly as the gap closes.
  const wallAt = ({ h, e0 }, side, half) => {
    const e = inkEdge(h, side);
    if (!Number.isFinite(e)) return e;
    const g = Math.max(GUTTER * size, half);
    const came = Number.isFinite(e0) ? Math.abs(e - e0) : Infinity;
    const [a, b] = span(h);
    const gut = g * clamp(Math.min(came, b - a) / g, 0, 1);
    return side === "right" ? e + gut : e - gut;
  };

  const draw = (g, wl = -Infinity, wr = Infinity) => {
    let [a, b] = span(g);
    a = Math.max(a, wl - g.x);
    b = Math.min(b, wr - g.x);
    // Once the word has nearly closed over it, a sliver is not worth showing.
    if (wl !== -Infinity && wr !== Infinity && b - a < SLIVER * size) b = a;
    const full = g.lo <= 0 && g.hi >= 1 && wl === -Infinity && wr === Infinity;
    const s = full ? `${g.x.toFixed(2)}|full` : `${g.x.toFixed(2)}|${a.toFixed(1)}|${b.toFixed(1)}`;
    if (s === g.drawn) return;
    g.drawn = s;
    g.el.style.transform = `translate3d(${g.x.toFixed(2)}px,0,0)`;
    if (full) {
      g.el.style.visibility = "";
      g.el.style.clipPath = "none";
    } else if (b - a < 0.5) {
      g.el.style.visibility = "hidden";
    } else {
      const t = (-0.4 * size).toFixed(1);
      const bt = (1.4 * size).toFixed(1);
      g.el.style.visibility = "";
      g.el.style.clipPath = `polygon(${a.toFixed(1)}px ${t}px,${b.toFixed(1)}px ${t}px,${b.toFixed(1)}px ${bt}px,${a.toFixed(1)}px ${bt}px)`;
    }
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

  const settled = (h) => !h || (h.x === h.tx && h.v === 0 && !h.anchor);

  // A riding glyph's place: its offset from each anchor's target, carried by
  // where that anchor is now; between two anchors, weighted by position.
  const place = (g) => {
    const { a, b, w, oa, ob } = g.anchor;
    const xa = a ? a.x + oa : 0;
    const xb = b ? b.x + ob : 0;
    g.x = a && b ? xa + (xb - xa) * w : a ? xa : xb;
    g.v = a && b ? a.v + (b.v - a.v) * w : (a || b).v;
  };

  const show = (i, { instant = false } = {}) => {
    index = (i + WORDS.length) % WORDS.length;
    const word = WORDS[index];
    const xs = layouts[index].x;
    const pairs = instant ? new Map() : match(glyphs, word, xs);
    const kept = new Set(pairs.values());
    const sprung = []; // indices in the new word that move on their own spring
    const next = [...word].map((ch, j) => {
      let g = pairs.get(j);
      let own = Boolean(g);
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
        if (near >= 0) {
          [g] = dying.splice(near, 1);
          own = true;
        }
      }
      if (g) {
        g.tx = xs[j];
        g.anchor = null;
        if (instant || reduced) {
          g.x = g.tx;
          g.v = 0;
        }
      } else g = makeGlyph(ch, xs[j]);
      if (own) sprung.push(j);
      if (instant) {
        g.lo = 0;
        g.hi = 1;
        g.wipe = null;
      } else if (own) wipeTo(g, 0, 1, ENTER);
      return g;
    });

    // New glyphs ride on their kept neighbours until those settle.
    if (!instant) {
      next.forEach((g, j) => {
        if (sprung.includes(j)) return;
        let L = -1;
        let R = -1;
        for (const k of sprung) {
          if (k < j) L = k;
          else if (R < 0) R = k;
        }
        if (L < 0 && R < 0) {
          wipeTo(g, 0, 1, ENTER);
          return;
        }
        const a = L >= 0 ? next[L] : null;
        const b = R >= 0 ? next[R] : null;
        const w = a && b ? (j - L) / (R - L) : a ? 0 : 1;
        g.anchor = { a, b, w, oa: a ? xs[j] - a.tx : 0, ob: b ? xs[j] - b.tx : 0 };
        place(g);
        // Grow out of the nearer neighbour's side.
        const fromLeft = Boolean(a) && (!b || j - L <= R - j);
        g.side = fromLeft ? -1 : 1;
        const d = fromLeft ? j - L : R - j;
        if (!fromLeft) {
          g.lo = 1;
          g.hi = 1;
        }
        wipeTo(g, 0, 1, { ...ENTER, delay: ENTER.delay + ENTER.stagger * (d - 1) });
      });
    }

    for (const g of glyphs) {
      if (kept.has(g) || next.includes(g)) continue;
      if (instant) g.el.remove();
      else {
        g.anchor = null; // keeps its velocity, finishes on its own spring
        g.fresh = true;
        dying.push(g);
      }
    }
    glyphs = next;

    // Which live glyphs close in on each leaving glyph from either side. A
    // glyph riding a neighbour counts as standing just beside that neighbour.
    const key = (h) => {
      if (!h.anchor) return h.x;
      return h.side < 0 ? h.anchor.a.x + 0.5 : h.anchor.b.x - 0.5;
    };
    for (const g of dying) {
      g.left = glyphs.filter((h) => key(h) < g.x).map((h) => ({ h, e0: inkEdge(h, "right") }));
      g.right = glyphs.filter((h) => key(h) >= g.x).map((h) => ({ h, e0: inkEdge(h, "left") }));
      // The ground the new word leaves between this glyph's two walls.
      const tl = Math.max(-Infinity, ...g.left.map((w) => w.h.tx + w.h.ink.ir));
      const tr = Math.min(Infinity, ...g.right.map((w) => w.h.tx + w.h.ink.il));
      g.half = Number.isFinite(tl) && Number.isFinite(tr) ? Math.max(0, tr - tl) / 2 : 0;
      if (!g.fresh) continue;
      g.fresh = false;
      // Wipe out toward the nearer live neighbour, so the timed wipe and the
      // closing word cut from the same side.
      const dl = g.left.length ? g.x - Math.max(...g.left.map((w) => key(w.h))) : Infinity;
      const dr = g.right.length ? Math.min(...g.right.map((w) => key(w.h))) - g.x : Infinity;
      if (dl <= dr) wipeTo(g, g.hi, g.hi, { ...EXIT, ease: easeInOut });
      else wipeTo(g, g.lo, g.lo, { ...EXIT, ease: easeInOut });
    }
    onLive(word);
    kick();
  };

  const step = (dt) => {
    clock += dt;
    let busy = false;
    const all = [...glyphs, ...dying];
    for (const g of all) {
      const f = g.wipe;
      if (f) {
        const t = clamp((clock - f.start - f.delay) / f.dur, 0, 1);
        const e = f.ease(t);
        g.lo = f.flo + (f.lo - f.flo) * e;
        g.hi = f.fhi + (f.hi - f.fhi) * e;
        if (t >= 1) {
          g.lo = f.lo;
          g.hi = f.hi;
          g.wipe = null;
        } else busy = true;
      }
      if (g.anchor) continue;
      const acc2 = -K * (g.x - g.tx) - C * g.v;
      g.v += acc2 * dt;
      g.x += g.v * dt;
      if (Math.abs(g.x - g.tx) < 0.01 && Math.abs(g.v) < 0.01) {
        g.x = g.tx;
        g.v = 0;
      } else busy = true;
    }
    for (const g of glyphs) {
      if (!g.anchor) continue;
      busy = true;
      if (settled(g.anchor.a) && settled(g.anchor.b)) {
        g.anchor = null;
        g.x = g.tx;
        g.v = 0;
      } else place(g);
    }
    dying = dying.filter((g) => {
      if (g.wipe || g.hi - g.lo > 1e-4) return true;
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
    for (const g of dying) {
      let wl = -Infinity;
      let wr = Infinity;
      for (const w of g.left) wl = Math.max(wl, wallAt(w, "right", g.half));
      for (const w of g.right) wr = Math.min(wr, wallAt(w, "left", g.half));
      draw(g, wl, wr);
    }
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
