// One value, t (seconds into a 4:07 track), drives everything.
//
// Dragging moves t by the pointer's horizontal travel times a gain. The gain
// falls continuously as the pointer leaves the track vertically, 1 → 1/2 →
// 1/4 → 1/8 → 1/16, and the page answers with no labels at all: the ruler grows a
// loupe around the playhead whose magnification is exactly 1 / gain (so the
// magnified ticks slide under the finger one to one), and the readout opens
// a drawer of precision digits.
//
// When precision is let go the playhead is no longer under the finger. It is
// never yanked back: the offset closes in proportion to how far the finger
// moves at full speed, so it only ever travels while you are travelling.

const DURATION = 247;
const START = 72;
const MARGIN = 56; // canvas overhang each side of the track, for the loupe
const H = 80; // canvas height, css px
const MID = 40; // track centre line in the canvas
const DEAD = 24; // px either side of the track that stay at full speed
const K_MAX = 4; // 2^-4 = 1/16: at full precision tenths are ~5px apart

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

// Tick levels in tenths of a second, coarsest first. Each level is drawn
// only where its own local output spacing gives it room: it fades in across
// [lo, hi] css px. Each level's lo times the step to its coarser neighbour
// clears that neighbour's hi, so a finer level can never show where a
// coarser one is missing and only one level is ever mid-fade at a place.
// The windows are also low enough that when a level hands over, the next
// coarser one is no more than ~30px apart: the glass never opens a hole.
// Tenths are short hairlines and so may sit closer than the rest.
const LEVELS = [
  { n: 600, h: 20, lo: 0, hi: 0 },
  { n: 100, h: 12, lo: 5, hi: 8 },
  { n: 50, h: 8, lo: 9, hi: 13 },
  { n: 10, h: 6, lo: 4.5, hi: 7 },
  { n: 5, h: 4, lo: 7, hi: 10 },
  { n: 1, h: 3, lo: 3.6, hi: 4.6 },
];
const levelAlpha = (lvl, spacing) => {
  const L = LEVELS[lvl];
  return L.hi > 0 ? smooth(L.lo, L.hi, spacing) : 1;
};
// Magnified ticks grow by zoom^0.75. Every level shares that one factor (up
// to S_MAX) so the glass keeps the ruler's proportions instead of flattening
// them into a comb; only the tallest marks are then eased onto ~H_CAP px.
const H_CAP = 34;
const H_KNEE = 24;
const S_MAX = 4;
const tickHeight = (base, zoom) => {
  let s = zoom ** 0.75;
  if (s > 1) s = 1 + (S_MAX - 1) * Math.tanh((s - 1) / (S_MAX - 1));
  const h = base * s;
  if (h <= H_KNEE || base * s <= base) return h;
  return Math.max(base, H_KNEE + (H_CAP - H_KNEE) * Math.tanh((h - H_KNEE) / (H_CAP - H_KNEE)));
};

// ---------- the loupe ----------
// One monotonic map from input px (time × pps) to output px across the whole
// track, so the ruler is always a true scale with a lens on it. Its density
// (output px per input px) is M in the core, ±R output px either side of the
// playhead, so the magnified ticks run at exactly 1 / gain. The width the core
// gains is paid for by everything else at one uniform rate c, which means
// both sides give it up in proportion to their duration and every minute
// outside the glass stays the same width as every other. Core and track meet
// in a smoothstep shoulder about R/2 wide: no pinch, no crushed neighbour.
//
//   density(x) = c + (M − c) · w(x − tx)
//   w = 1 on |d| ≤ h, smoothstep down to 0 over [h, h + s], 0 beyond
//   ∫ density over [0, W] = W  →  c = (W − M·∫w) / (W − ∫w)
function makeLens() {
  let M = 1;
  let c = 1;
  let h = 0; // core half-width, input px
  let s = 1; // shoulder width, input px
  let tx = 0;
  let W = 1;
  // ∫ w over [0, d], odd in d.
  const G = (d) => {
    const a = Math.abs(d);
    let v;
    if (a <= h) v = a;
    else if (a >= h + s) v = h + s / 2;
    else {
      const u = (a - h) / s;
      v = h + s * (u - u * u * u + (u * u * u * u) / 2);
    }
    return d < 0 ? -v : v;
  };
  const w = (d) => {
    const a = Math.abs(d);
    if (a <= h) return 1;
    if (a >= h + s) return 0;
    const u = (a - h) / s;
    return 1 - u * u * (3 - 2 * u);
  };
  let g0 = 0;
  const set = (m, x, width, R) => {
    M = Math.max(1, m);
    tx = x;
    W = width;
    h = R / M;
    c = 1;
    // The shoulder is ~R/2 in output px; its input width depends on c, so
    // settle the two together. Three passes are plenty.
    for (let i = 0; i < 3; i += 1) {
      s = R / (M + c);
      const wint = G(W - tx) + G(tx);
      c = M <= 1.0001 ? 1 : clamp((W - M * wint) / Math.max(1e-6, W - wint), 0.05, 1);
    }
    g0 = G(tx);
  };
  const forward = (x) => (M <= 1.0001 ? x : c * x + (M - c) * (G(x - tx) + g0));
  const density = (x) => (M <= 1.0001 ? 1 : c + (M - c) * w(x - tx));
  set(1, 0, 1, 1);
  return {
    set,
    forward,
    density,
    get M() {
      return M;
    },
    get c() {
      return c;
    },
    // Input extent of the glass (core plus shoulder) either side of tx.
    get reach() {
      return h + s;
    },
    // Input half-width of the core alone.
    get core() {
      return h;
    },
  };
}

export function createPrecision(root, { embedded, stage, canvas, readout, whole, frac }) {
  const box = root.closest(".piece-box") || root;
  const ctx = canvas.getContext("2d");
  const fracInner = frac.firstElementChild;
  const loupe = makeLens();
  const params = new URLSearchParams(window.location.search);
  const frozenT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, DURATION) : null;
  const frozenY = params.has("y") ? parseFloat(params.get("y")) || 0 : null;
  const frozen = frozenT != null || frozenY != null;
  if (frozen) root.setAttribute("data-frozen", "");

  const ink = [26, 26, 26];
  let labelFont = "540 10px monospace";

  let t = frozenT ?? START;
  let playing = !frozen && !embedded;
  let mode = "idle"; // idle | drag | coast | key
  let vel = 0; // s/s, for coasting
  let k = 0; // precision target, 0..3 (gain = 2^-k)
  let kS = 0; // smoothed
  let dec = 0; // digits shown
  let holdUntil = 0; // keep digits briefly after release
  let keyTarget = t;
  let keyFineUntil = 0;

  let W = 600; // track width
  let pps = W / DURATION;
  let R = 112; // core half-width, output px
  let dpr = 1;
  let unitY = 72; // px of vertical travel per halving
  let readW = 0;
  let labelW = 24; // width of one m:ss figure

  // drag
  let dragId = null;
  let lastX = 0;
  let lastMoveT = 0;
  let dragVel = 0;
  let px = 0; // pointer x, track-local
  let seeking = false;

  let raf = 0;
  let lastT = 0;
  let destroyed = false;
  let visible = true;
  let drawnKey = "";

  const resize = () => {
    const r = box.getBoundingClientRect();
    const side = Math.max(32, r.width * 0.12);
    W = Math.round(clamp(r.width - side * 2, 220, 760));
    pps = W / DURATION;
    R = Math.round(clamp(W * 0.15, 40, 116));
    unitY = clamp(Math.round((r.height * 0.36 - DEAD) / K_MAX), 24, 56);
    stage.style.width = `${W + MARGIN * 2}px`;
    dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round((W + MARGIN * 2) * dpr);
    canvas.height = Math.round(H * dpr);
    const cs = getComputedStyle(readout);
    labelFont = `540 10px ${cs.fontFamily}`;
    ctx.font = labelFont;
    labelW = ctx.measureText("0:00").width;
    drawnKey = "";
    wake();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  // ---------- helpers ----------
  const thumbX = () => t * pps; // track-local, before the lens
  const thumbOut = () => loupe.forward(thumbX()); // where it is drawn
  const trackRect = () => {
    const c = canvas.getBoundingClientRect();
    return { left: c.left + MARGIN, mid: c.top + MID };
  };
  const kFromDist = (d) => clamp((Math.abs(d) - DEAD) / unitY, 0, K_MAX);
  const gain = () => 2 ** -kS;

  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  const fmt = () => {
    const cs = Math.floor(clamp(t, 0, DURATION) * 100 + 1e-6);
    const s = Math.floor(cs / 100);
    return { whole: `${Math.floor(s / 60)}:${pad(s % 60)}`, frac: `.${pad(cs % 100)}` };
  };

  // ---------- input ----------
  const onDown = (e) => {
    if (dragId != null || e.button > 0) return;
    root.focus({ preventScroll: true, focusVisible: false });
    dragId = e.pointerId;
    root.setPointerCapture?.(e.pointerId);
    root.setAttribute("data-drag", "");
    const tr = trackRect();
    px = e.clientX - tr.left;
    lastX = px;
    lastMoveT = performance.now();
    dragVel = 0;
    vel = 0;
    k = kFromDist(e.clientY - tr.mid);
    // Pressing the track away from the playhead seeks there, eased.
    seeking = k === 0 && px >= -8 && px <= W + 8 && Math.abs(px - thumbX()) > 10;
    mode = "drag";
    wake();
  };

  const onMove = (e) => {
    if (e.pointerId !== dragId) return;
    const tr = trackRect();
    const x = e.clientX - tr.left;
    const now = performance.now();
    const dx = x - lastX;
    const dtm = Math.max(1, now - lastMoveT);
    k = kFromDist(e.clientY - tr.mid);
    if (k > 0.05) seeking = false;
    const g = gain();
    const before = t;
    t += (dx * g) / pps;
    // At full speed the finger reels the playhead back in, but only by
    // moving: the closure is a share of the offset per px travelled.
    const off = x - thumbOut();
    const w = smooth(0.5, 0.95, g);
    if (!seeking && w > 0) t += ((1 - Math.exp(-Math.abs(dx) / 56)) * w * off) / pps;
    t = clamp(t, 0, DURATION);
    const inst = ((t - before) / dtm) * 1000;
    dragVel += (inst - dragVel) * Math.min(1, dtm / 48);
    lastX = x;
    px = x;
    lastMoveT = now;
    wake();
  };

  const onUp = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    root.removeAttribute("data-drag");
    seeking = false;
    const idle = performance.now() - lastMoveT;
    holdUntil = performance.now() + 1100;
    // Momentum only at full speed. Anything finer stays exactly where it is.
    if (gain() > 0.92 && idle < 60 && Math.abs(dragVel) > 4) {
      vel = clamp(dragVel, -600, 600);
      mode = "coast";
    } else {
      mode = "idle";
    }
    k = 0;
    wake();
  };

  const onKey = (e) => {
    const fine = e.altKey;
    const step = fine ? 0.1 : e.shiftKey ? 10 : 1;
    const base = mode === "key" ? keyTarget : t;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = base + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = base - step;
    else if (e.key === "PageUp") next = base + 30;
    else if (e.key === "PageDown") next = base - 30;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DURATION;
    else if (e.key === " " || e.key === "k") {
      e.preventDefault();
      if (t >= DURATION - 0.01) t = 0;
      playing = !playing;
      wake();
      return;
    }
    if (next == null) return;
    e.preventDefault();
    if (dragId != null) return;
    if (fine) {
      next = Math.round(next * 10) / 10;
      keyFineUntil = performance.now() + 1400;
      holdUntil = keyFineUntil;
    }
    keyTarget = clamp(next, 0, DURATION);
    mode = "key";
    vel = 0;
    wake();
  };

  if (!frozen) {
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("keydown", onKey);
  }

  // ---------- physics ----------
  const step = (dt, now) => {
    if (frozen) {
      kS = frozenY != null ? kFromDist(frozenY) : 0;
      k = kS;
      return;
    }
    const kGoal = mode === "drag" ? k : now < keyFineUntil ? 2 : 0;
    // Precision eases in a little slower than it lets go.
    const rate = kGoal > kS ? 12 : 9;
    kS += (kGoal - kS) * (1 - Math.exp(-dt * rate));
    if (Math.abs(kGoal - kS) < 1e-3) kS = kGoal;

    if (mode === "drag") {
      if (seeking) {
        const off = px - thumbX();
        t = clamp(t + (off * (1 - Math.exp(-dt * 18))) / pps, 0, DURATION);
        if (Math.abs(off) < 0.5) seeking = false;
      }
      if (now - lastMoveT > 50) dragVel *= Math.exp(-12 * dt);
    } else if (mode === "coast") {
      vel *= Math.exp(-4.5 * dt);
      t += vel * dt;
      if (t <= 0 || t >= DURATION) {
        t = clamp(t, 0, DURATION);
        vel = 0;
      }
      if (Math.abs(vel) < 0.6) mode = "idle";
    } else if (mode === "key") {
      if (playing) keyTarget = Math.min(DURATION, keyTarget + dt);
      t += (keyTarget - t) * (1 - Math.exp(-dt * 20));
      if (Math.abs(keyTarget - t) < 0.002) {
        t = keyTarget;
        mode = "idle";
      }
    }
    if (playing && mode === "idle") {
      t += dt;
      if (t >= DURATION) {
        t = DURATION;
        playing = false;
      }
    }
  };

  const updateDigits = (now) => {
    // The readout claims exactly one digit past the finest mark under the
    // playhead, as you would read a ruler: seconds on the glass earn the
    // tenths digit, tenths on the glass earn the hundredths. Hysteresis so a
    // hand hovering at a threshold never flickers a digit.
    const M = 2 ** kS;
    const aSec = levelAlpha(3, pps * M);
    const aTenth = levelAlpha(5, 0.1 * pps * M);
    let want = aTenth > 0.6 ? 2 : aSec > 0.6 ? 1 : 0;
    if (dec === 2 && aTenth > 0.3) want = 2;
    if (dec >= 1 && want === 0 && aSec > 0.3) want = 1;
    if (want < dec && now < holdUntil && mode !== "drag") want = dec;
    if (frozen) want = aTenth > 0.5 ? 2 : aSec > 0.5 ? 1 : 0;
    if (want !== dec) {
      dec = want;
      frac.style.setProperty("--pr-n", String(dec ? dec + 1 : 0));
    }
  };

  // ---------- render ----------
  const render = () => {
    const M = 2 ** kS;
    loupe.set(M, thumbX(), W, R);
    const key = `${t.toFixed(4)}|${M.toFixed(4)}|${W}|${dpr}`;
    if (key !== drawnKey) {
      drawnKey = key;
      draw(M);
    }
    const f = fmt();
    if (whole.textContent !== f.whole) whole.textContent = f.whole;
    if (fracInner.textContent !== f.frac) fracInner.textContent = f.frac;
    // Centre the readout over the playhead, but keep it on the track.
    readW = readout.offsetWidth;
    const cx = MARGIN + thumbOut();
    const x = clamp(cx - readW / 2, MARGIN - 8, MARGIN + W + 8 - readW);
    readout.style.transform = `translate3d(${Math.round(x * dpr) / dpr}px, 0, 0)`;
  };

  const snap = (x) => Math.round(x * dpr) / dpr;

  // Figures follow the same map as the marks. A level is numbered where the
  // level beneath it is drawn (minutes where tens of seconds show, seconds
  // where halves show) and where its own figures have room; halves and tenths
  // are never numbered, so at tenths the glass counts whole seconds.
  const LABEL_STEP = [60, 10, 5, 1]; // seconds, coarsest first
  const LABEL_TRIGGER = [-1, 2, 3, 4]; // the tick level that earns each one
  const labelStrength = (lvl, density, gap) => {
    if (lvl === 0) return 1;
    const room = LABEL_STEP[lvl] * pps * density;
    const T = LABEL_TRIGGER[lvl];
    return levelAlpha(T, ((LEVELS[T].n / 10) * pps * density)) * smooth(gap, gap + 6, room);
  };
  const labelLevel = (sec) => (sec % 60 === 0 ? 0 : sec % 10 === 0 ? 1 : sec % 5 === 0 ? 2 : 3);

  const draw = (M) => {
    const cw = W + MARGIN * 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, H);
    const tx = thumbX();
    const lens = M > 1.0001;
    const mapX = loupe.forward;
    const lift = Math.log2(M) / K_MAX; // 0..1
    const ox = mapX(tx); // where the playhead lands

    // Coarse ticks run the whole track; fine ones only inside the glass.
    const n0 = 0;
    const n1 = Math.round(DURATION * 10);
    const reach = lens ? loupe.reach : 0;
    const fineLo = Math.max(n0, Math.floor(((tx - reach) / pps) * 10) - 10);
    const fineHi = Math.min(n1, Math.ceil(((tx + reach) / pps) * 10) + 10);

    const drawTick = (n, lvl) => {
      const L = LEVELS[lvl];
      const xin = (n / 10) * pps;
      const f = loupe.density(xin);
      // The level is chosen here, from this tick's own output spacing.
      let a = levelAlpha(lvl, (L.n / 10) * pps * f);
      // Outside the glass the whole compressed track hands a level over at
      // once, so the hand-over is kept short: a still never catches a row of
      // half-faded marks that read as residue.
      const crisp = 1 - smooth(1, 1.6, f);
      if (crisp > 0) a += (smooth(0.3, 0.7, a) - a) * crisp;
      if (a <= 0.01) return;
      const x = mapX(xin);
      // The glass magnifies the marks themselves, not just their spacing:
      // under the core they grow toward H_CAP, keeping their order, and step
      // up a device pixel or two in weight. The compressed track outside
      // keeps its marks at their own size; only their spacing is paid out.
      // A mark that is still finding room grows out of the centre line
      // rather than hanging there faint.
      const zoom = Math.max(1, f);
      const full = tickHeight(L.h, zoom);
      let h = Math.max(full * (0.5 + 0.5 * a), Math.min(full, 4));
      h = Math.max(1, Math.round(h * 2) / 2);
      a **= 0.75;
      const weight = (1 + smooth(1.5, 6, zoom)) * (lvl === 5 ? 0.5 : 1);
      const lw = Math.max(1, Math.round(weight * dpr)) / dpr;
      const played = n / 10 <= t;
      ctx.fillStyle = `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${(played ? 1 : 0.24) * a})`;
      ctx.fillRect(snap(MARGIN + x - lw / 2), snap(MID - h / 2), lw, snap(h));
    };

    const levelOf = (n) => {
      for (let i = 0; i < LEVELS.length; i += 1) if (n % LEVELS[i].n === 0) return i;
      return LEVELS.length - 1;
    };

    for (let n = n0; n <= n1; n += 50) {
      if (lens && n > fineLo && n < fineHi) continue;
      drawTick(n, levelOf(n));
    }
    // The final second, so the track has an end.
    if (n1 % 50 !== 0) drawTick(n1, 0);
    if (lens) {
      for (let n = fineLo; n <= fineHi; n += 1) drawTick(n, levelOf(n));
    }

    // Figures under the ruler, tied to the same map. Each candidate second
    // is numbered with the strength its level has at its own place, the
    // nearest numbered mark either side of the playhead is always kept, and
    // collisions are settled by output distance, most important first.
    ctx.font = labelFont;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.09px";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const gap = labelW + 14;
    const cands = [];
    const lastSec = Math.floor(DURATION);
    for (let sec = 0; sec <= lastSec; sec += 1) {
      const lvl = labelLevel(sec);
      const xin = sec * pps;
      // Seconds only ever surface under the glass.
      if (lvl === 3 && (!lens || Math.abs(xin - tx) > reach + pps)) continue;
      const a = labelStrength(lvl, loupe.density(xin), gap);
      cands.push({ sec, lvl, x: mapX(xin), a, force: 0 });
    }
    // Anchors: the finest level the playhead is numbering is its major, and
    // the nearest major mark on each side is always kept, so the readout
    // always has a figure beside it. A finer level still arriving is
    // anchored in proportion, so the hand-over does not pop.
    const anchor = (lvl, boost) => {
      const step = LABEL_STEP[lvl];
      const left = Math.floor(t / step + 1e-9) * step;
      for (const sec of [left, left + step]) {
        const c = cands.find((q) => q.sec === sec);
        if (!c) continue;
        c.force = Math.max(c.force, boost);
        c.a = Math.max(c.a, boost);
      }
    };
    let major = 0;
    for (let lvl = LABEL_STEP.length - 1; lvl > 0; lvl -= 1) {
      if (labelStrength(lvl, loupe.density(tx), gap) >= 0.5) {
        major = lvl;
        break;
      }
    }
    anchor(major, 1);
    if (major < LABEL_STEP.length - 1) {
      const S = labelStrength(major + 1, loupe.density(tx), gap);
      if (S > 0.01) anchor(major + 1, S * 2);
    }
    cands.sort(
      (p, q) =>
        (q.force > 0) - (p.force > 0) ||
        p.lvl - q.lvl ||
        Math.abs(p.x - ox) - Math.abs(q.x - ox),
    );
    const kept = [];
    for (const c of cands) {
      let a = c.a;
      if (a <= 0.01) continue;
      for (const k2 of kept) {
        a *= 1 - k2.a * (1 - smooth(gap - 4, gap, Math.abs(c.x - k2.x)));
        if (a <= 0.01) break;
      }
      // A figure is either there or not: the short ramp only keeps it from
      // popping while the glass moves, and a sliver never hangs on as a ghost.
      a = smooth(0.35, 0.75, a);
      if (a <= 0.01) continue;
      c.a = a;
      kept.push(c);
    }
    for (const c of kept) {
      ctx.fillStyle = `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${c.a})`;
      ctx.fillText(`${Math.floor(c.sec / 60)}:${pad(c.sec % 60)}`, snap(MARGIN + c.x), 72);
    }

    // The playhead, with a clear collar so no tick ever touches it. The
    // collar is cut out of the ticks rather than painted in paper colour, so
    // it leaves no notch in the glass beneath.
    const hx = snap(MARGIN + ox);
    const th = 16 + 6 * lift;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(hx - 3, MID - th - 2, 6, th * 2 + 4);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgb(${ink[0]}, ${ink[1]}, ${ink[2]})`;
    ctx.beginPath();
    ctx.roundRect(hx - 1, MID - th, 2, th * 2, 1);
    ctx.fill();

    // The glass itself: a slightly darker ground under the band of the
    // ruler, as dense as the magnification at each point, so the core reads
    // as a body and the shoulder feathers it back into paper. Painted behind
    // everything already drawn. Its edges sit on the 4px grid.
    if (lens) {
      const in0 = Math.max(0, tx - reach);
      const in1 = Math.min(W, tx + reach);
      const x0 = mapX(in0);
      const x1 = mapX(in1);
      if (x1 - x0 > 1) {
        // Full under the core, feathered out across the shoulder in output
        // space, so the glass fades over the same R/2 the scale bends over.
        const cL = mapX(Math.max(0, tx - loupe.core));
        const cR = mapX(Math.min(W, tx + loupe.core));
        const body = (xo) => (xo < cL ? smooth(x0, cL, xo) : 1 - smooth(cR, x1, xo));
        const STOPS = 48;
        const g = ctx.createLinearGradient(MARGIN + x0, 0, MARGIN + x1, 0);
        const rail = ctx.createLinearGradient(MARGIN + x0, 0, MARGIN + x1, 0);
        const fade = smooth(0, 1, lift * 2);
        for (let i = 0; i <= STOPS; i += 1) {
          const xo = x0 + ((x1 - x0) * i) / STOPS;
          const b = body(xo) * fade;
          g.addColorStop(i / STOPS, `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${0.055 * b})`);
          rail.addColorStop(i / STOPS, `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${0.22 * b ** 1.5})`);
        }
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = g;
        ctx.fillRect(MARGIN + x0, 16, x1 - x0, 44);
        // Hairline rails along the top and bottom of the glass.
        ctx.fillStyle = rail;
        const hair = 1 / dpr;
        ctx.fillRect(MARGIN + x0, 16, x1 - x0, hair);
        ctx.fillRect(MARGIN + x0, 60 - hair, x1 - x0, hair);
        ctx.globalCompositeOperation = "source-over";
      }
    }
  };

  let lastLabel = -1;
  const aria = () => {
    const s = Math.floor(t);
    if (s === lastLabel) return;
    lastLabel = s;
    root.setAttribute("aria-valuenow", String(s));
    root.setAttribute("aria-valuetext", `${Math.floor(s / 60)} minutes ${s % 60} seconds`);
  };

  // ---------- loop ----------
  const frame = (now) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    step(dt, now);
    updateDigits(now);
    render();
    aria();
    const busy = playing || mode !== "idle" || kS > 0 || now < holdUntil + 400;
    if (busy && !frozen) raf = requestAnimationFrame(frame);
    else lastT = 0;
  };
  function wake() {
    if (!raf && !destroyed && visible) raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(root);

  document.fonts?.ready.then(() => {
    if (destroyed) return;
    ctx.font = labelFont;
    labelW = ctx.measureText("0:00").width;
    drawnKey = "";
    wake();
  });

  wake();

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("keydown", onKey);
    },
  };
}
