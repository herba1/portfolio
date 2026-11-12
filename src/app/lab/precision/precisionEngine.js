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
// Inside ±R output px of the playhead, rho(v) is input px per output px at
// normalised output distance v: 1/M in the core, a soft compressed shoulder,
// then 1 again at the rim with a matching slope, so there is no seam. The
// bump is sized so the window maps onto itself exactly.
const V0 = 0.36;
const TABLE = 256;
function makeLoupe() {
  const P = new Float32Array(TABLE + 1);
  let M = 1;
  let beta = 0;
  const rho = (v) => {
    if (M <= 1.0001) return 1;
    const bell = v <= V0 ? 0 : Math.sin((Math.PI * (v - V0)) / (1 - V0)) ** 2;
    return 1 / M + (1 - 1 / M) * smooth(V0, 1, v) + beta * bell;
  };
  const set = (m) => {
    M = Math.max(1, m);
    beta = ((1 - 1 / M) * (1 + V0)) / (1 - V0);
    let acc = 0;
    let prev = rho(0);
    P[0] = 0;
    for (let i = 1; i <= TABLE; i += 1) {
      const r = rho(i / TABLE);
      acc += (prev + r) / (2 * TABLE);
      prev = r;
      P[i] = acc;
    }
    for (let i = 1; i <= TABLE; i += 1) P[i] /= acc;
  };
  // input offset (fraction of R, >= 0) → output offset (fraction of R)
  const forward = (u) => {
    if (M <= 1.0001 || u >= 1) return u;
    let lo = 0;
    let hi = TABLE;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (P[mid] <= u) lo = mid;
      else hi = mid;
    }
    const f = (u - P[lo]) / Math.max(1e-9, P[hi] - P[lo]);
    return (lo + f) / TABLE;
  };
  set(1);
  return { set, forward, rho, get M() { return M; } };
}

export function createPrecision(root, { embedded, stage, canvas, readout, whole, frac }) {
  const box = root.closest(".piece-box") || root;
  const ctx = canvas.getContext("2d");
  const fracInner = frac.firstElementChild;
  const loupe = makeLoupe();
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
  let R = 160;
  let dpr = 1;
  let unitY = 72; // px of vertical travel per halving
  let readW = 0;

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
    R = Math.round(clamp(W * 0.34, 112, 272));
    unitY = clamp(Math.round((r.height * 0.36 - DEAD) / K_MAX), 24, 56);
    stage.style.width = `${W + MARGIN * 2}px`;
    dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round((W + MARGIN * 2) * dpr);
    canvas.height = Math.round(H * dpr);
    const cs = getComputedStyle(readout);
    labelFont = `540 10px ${cs.fontFamily}`;
    drawnKey = "";
    wake();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  // ---------- helpers ----------
  const thumbX = () => t * pps; // track-local
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
    const off = x - thumbX();
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
    if (Math.abs(M - loupe.M) > 1e-4) loupe.set(M);
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
    const cx = MARGIN + thumbX();
    const x = clamp(cx - readW / 2, MARGIN - 8, MARGIN + W + 8 - readW);
    readout.style.transform = `translate3d(${Math.round(x * dpr) / dpr}px, 0, 0)`;
  };

  const snap = (x) => Math.round(x * dpr) / dpr;

  const draw = (M) => {
    const cw = W + MARGIN * 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, H);
    const tx = thumbX();
    const lens = M > 1.0001;
    const mapX = (xin) => {
      if (!lens) return xin;
      const d = xin - tx;
      const u = Math.abs(d) / R;
      if (u >= 1) return xin;
      return tx + Math.sign(d) * loupe.forward(u) * R;
    };
    const rhoAt = (xin) => {
      if (!lens) return 1;
      const u = Math.abs(xin - tx) / R;
      if (u >= 1) return 1;
      return loupe.rho(loupe.forward(u));
    };
    const lift = Math.log2(M) / K_MAX; // 0..1

    // Coarse ticks run the whole track; fine ones only inside the loupe.
    const n0 = 0;
    const n1 = Math.round(DURATION * 10);
    const win = lens ? Math.ceil((R / pps) * 10) : 0;
    const tn = Math.round(t * 10);
    const fineLo = Math.max(n0, tn - win);
    const fineHi = Math.min(n1, tn + win);

    const drawTick = (n, lvl) => {
      const L = LEVELS[lvl];
      const xin = (n / 10) * pps;
      const r = rhoAt(xin);
      // The level is chosen here, from this tick's own output spacing.
      let a = levelAlpha(lvl, ((L.n / 10) * pps) / r);
      if (a <= 0.01) return;
      const x = mapX(xin);
      // Fade anything the loupe pushes past the ends of the track.
      if (x < 0 || x > W) a *= 1 - smooth(0, MARGIN - 8, x < 0 ? -x : x - W);
      if (a <= 0.01) return;
      // The glass magnifies the marks themselves, not just their spacing:
      // under the core they grow toward H_CAP, keeping their order, and step
      // up a device pixel or two in weight; in the compressed rim they run a
      // little short, so the lens has an edge. A mark that is still finding
      // room grows out of the centre line rather than hanging there faint.
      const zoom = 1 / r;
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

    // Figures under the ruler. Minutes always; under the loupe, tens and
    // fives of seconds surface wherever the glass gives them room.
    ctx.font = labelFont;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.09px";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const label = (sec, a) => {
      const x = mapX(sec * pps);
      if (x < 0 || x > W) a *= 1 - smooth(0, MARGIN - 8, x < 0 ? -x : x - W);
      if (a <= 0.01) return;
      ctx.fillStyle = `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${a})`;
      ctx.fillText(`${Math.floor(sec / 60)}:${pad(sec % 60)}`, snap(MARGIN + x), 72);
    };
    for (let sec = 0; sec <= DURATION; sec += 5) {
      if (sec % 60 === 0) {
        label(sec, 1);
        continue;
      }
      if (!lens) continue;
      const xin = sec * pps;
      const stepS = sec % 10 === 0 ? 10 : 5;
      const room = (stepS * pps) / rhoAt(xin);
      // A figure needs its own width plus air, and must keep clear of a
      // minute figure that the glass has not reached yet.
      const near60 = Math.abs(mapX(Math.round(sec / 60) * 60 * pps) - mapX(xin));
      label(sec, smooth(45, 47, room) * smooth(41, 43, near60));
    }

    // The playhead, with a clear collar so no tick ever touches it. The
    // collar is cut out of the ticks rather than painted in paper colour, so
    // it leaves no notch in the glass beneath.
    const hx = snap(MARGIN + tx);
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
      const body = (xo) => {
        const u = Math.abs(xo - tx) / R;
        if (u >= 1) return 0;
        return clamp(-Math.log2(loupe.rho(u)) / Math.log2(M), 0, 1);
      };
      const g = ctx.createLinearGradient(MARGIN + tx - R, 0, MARGIN + tx + R, 0);
      const STOPS = 48;
      for (let i = 0; i <= STOPS; i += 1) {
        const xo = tx - R + (2 * R * i) / STOPS;
        const b = body(xo) * smooth(0, 1, lift * 2);
        g.addColorStop(i / STOPS, `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${0.055 * b})`);
      }
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = g;
      ctx.fillRect(MARGIN + tx - R, 16, 2 * R, 44);
      // Hairline rails along the top and bottom of the glass.
      const rail = ctx.createLinearGradient(MARGIN + tx - R, 0, MARGIN + tx + R, 0);
      for (let i = 0; i <= STOPS; i += 1) {
        const xo = tx - R + (2 * R * i) / STOPS;
        const b = body(xo) ** 1.5 * smooth(0, 1, lift * 2);
        rail.addColorStop(i / STOPS, `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${0.22 * b})`);
      }
      ctx.fillStyle = rail;
      const hair = 1 / dpr;
      ctx.fillRect(MARGIN + tx - R, 16, 2 * R, hair);
      ctx.fillRect(MARGIN + tx - R, 60 - hair, 2 * R, hair);
      ctx.globalCompositeOperation = "source-over";
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
