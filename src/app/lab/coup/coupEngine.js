// Coup de dés: Mallarmé's lines as bodies on critically damped springs.
// A sweep across the spread is the throw. Each throw composes a new
// constellation under fixed rules: the four great capitals step down the
// spread on the diagonal, the minor lines cluster around them, aligned to
// each other's edges, and only the capitals may cross the gutter.
//
// ?t=0.4 freezes the scene that many seconds after a scripted throw.
// ?seed=n picks the constellation.

// Mallarmé breaks his phrases into cascades: a thread of one size and cut,
// each line starting where the last one stopped ("stair") or hanging under
// it ("flush"). The minor lines move as these threads.
const BLOCKS = [
  { tier: 0, lines: ["UN COUP DE DÉS"] },
  { tier: 0, lines: ["JAMAIS"] },
  { tier: 0, lines: ["N’ABOLIRA"] },
  { tier: 0, lines: ["LE HASARD"] },
  { tier: 1, lines: ["RIEN", "N’AURA EU LIEU", "QUE LE LIEU"] },
  { tier: 1, lines: ["EXCEPTÉ", "PEUT-ÊTRE", "UNE CONSTELLATION"] },
  { tier: 1, lines: ["COMME SI"] },
  { tier: 1, lines: ["DU FOND D’UN NAUFRAGE"] },
  { tier: 2, lines: ["soit", "que", "l’Abîme", "blanchi", "étale", "furieux"] },
  { tier: 2, lines: ["une insinuation simple", "au silence enroulée avec ironie"] },
  { tier: 2, lines: ["Toute Pensée émet un Coup de Dés"] },
];
const LINES = BLOCKS.flatMap((b, bi) => b.lines.map((text, li) => ({ text, tier: b.tier, block: bi, line: li })));

const TIER1_SIZES = [20, 24, 28];
const TIER2_SIZES = [13, 14, 16, 18];

// The house tracking law, applied to whatever size a line is at this frame.
const lawPx = (size) => -0.043 * (size - 12);
const tracking = (size) => (size < 20 ? `${lawPx(size).toFixed(3)}px` : `${(lawPx(size) / size).toFixed(4)}em`);
const lineHeight = (size) => Math.max(4, Math.round((size * 1.08) / 4) * 4);
const snap4 = (v) => Math.round(v / 4) * 4;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createCoup(host, { embedded = false } = {}) {
  const box = host.closest(".piece-box") || host;
  const params = new URLSearchParams(window.location.search);
  const freezeT = params.has("t") ? Math.max(0, parseFloat(params.get("t")) || 0) : null;
  const baseSeed = parseInt(params.get("seed") || "7", 10) || 7;
  let seed = baseSeed;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gutter = document.createElement("div");
  gutter.className = "coup-gutter";
  host.appendChild(gutter);

  const measurer = document.createElement("span");
  measurer.className = "coup-line coup-measure";
  measurer.setAttribute("aria-hidden", "true");
  host.appendChild(measurer);

  const items = LINES.map((line, i) => {
    const el = document.createElement("p");
    el.className = "coup-line";
    el.dataset.tier = String(line.tier);
    el.textContent = line.text;
    host.appendChild(el);
    return {
      ...line,
      i,
      el,
      x: 0, y: 0, s: 16, r: 0,
      vx: 0, vy: 0, vs: 0, vr: 0,
      tx: 0, ty: 0, ts: 16,
      next: null,
      at: 0,
      k: 120,
      mass: line.tier === 0 ? 0.42 : line.tier === 1 ? 0.75 : 1,
      shown: -1,
      shownW: -1,
      shownZ: -1,
    };
  });

  // Make sure every cut is loaded before anything is measured.
  try {
    const family = getComputedStyle(host).fontFamily;
    await Promise.all([
      document.fonts.load(`700 80px ${family}`, "UN COUP DE DÉS"),
      document.fonts.load(`600 24px ${family}`, "COMME SI"),
      document.fonts.load(`440 16px ${family}`, "soit"),
      document.fonts.load(`490 13px ${family}`, "soit"),
    ]);
    await document.fonts.ready;
  } catch {
    /* measure with whatever is there */
  }

  // Weight is the line's state: a line in flight thins to the meta cut and
  // fills back in as it lands, so lines passing one another read as passing.
  const tok = getComputedStyle(host);
  const wt = (name, fb) => parseFloat(tok.getPropertyValue(name)) || fb;
  const REST_W = [wt("--font-weight-bold", 700), wt("--font-weight-semibold", 600)];
  const FLIGHT_W = wt("--font-weight-meta", 440);

  const widths = new Map();
  const measure = (item, size) => {
    const key = `${item.i}|${size}`;
    let wv = widths.get(key);
    if (wv == null) {
      measurer.dataset.tier = String(item.tier);
      if (item.tier === 2 && size <= 13) measurer.dataset.small = "";
      else delete measurer.dataset.small;
      measurer.style.fontSize = `${size}px`;
      measurer.style.letterSpacing = tracking(size);
      measurer.textContent = item.text;
      wv = measurer.getBoundingClientRect().width;
      widths.set(key, wv);
    }
    return wv;
  };

  let W = 1;
  let H = 1;
  let u = 1;
  let spread = true;

  // ---- composition -------------------------------------------------------

  // Minimum clear space between any two settled boxes, capitals included.
  const GAP_X = () => Math.max(16, 24 * u);
  const GAP_Y = () => Math.max(8, 12 * u);

  // The capitals take a new diagonal on every throw: their own sizes, their
  // own stride, still stepping down the spread from left to right.
  // The diagonal the capitals sit on now; a new throw must move them.
  let lastBig = null;
  const bigDistance = (a, b) => a.reduce((sum, p, j) => sum + Math.hypot(p.x - b[j].x, p.y - b[j].y) + Math.abs(p.s - b[j].s) * 4, 0) / a.length;

  function composeBig(rng, mX, mY) {
    let best = null;
    for (let n = 0; n < 16; n++) {
      const cand = composeBigOnce(rng, mX, mY);
      if (!lastBig) return cand;
      const d = bigDistance(cand, lastBig);
      if (!best || d > best.d) best = { cand, d };
      if (d > Math.max(W, H) * 0.16) break;
    }
    return best.cand;
  }

  function composeBigOnce(rng, mX, mY) {
    const big = items.filter((it) => it.tier === 0);
    let base = Math.round(Math.min(84 * u, H * 0.11));
    const room = W * (spread ? 0.5 : 0.86);
    const sizes = big.map(() => 0.5 + rng() * 0.5);
    // one of them always carries the full weight of the page
    sizes[Math.floor(rng() * 4)] = 1;
    let px = sizes.map((f, j) => {
      let s = Math.round(base * f);
      const w = measure(big[j], s);
      if (w > room) s = Math.floor((s * room) / w);
      return Math.max(20, s);
    });
    // fit the four rows plus breathing room into the page height
    const avail = H - mY * 2;
    let hs = px.map(lineHeight);
    const minGap = GAP_Y() * 2;
    while (hs.reduce((a, b) => a + b, 0) + minGap * 3 > avail * 0.86 && px.some((s) => s > 20)) {
      px = px.map((s) => Math.max(20, s - 2));
      hs = px.map(lineHeight);
    }
    const free = avail - hs.reduce((a, b) => a + b, 0) - minGap * 3;
    // top margin, three gaps, bottom margin, each a random share of the slack
    const wts = [0.2 + rng() * 0.8, 0.4 + rng() * 1.6, 0.4 + rng() * 1.6, 0.4 + rng() * 1.6, 0.2 + rng() * 0.8];
    const sum = wts.reduce((a, b) => a + b, 0);
    let y = mY + (free * wts[0]) / sum;
    const ys = [];
    for (let j = 0; j < 4; j++) {
      ys.push(snap4(y));
      y = snap4(y) + hs[j] + minGap + (j < 3 ? (free * wts[j + 1]) / sum : 0);
    }
    const ws = px.map((s, j) => measure(big[j], s));
    // stride: a start and an end on the diagonal, with uneven steps between
    const x0 = mX + rng() * W * 0.2;
    const xEnd = W - mX - ws[3] - rng() * W * 0.12;
    const steps = [0.3 + rng(), 0.3 + rng(), 0.3 + rng()];
    const stepSum = steps.reduce((a, b) => a + b, 0);
    let acc = 0;
    const out = [];
    let prevX = -Infinity;
    big.forEach((it, j) => {
      if (j > 0) acc += steps[j - 1] / stepSum;
      let x = x0 + (Math.max(x0, xEnd) - x0) * acc;
      x = Math.max(prevX + W * 0.04, x);
      x = Math.min(x, W - mX - ws[j]);
      x = Math.max(mX, x);
      prevX = x;
      out.push({ it, x: Math.round(x), y: ys[j], s: px[j], w: ws[j], h: hs[j] });
    });
    return out;
  }

  function composeOnce(rng) {
    const mX = Math.round(W * 0.065);
    const mY = snap4(H * 0.09);
    const out = new Array(items.length);
    const rects = [];

    for (const b of composeBig(rng, mX, mY)) {
      out[b.it.i] = { x: b.x, y: b.y, s: b.s };
      rects.push({ x: b.x, y: b.y, w: b.w, h: b.h, big: true });
    }

    // The threads, larger first, each placed near something already set.
    const blocks = BLOCKS.map((b, bi) => ({ ...b, bi, items: items.filter((it) => it.block === bi) })).filter((b) => b.tier !== 0);
    for (let j = blocks.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [blocks[j], blocks[k]] = [blocks[k], blocks[j]];
    }
    blocks.sort((a, b) => a.tier - b.tier);

    const gutterPad = 20 * u;
    const cols = 14;
    const scale = Math.min(1, Math.max(0.7, u));
    let failed = 0;
    for (const blk of blocks) {
      const sizes = blk.tier === 1 ? TIER1_SIZES : TIER2_SIZES;
      const size = Math.max(10, Math.round(sizes[Math.floor(rng() * sizes.length)] * scale));
      const h = lineHeight(size);
      const many = blk.items.length > 1;
      const prefersStair = many && (blk.items.length > 3 || rng() < 0.6);
      let best = null;
      let rel = [];
      // if the thread will not fit as drawn, hang it flush, then loosen the
      // spacing, but never below the hard clearance
      for (const [stair, loose] of [[prefersStair, 1], [false, 1], [false, 0.6], [false, 0]]) {
        const pitch = stair ? h + snap4(h * 0.5) : h;
        const space = size * 0.32;
        rel = [];
        let rx = 0;
        let bw = 0;
        blk.items.forEach((it, n) => {
          const w = measure(it, size);
          rel.push({ dx: rx, dy: n * pitch, w });
          bw = Math.max(bw, rx + w);
          if (stair) rx += w + space;
        });
        const bh = (blk.items.length - 1) * pitch + h;
        const padY = Math.max(GAP_Y(), Math.max(16, h) * loose);
        const padX = Math.max(GAP_X(), 32 * u * loose);
        const want = (16 + rng() * 110) * u;
        let bestScore = Infinity;
        for (let n = 0; n < 320; n++) {
          let x;
          const pick = rng();
          const anchor = rects[Math.floor(rng() * rects.length)];
          if (pick < 0.4) x = anchor.x;
          else if (pick < 0.6) x = anchor.x + anchor.w + padX * (1 + rng());
          else if (pick < 0.7) x = anchor.x + anchor.w - bw;
          else x = mX + Math.floor(rng() * cols) * ((W - mX * 2) / cols);
          x = Math.round(x);
          const y = snap4(mY * 0.6 + rng() * (H - mY * 1.2 - bh));
          if (x < mX * 0.6 || x + bw > W - mX * 0.6) continue;
          // only the capitals may cross the fold; a thread stays on its page
          if (spread && x < W / 2 + gutterPad && x + bw > W / 2 - gutterPad) continue;
          let ok = true;
          let near = Infinity;
          for (const r of rects) {
            const dx = Math.max(r.x - (x + bw), x - (r.x + r.w), 0);
            const dy = Math.max(r.y - (y + bh), y - (r.y + r.h), 0);
            if (dx < padX && dy < padY) {
              ok = false;
              break;
            }
            near = Math.min(near, Math.hypot(dx, dy));
          }
          if (!ok) continue;
          const score = Math.abs(near - want) + rng() * 10;
          if (score < bestScore) {
            bestScore = score;
            best = { x, y, bw, bh };
          }
        }
        if (best) break;
      }
      if (!best) failed += 1;
      blk.items.forEach((it, n) => {
        if (!best) out[it.i] = { x: -9999, y: snap4(H * 0.5), s: size, hidden: true };
        else out[it.i] = { x: Math.round(best.x + rel[n].dx), y: best.y + rel[n].dy, s: size };
      });
      if (best) rects.push({ x: best.x, y: best.y, w: best.bw, h: best.bh });
    }
    return { out, failed };
  }

  function remember(out) {
    lastBig = items.filter((it) => it.tier === 0).map((it) => out[it.i]);
    return out;
  }

  // A throw that cannot seat every line is thrown again from the same seed,
  // so the poem is always whole and nothing ever lands on anything.
  function compose(rng) {
    let fallback = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const { out, failed } = composeOnce(rng);
      if (!failed) return remember(out);
      if (!fallback || failed < fallback.failed) fallback = { out, failed };
    }
    return remember(fallback.out);
  }

  function place(layout) {
    for (const it of items) {
      const t = layout[it.i];
      it.tx = it.x = t.x;
      it.ty = it.y = t.y;
      it.ts = it.s = t.s;
      it.vx = it.vy = it.vs = it.vr = it.r = 0;
      it.next = null;
      it.hidden = !!t.hidden;
    }
  }

  // ---- motion -----------------------------------------------------------

  let rngMotion = mulberry32(seed * 7919 + 3);
  let clock = 0;

  function toss(dirX, dirY, power) {
    seed += 1;
    const layout = compose(mulberry32(seed));
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    // The capitals tumble one after another, in reading order; the threads
    // let go once the first capital is on its way, each line of a thread a
    // beat behind the one above it, so a cascade lands as a cascade.
    const blockAt = BLOCKS.map(() => 0.22 + rngMotion() * 0.36);
    for (const it of items) {
      const rnd = rngMotion;
      const t = layout[it.i];
      it.next = t;
      if (it.tier === 0) {
        const j = it.block;
        it.at = clock + 0.04 + j * 0.15;
        it.k = 44 + j * 4 + rnd() * 6;
      } else {
        it.at = clock + blockAt[it.block] + it.line * 0.05;
        it.k = 72 + rnd() * 48;
      }
      const sp = power * (0.55 + rnd() * 0.9) * it.mass;
      const side = (rnd() - 0.5) * 0.9;
      it.vx += (nx - ny * side) * sp;
      it.vy += (ny + nx * side) * sp;
      // a capital turns over as it falls; small lines only rock
      const spin = it.tier === 0 ? (rnd() < 0.5 ? -1 : 1) * (22 + rnd() * 18) : (rnd() - 0.5) * 70 * it.mass;
      it.vr += spin;
    }
    wake();
  }

  function step(dt) {
    clock += dt;
    let moving = false;
    for (const it of items) {
      if (it.next && clock >= it.at) {
        const t = it.next;
        it.tx = t.x;
        it.ty = t.y;
        it.ts = t.s;
        if (it.hidden && !t.hidden) {
          it.x = t.x;
          it.y = t.y;
          it.s = t.s;
        }
        it.hidden = !!t.hidden;
        it.next = null;
      }
      const k = it.k;
      const c = 2 * Math.sqrt(k); // critically damped: no overshoot
      it.vx += (-k * (it.x - it.tx) - c * it.vx) * dt;
      it.vy += (-k * (it.y - it.ty) - c * it.vy) * dt;
      it.vs += (-k * (it.s - it.ts) - c * it.vs) * dt;
      const kr = k * 1.6;
      // a capital leans into its flight and rights itself as it arrives
      const rT = it.tier === 0 ? Math.max(-6, Math.min(6, ((it.x - it.tx) / W) * 14 + ((it.ty - it.y) / H) * 4)) : 0;
      it.vr += (-kr * (it.r - rT) - 2 * Math.sqrt(kr) * it.vr) * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.s += it.vs * dt;
      it.r += it.vr * dt;
      const off = Math.abs(it.x - it.tx) + Math.abs(it.y - it.ty) + Math.abs(it.s - it.ts) * 4 + Math.abs(it.r) * 20;
      const vel = Math.abs(it.vx) + Math.abs(it.vy) + Math.abs(it.vs) + Math.abs(it.vr);
      if (it.next || off > 0.08 || vel > 0.5) moving = true;
      else {
        it.x = it.tx;
        it.y = it.ty;
        it.s = it.ts;
        it.r = 0;
        it.vx = it.vy = it.vs = it.vr = 0;
      }
    }
    return moving;
  }

  function render() {
    for (const it of items) {
      const el = it.el;
      if (it.hidden) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "";
      const s = Math.max(6, it.s);
      if (Math.abs(s - it.shown) > 0.01) {
        it.shown = s;
        el.style.fontSize = `${s.toFixed(2)}px`;
        el.style.letterSpacing = tracking(s);
        el.style.lineHeight = `${lineHeight(s)}px`;
        if (it.tier === 2 && s <= 13.5) el.dataset.small = "";
        else delete el.dataset.small;
      }
      const d = Math.hypot(it.x - it.tx, it.y - it.ty) + Math.abs(it.s - it.ts) * 3;
      const v = Math.hypot(it.vx, it.vy);
      let f = Math.min(1, Math.max(d / (110 * Math.max(0.6, u)), v / (520 * Math.max(0.6, u))));
      f = f * f * (3 - 2 * f);
      if (it.tier < 2) {
        const w = Math.round(REST_W[it.tier] - (REST_W[it.tier] - FLIGHT_W) * f);
        if (w !== it.shownW) {
          it.shownW = w;
          el.style.fontWeight = w === REST_W[it.tier] ? "" : String(w);
        }
      }
      // landed lines sit above lines still travelling, and a halo of ground
      // around every letter makes a crossing read as one line passing under
      // another rather than two lines printed on top of each other
      const z = (f < 0.08 ? 4 : 1) + (it.tier === 0 ? 1 : 0);
      if (z !== it.shownZ) {
        it.shownZ = z;
        el.style.zIndex = String(z);
      }
      const lim = it.tier === 0 ? 7 : 2.2;
      const r = Math.max(-lim, Math.min(lim, it.r));
      el.style.transform = `translate3d(${it.x.toFixed(2)}px, ${it.y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg)`;
    }
  }

  let raf = 0;
  let last = 0;
  let destroyed = false;
  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    // fixed substeps keep the springs stable at any frame rate
    const n = Math.ceil(dt / (1 / 240));
    let moving = false;
    for (let i = 0; i < n; i++) moving = step(dt / n) || moving;
    render();
    if (moving) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (freezeT != null || destroyed) return;
    if (reduced) {
      for (const it of items) if (it.next) it.at = clock;
      step(0);
      for (const it of items) {
        it.x = it.tx; it.y = it.ty; it.s = it.ts; it.r = 0;
        it.vx = it.vy = it.vs = it.vr = 0;
      }
      render();
      return;
    }
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // ---- input -----------------------------------------------------------

  let px = null;
  let py = null;
  let lastT = 0;
  let travel = 0;
  let sumX = 0;
  let sumY = 0;
  let downAt = null;
  let speed = 0;

  const local = (e) => {
    const r = host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onMove = (e) => {
    if (freezeT != null) return;
    const [x, y] = local(e);
    const now = performance.now();
    if (px == null || now - lastT > 220) {
      // a new gesture
      px = x;
      py = y;
      lastT = now;
      travel = 0;
      sumX = sumY = 0;
      return;
    }
    const dx = x - px;
    const dy = y - py;
    const dtm = Math.max(1, now - lastT);
    speed += (Math.hypot(dx, dy) / dtm * 1000 - speed) * Math.min(1, dtm / 50);
    px = x;
    py = y;
    lastT = now;
    travel += Math.hypot(dx, dy);
    sumX += dx;
    sumY += dy;

    // the hand passing over the lines jostles them
    const sigma = Math.max(W, H) * 0.2;
    const gain = Math.min(1, speed / 1400) * 9;
    let touched = false;
    for (const it of items) {
      if (it.hidden) continue;
      const w = measure(it, Math.round(it.ts));
      const cx = it.x + w / 2;
      const cy = it.y + lineHeight(it.s) / 2;
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      const f = Math.exp(-d2 / (2 * sigma * sigma));
      if (f < 0.02) continue;
      it.vx += dx * gain * f * it.mass;
      it.vy += dy * gain * f * it.mass;
      it.vr += ((x - cx) * dy - (y - cy) * dx) / (w + 40) * 0.6 * f * it.mass * Math.min(1, speed / 900);
      touched = true;
    }
    if (touched) wake();

    // enough of a sweep is a throw; a long sweep throws again
    const need = W * (downAt ? 0.1 : 0.16);
    if (travel > need && speed > 500) {
      travel = -W * 0.35;
      toss(sumX, sumY, Math.min(900, speed * 0.55) * Math.max(0.6, u));
      sumX = sumY = 0;
    }
  };

  const onDown = (e) => {
    if (freezeT != null) return;
    const [x, y] = local(e);
    downAt = { x, y, t: performance.now() };
    host.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e) => {
    if (freezeT != null || !downAt) return;
    const [x, y] = local(e);
    const moved = Math.hypot(x - downAt.x, y - downAt.y);
    if (moved < 6 && performance.now() - downAt.t < 400) {
      // a tap is a throw from where you tapped, outward
      toss(W / 2 - x || 1, H / 2 - y || 1, 420 * Math.max(0.6, u));
    }
    downAt = null;
  };

  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);

  // ---- size ------------------------------------------------------------

  let sized = false;
  const resize = () => {
    const r = box.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    spread = W / H > 1.05 && W > 640;
    u = spread ? Math.min(W / 1280, H / 800) : Math.min(1, W / 600, H / 800);
    gutter.style.display = spread ? "" : "none";
    widths.clear();
    for (const it of items) it.shown = -1;
    if (freezeT != null) seed = baseSeed;
    lastBig = null;
    place(compose(mulberry32(seed)));
    if (freezeT != null) {
      rngMotion = mulberry32(seed * 7919 + 3);
      clock = 0;
      toss(1, 0.35, 760 * Math.max(0.6, u));
      const dt = 1 / 240;
      for (let t = 0; t < freezeT; t += dt) step(dt);
    }
    render();
    if (freezeT != null) window.__coupOverlaps = overlaps(0, 0);
    sized = true;
  };

  // Every pair of visible line boxes, read back from the DOM, closer than
  // the given clearance. Used by ?audit and by the frozen still.
  function overlaps(mx, my) {
    const hr = host.getBoundingClientRect();
    const boxes = items
      .filter((it) => !it.hidden)
      .map((it) => {
        const r = it.el.getBoundingClientRect();
        return { t: it.text, blk: it.block, x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
      });
    const hits = [];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const gx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));
        const gy = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
        // lines of one thread are set solid against each other; they may
        // touch but never overlap
        const same = A.blk === B.blk;
        if (same ? gx < -0.5 && gy < -0.5 : gx < mx && gy < my) hits.push(`${A.t} × ${B.t}`);
      }
    }
    return { hits, boxes };
  }


  const ro = new ResizeObserver(resize);
  ro.observe(box);
  resize();
  if (params.has("audit")) {
    const n = parseInt(params.get("audit"), 10) || 50;
    const report = [];
    for (let k = 0; k < n; k++) {
      const before = lastBig;
      place(compose(mulberry32(baseSeed + k)));
      const moved = before ? Math.round(bigDistance(lastBig, before)) : 0;
      render();
      const { hits, boxes } = overlaps(12, 8);
      const out = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H).map((b) => b.t);
      const big = items.filter((it) => it.tier === 0).map((it) => [Math.round(it.x), Math.round(it.y), Math.round(it.s)]);
      report.push({ seed: baseSeed + k, hits, out, hidden: items.filter((it) => it.hidden).length, big, moved });
    }
    window.__coupAudit = report;
  }
  void sized;
  void embedded;

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.replaceChildren();
    },
  };
}
