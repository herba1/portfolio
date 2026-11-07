// Weingart: a song credit set as a forme of metal type. Every line is a slug
// that moves only in whole diagonal steps, like lead pushed along a chase;
// its letterspacing is a function of the step it sits on. Slugs of the same
// ink are solid bodies: a push that would run one into its neighbour shoves
// the neighbour a step ahead, and so on down the chain, until something meets
// the chase and the whole run locks. Only the red run, printed in a second
// pass, crosses the black, and where it does the two inks make a third.
// ?t=0..1 holds a still of "Here" pushed down through the forme.
import { createStage, clamp } from "../_kit/stage";

// Design space the forme is composed in, fitted into the piece box.
const DW = 1000;
const DH = 600;
// One step in the chase: right and down, 2:1.
const SX = 24;
const SY = 12;
const K_MIN = -12;
const K_MAX = 24;
// Lead between two bodies that touch, design px.
const GAP = 8;
// Body above and below a rule's face, so it never sits on a baseline as an underline.
const RULE_LEAD = 6;

const PAPER = "#f7f6f2";
const BLACK = "#141414";
const RED = "#e3402a";
// Black printed over red: not flat multiply but a third, darker ink.
const OVER = "#561a12";

const law = (size) => -0.043 * (size - 12);

// The forme. x, y are the baseline-left (or rule top-left) at the slug's
// starting step k; tr is extra tracking per step, as a fraction of size.
const FORME = [
  { text: "The Beatles", size: 20, w: "strong", x: 4, y: 52, k: 0, tr: 0.09 },
  { text: "3:05", size: 244, w: "semibold", ink: "red", x: 476, y: 476, k: 0, tr: 0.035 },
  { text: "Here", size: 108, w: "semibold", x: 0, y: 168, k: 0, tr: 0.028 },
  { text: "Comes", size: 108, w: "semibold", x: 48, y: 264, k: 2, tr: 0.028 },
  { text: "the Sun", size: 108, w: "semibold", x: 96, y: 360, k: 4, tr: 0.028 },
  { rule: true, len: 576, thick: 12, segs: 12, x: 0, y: 392, k: 0, tr: 0.03 },
  { text: "Written by George Harrison", size: 13, w: "strong", rev: true, x: 216, y: 436, k: 3, tr: 0.035 },
  { text: "Abbey Road", size: 20, w: "strong", x: 652, y: 92, k: 0, tr: 0.09 },
  { text: "Side two, track one", size: 13, w: "body", x: 676, y: 116, k: 1, tr: 0.05 },
  { text: "Apple Records", size: 13, w: "body", x: 700, y: 136, k: 2, tr: 0.05 },
  { text: "London, 26 September 1969", size: 13, w: "body", x: 724, y: 156, k: 3, tr: 0.05 },
];

export async function createWeingart(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const params = new URLSearchParams(window.location.search);
  const stillT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const cs = getComputedStyle(document.documentElement);
  const sans = cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
  const weight = {
    semibold: cs.getPropertyValue("--font-weight-semibold").trim() || "600",
    strong: cs.getPropertyValue("--font-weight-strong").trim() || "590",
    caption: cs.getPropertyValue("--font-weight-caption").trim() || "520",
    body: cs.getPropertyValue("--font-weight-body-sm").trim() || "490",
  };
  try {
    await Promise.all(Object.values(weight).map((w) => document.fonts.load(`${w} 40px ${sans}`)));
  } catch {
    /* draw with whatever is loaded */
  }

  const slugs = FORME.map((d, i) => ({
    ...d,
    id: i,
    x0: d.x - d.k * SX,
    y0: d.y - d.k * SY,
    k: d.k,
    p: d.k,
    v: 0,
    target: d.k,
    seat: 0,
    settled: true,
    layer: d.ink === "red" ? "red" : "black",
    font: d.rule ? null : `${weight[d.w]} ${d.size}px ${sans}`,
    offs: null,
    adv: 0,
    kmin: K_MIN,
    kmax: K_MAX,
  }));

  // Prefix advances keep the font's own kerning while tracking is added per gap.
  const measure = () => {
    for (const s of slugs) {
      if (s.rule) continue;
      ctx.font = s.font;
      s.offs = [];
      for (let i = 0; i < s.text.length; i++) s.offs.push(ctx.measureText(s.text.slice(0, i)).width);
      s.adv = ctx.measureText(s.text).width;
    }
  };
  measure();

  const trackAt = (s, p) => (s.rule ? s.tr * p * s.thick : law(s.size) + s.tr * s.size * p);

  // Bounds in design space at step p.
  const bounds = (s, p) => {
    const x = s.x0 + p * SX;
    const y = s.y0 + p * SY;
    if (s.rule) {
      const seg = s.len / s.segs;
      const gap = trackAt(s, p);
      const len = Math.max(seg, s.len + gap * (s.segs - 1));
      // A rule is cast on a body deeper than its face: lead above and below.
      return { x, y: y - RULE_LEAD, w: len, h: s.thick + RULE_LEAD * 2 };
    }
    const n = s.text.length;
    const w = Math.max(s.size * 0.3, s.adv + trackAt(s, p) * (n - 1));
    if (s.rev) return { x: x - 10, y: y - 17, w: w + 20, h: 24 };
    const desc = s.desc ? s.size * 0.2 : 0;
    return { x, y: y - s.size * 0.74, w, h: s.size * 0.74 + desc };
  };

  for (const s of slugs) s.desc = !s.rule && /[gjpqy,]/.test(s.text);

  const touches = (a, b) =>
    a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

  // Plan a push of slug s to step k. Every body of the same ink that the new
  // bounds would touch is shoved ahead, one step at a time, until it clears;
  // each shoved body pushes on in turn. If anything in the chain would have to
  // leave the chase the push is refused: the run is locked up. Returns the new
  // step and chain depth of every slug that moves, or null.
  const plan = (s, k) => {
    const dir = Math.sign(k - s.k);
    if (!dir) return new Map();
    const next = new Map([[s, { k, depth: 0 }]]);
    const queue = [s];
    let guard = 0;
    while (queue.length) {
      if (++guard > 200) return null;
      const a = queue.shift();
      const pa = next.get(a);
      if (pa.k < a.kmin || pa.k > a.kmax) return null;
      const ra = bounds(a, pa.k);
      for (const o of slugs) {
        if (o === a || o.layer !== a.layer) continue;
        const ko = next.has(o) ? next.get(o).k : o.k;
        if (!touches(ra, bounds(o, ko))) continue;
        // A body behind the push can never be cleared by shoving it on.
        if (o === s) return null;
        let kn = ko;
        do {
          kn += dir;
          if (kn < o.kmin || kn > o.kmax) return null;
        } while (touches(ra, bounds(o, kn)));
        next.set(o, { k: kn, depth: Math.max(next.get(o)?.depth ?? 0, pa.depth + 1) });
        queue.push(o);
      }
    }
    return next;
  };

  // Step s toward k one step at a time; stops where the chain locks.
  // Returns how many steps it made and how long the longest chain was.
  // animate=false seats every shoved slug at once (for the still).
  const push = (s, k, animate) => {
    let steps = 0;
    let deepest = 0;
    while (s.k !== k) {
      const pl = plan(s, s.k + Math.sign(k - s.k));
      if (!pl) return { steps, deepest, locked: true };
      for (const [o, { k: ko, depth }] of pl) {
        deepest = Math.max(deepest, depth);
        o.k = ko;
        if (o === s) continue;
        o.target = ko;
        o.settled = false;
        if (!animate) o.p = ko;
      }
      steps++;
    }
    return { steps, deepest, locked: false };
  };

  // Fit the forme to the box.
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let W = 1;
  let H = 1;
  let dpr = 1;
  // A sheet for cutting the reversed slug, and one for the third ink.
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  const ovc = document.createElement("canvas");
  const ov = ovc.getContext("2d");
  let grain = null;
  let dirty = true;

  const makeGrain = () => {
    // In device pixels, so a fleck is a couple of pixels across at any DPR
    // and actually reads as ink that did not take, not as sensor noise.
    const n = 256;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d");
    const u = Math.max(1, Math.round(dpr));
    for (let i = 0; i < 900; i++) {
      const big = Math.random() < 0.12;
      g.fillStyle = `rgba(255,255,255,${big ? 0.55 + Math.random() * 0.35 : 0.18 + Math.random() * 0.22})`;
      const w = u * (big ? 1 + Math.random() * 1.6 : 0.6 + Math.random() * 0.8);
      const h = u * (big ? 0.8 + Math.random() * 1.2 : 0.6 + Math.random() * 0.6);
      g.fillRect(Math.random() * n, Math.random() * n, w, h);
    }
    return ctx.createPattern(c, "repeat");
  };

  const limits = () => {
    const m = 12 / scale;
    const lo = -ox / scale + m;
    const hi = (W - ox) / scale - m;
    const top = -oy / scale + m;
    const bot = (H - oy) / scale - m;
    for (const s of slugs) {
      let a = s.k;
      let b = s.k;
      const fits = (k) => {
        const r = bounds(s, k);
        return r.x >= lo && r.x + r.w <= hi && r.y >= top && r.y + r.h <= bot;
      };
      while (a - 1 >= K_MIN && fits(a - 1)) a--;
      while (b + 1 <= K_MAX && fits(b + 1)) b++;
      s.kmin = a;
      s.kmax = b;
    }
  };

  // Still: from the composed forme, push "Here" down the chase and let it
  // shove everything below it. t is the fraction of the way to where the
  // whole run locks against the chase; t=1 is locked solid.
  const applyStill = () => {
    const here = slugs.find((s) => s.text === "Here");
    const reset = () => {
      for (const s of slugs) s.k = s.p = s.target = FORME[s.id].k;
      limits();
    };
    reset();
    const all = push(here, K_MAX, false).steps;
    reset();
    push(here, here.k + Math.round(stillT * all), false);
    for (const s of slugs) s.p = s.target = s.k;
  };

  stage.onResize((w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    off.width = canvas.width;
    off.height = canvas.height;
    ovc.width = canvas.width;
    ovc.height = canvas.height;
    const pad = Math.max(16, Math.min(w, h) * 0.08);
    scale = Math.min((w - pad * 2) / DW, (h - pad * 2) / DH, 1.25);
    // Sit a little left of centre and a little high: an asymmetric forme.
    ox = (w - DW * scale) * 0.44;
    oy = (h - DH * scale) * 0.46;
    grain = makeGrain();
    if (stillT != null) applyStill();
    else limits();
    dirty = true;
  });


  /* ---------- sound: a small tick of lead per step, a seat on release ---------- */
  let ac = null;
  let noise = null;
  const audio = () => {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.05), ac.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.006));
    } catch {
      ac = null;
    }
  };
  const click = (freq, gain, q = 2.5) => {
    if (!ac) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noise;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq * (0.94 + Math.random() * 0.12);
    bp.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t);
  };

  /* ---------- input ---------- */
  const toDesign = (x, y) => [(x - ox) / scale, (y - oy) / scale];
  const hit = (x, y) => {
    const [dx, dy] = toDesign(x, y);
    const pad = 8 / scale;
    for (let i = slugs.length - 1; i >= 0; i--) {
      const s = slugs[i];
      const r = bounds(s, s.p);
      const py = s.rule ? Math.max(pad, 10 / scale) : pad;
      if (dx >= r.x - pad && dx <= r.x + r.w + pad && dy >= r.y - py && dy <= r.y + r.h + py) return s;
    }
    return null;
  };

  const DIR = [SX / Math.hypot(SX, SY), SY / Math.hypot(SX, SY)];
  const STEP = Math.hypot(SX, SY);
  let held = null;
  let grab = null;

  stage.on("down", (p) => {
    const s = hit(p.x, p.y);
    if (!s) return;
    audio();
    ac?.resume?.();
    held = s;
    // Picked slug goes to the top of the forme.
    slugs.splice(slugs.indexOf(s), 1);
    slugs.push(s);
    grab = { x: p.x, y: p.y, k: s.k, r: s.k };
    s.settled = false;
    s.lockedAt = false;
    canvas.style.cursor = "grabbing";
  });

  stage.on("move", (p) => {
    if (!held) {
      canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
      return;
    }
    const dx = (p.x - grab.x) / scale;
    const dy = (p.y - grab.y) / scale;
    const r = grab.k + (dx * DIR[0] + dy * DIR[1]) / STEP;
    const want = clamp(Math.round(r), held.kmin, held.kmax);
    let locked = want !== Math.round(r);
    if (want !== held.k) {
      const from = held.k;
      const res = push(held, want, true);
      locked = locked || res.locked;
      // Several steps in one move still tick once each; a shoved run knocks
      // lower and longer, one knock per link of the chain.
      const n = Math.min(4, Math.abs(held.k - from));
      for (let i = 0; i < n; i++) setTimeout(() => click(3400, 0.05), i * 18);
      for (let i = 1; i <= Math.min(5, res.deepest); i++) setTimeout(() => click(2100 - i * 160, 0.045), i * 45);
      if (res.locked && !held.lockedAt) click(700, 0.12, 1.2);
    }
    held.lockedAt = locked;
    // A little of the remaining pull shows, like lead resisting the next step;
    // against a locked run it barely gives.
    const rest = clamp(r - held.k, -0.5, 0.5);
    held.target = held.k + rest * 0.16 * (locked ? 0.25 : 1);
  });

  stage.on("up", () => {
    if (!held) return;
    held.target = held.k;
    held.settled = false;
    held = null;
    canvas.style.cursor = "grab";
  });

  /* ---------- draw ---------- */
  const drawSlug = (g, s, inkStyle) => {
    const x = s.x0 + s.p * SX;
    const y = s.y0 + s.p * SY;
    g.fillStyle = inkStyle;
    if (s.rule) {
      const seg = s.len / s.segs;
      const gap = trackAt(s, s.p);
      // Seated tight the segments read as one rule; no seams from overlapping edges.
      if (Math.abs(gap) < 0.04) g.fillRect(x, y, s.len, s.thick);
      else for (let i = 0; i < s.segs; i++) g.fillRect(x + i * (seg + gap), y, seg, s.thick);
      return;
    }
    g.font = s.font;
    g.textBaseline = "alphabetic";
    const t = trackAt(s, s.p);
    for (let i = 0; i < s.text.length; i++) {
      const ch = s.text[i];
      if (ch !== " ") g.fillText(ch, x + s.offs[i] + i * t, y);
    }
  };

  // A design-space rect as a whole-pixel device rect, clipped to the canvas.
  const devRect = (r, pad) => {
    const x0 = Math.max(0, Math.floor((ox + (r.x - pad) * scale) * dpr));
    const y0 = Math.max(0, Math.floor((oy + (r.y - pad) * scale) * dpr));
    const x1 = Math.min(canvas.width, Math.ceil((ox + (r.x + r.w + pad) * scale) * dpr));
    const y1 = Math.min(canvas.height, Math.ceil((oy + (r.y + r.h + pad) * scale) * dpr));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  const toForme = (g) => g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  const density = (s) => Math.min(1, (s.layer === "red" ? 0.93 : 0.95) + s.seat * 0.05);

  // The reversed slug is solid ink with its letters cut out. drawRev paints
  // it into g as is; on the paper it is cut on its own sheet first, so the
  // knockout shows whatever is printed under it.
  const drawRev = (g, s) => {
    const r = bounds(s, s.p);
    g.fillStyle = BLACK;
    g.fillRect(r.x, r.y, r.w, r.h);
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "destination-out";
    drawSlug(g, s, "#000");
    g.globalCompositeOperation = op;
  };

  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Red run first, then black over it; inks multiply into the paper.
    ctx.globalCompositeOperation = "multiply";
    for (const layer of ["red", "black"]) {
      for (const s of slugs) {
        if (s.layer !== layer) continue;
        ctx.globalAlpha = density(s);
        if (!s.rev) {
          toForme(ctx);
          drawSlug(ctx, s, layer === "red" ? RED : BLACK);
          continue;
        }
        const d = devRect(bounds(s, s.p), 4);
        if (!d.w || !d.h) continue;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = "source-over";
        octx.clearRect(d.x, d.y, d.w, d.h);
        toForme(octx);
        drawRev(octx, s);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      }
    }

    // Where black lands on red the two inks make a third. Inside each red
    // slug's box: the black coverage, kept only where red is printed, then
    // filled with the dark ink and laid over the top.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    for (const red of slugs) {
      if (red.layer !== "red") continue;
      const rb = bounds(red, red.p);
      const d = devRect(rb, red.size ? red.size * 0.12 : 4);
      if (!d.w || !d.h) continue;
      ov.setTransform(1, 0, 0, 1, 0, 0);
      ov.globalCompositeOperation = "source-over";
      ov.globalAlpha = 1;
      ov.clearRect(d.x, d.y, d.w, d.h);
      ov.save();
      ov.beginPath();
      ov.rect(d.x, d.y, d.w, d.h);
      ov.clip();
      toForme(ov);
      let any = false;
      for (const s of slugs) {
        if (s.layer !== "black" || !touches(rb, bounds(s, s.p))) continue;
        any = true;
        ov.globalAlpha = density(s);
        if (s.rev) drawRev(ov, s);
        else drawSlug(ov, s, BLACK);
      }
      ov.restore();
      if (any) {
        // The red coverage as one image, so a single destination-in keeps
        // exactly the black that sits on red (per-glyph draws would not).
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = "source-over";
        octx.globalAlpha = 1;
        octx.clearRect(d.x, d.y, d.w, d.h);
        toForme(octx);
        octx.globalAlpha = density(red);
        drawSlug(octx, red, RED);
        octx.globalAlpha = 1;
        ov.setTransform(1, 0, 0, 1, 0, 0);
        ov.globalAlpha = 1;
        ov.globalCompositeOperation = "destination-in";
        ov.drawImage(off, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
        ov.globalCompositeOperation = "source-in";
        ov.fillStyle = OVER;
        ov.fillRect(d.x, d.y, d.w, d.h);
        ov.globalCompositeOperation = "source-over";
      }
      if (any) ctx.drawImage(ovc, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
    }

    // Ink that did not quite take: pale flecks over the printed areas only.
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  let now = 0;
  let lastSeat = -1;
  stage.onFrame((dt) => {
    now += dt;
    let active = dirty;
    dirty = false;
    if (stillT == null) {
      for (const s of slugs) {
        if (s.settled && s.seat <= 0) continue;
        active = true;
        // Stiff and critically damped while held; a touch stiffer to seat.
        // Shoved slugs are stiffer than the hand, so they stay just ahead of
        // the slug pushing them instead of being passed through in transit.
        const K = s === held ? 900 : 1500;
        const C = 2 * Math.sqrt(K) * (s === held ? 0.82 : 1);
        const sub = 3;
        const h = dt / sub;
        for (let i = 0; i < sub; i++) {
          s.v += (-K * (s.p - s.target) - C * s.v) * h;
          s.p += s.v * h;
        }
        s.seat = Math.max(0, s.seat - dt * 4);
        if (s !== held && !s.settled && Math.abs(s.p - s.target) < 0.01 && Math.abs(s.v) < 0.2) {
          s.p = s.target;
          s.v = 0;
          s.settled = true;
          s.seat = 1;
          // A shoved run seats as a short patter, not one stacked knock.
          if (now - lastSeat > 0.03) click(1300, 0.09, 1.4);
          lastSeat = now;
        }
      }
    }
    // Nothing moving: leave the last frame on the canvas.
    if (active) draw();
  });

  return {
    destroy() {
      stage.destroy();
      try {
        ac?.close();
      } catch {
        /* closed */
      }
    },
  };
}
