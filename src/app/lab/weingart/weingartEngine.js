// Weingart: a song credit set as a forme of metal type. Every line is a slug
// that moves only in whole diagonal steps, like lead pushed along a chase;
// its letterspacing is a function of the step it sits on. Inks multiply, so
// lines overprint where they cross. ?t=0..1 holds a mid-push still.
import { createStage, clamp } from "../_kit/stage";

// Design space the forme is composed in, fitted into the piece box.
const DW = 1000;
const DH = 600;
// One step in the chase: right and down, 2:1.
const SX = 24;
const SY = 12;
const K_MIN = -6;
const K_MAX = 9;

const PAPER = "#f7f6f2";
const BLACK = "#141414";
const RED = "#e3402a";

const law = (size) => -0.043 * (size - 12);

// The forme. x, y are the baseline-left (or rule top-left) at the slug's
// starting step k; tr is extra tracking per step, as a fraction of size.
const FORME = [
  { text: "The Beatles", size: 20, w: "strong", x: 4, y: 52, k: 0, tr: 0.09 },
  { text: "3:05", size: 244, w: "semibold", ink: "red", x: 476, y: 476, k: 0, tr: 0.035 },
  { text: "Here", size: 108, w: "semibold", x: 0, y: 168, k: 0, tr: 0.045 },
  { text: "Comes", size: 108, w: "semibold", x: 48, y: 264, k: 2, tr: 0.045 },
  { text: "the Sun", size: 108, w: "semibold", x: 96, y: 360, k: 4, tr: 0.045 },
  { rule: true, len: 576, thick: 12, segs: 12, x: 0, y: 392, k: 0, tr: 0.5 },
  { text: "Written by George Harrison", size: 13, w: "strong", rev: true, x: 216, y: 436, k: 3, tr: 0.12 },
  { text: "Abbey Road", size: 20, w: "strong", x: 652, y: 92, k: 0, tr: 0.09 },
  { text: "Side two, track one", size: 13, w: "body", x: 676, y: 116, k: 1, tr: 0.12 },
  { text: "Apple Records", size: 13, w: "body", x: 700, y: 136, k: 2, tr: 0.12 },
  { text: "London, 26 September 1969", size: 13, w: "body", x: 724, y: 156, k: 3, tr: 0.12 },
  { rule: true, len: 1000, thick: 2, segs: 25, x: 0, y: 512, k: 0, tr: 0.4 },
  { text: "Harrisongs Ltd.", size: 11, w: "caption", x: 0, y: 548, k: 0, tr: 0.14 },
  { text: "Recorded at EMI Studios, Abbey Road", size: 11, w: "caption", x: 480, y: 548, k: 0, tr: 0.14 },
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
      return { x, y, w: len, h: s.thick };
    }
    const n = s.text.length;
    const w = Math.max(s.size * 0.3, s.adv + trackAt(s, p) * (n - 1));
    if (s.rev) return { x: x - 10, y: y - 17, w: w + 20, h: 24 };
    return { x, y: y - s.size * 0.74, w, h: s.size * 0.74 };
  };

  // Fit the forme to the box.
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let W = 1;
  let H = 1;
  let dpr = 1;
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  let grain = null;
  let dirty = true;

  const makeGrain = () => {
    const n = 192;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d");
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const r = Math.random();
      // Sparse pale flecks: ink that did not take on the paper.
      const a = r > 0.986 ? 150 + Math.random() * 100 : r > 0.93 ? 40 + Math.random() * 40 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
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

  stage.onResize((w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    off.width = canvas.width;
    off.height = canvas.height;
    const pad = Math.max(16, Math.min(w, h) * 0.08);
    scale = Math.min((w - pad * 2) / DW, (h - pad * 2) / DH, 1.25);
    // Sit a little left of centre and a little high: an asymmetric forme.
    ox = (w - DW * scale) * 0.44;
    oy = (h - DH * scale) * 0.46;
    grain = makeGrain();
    limits();
    dirty = true;
  });

  // Still: hold "the Sun" mid-push between two steps, letters opening.
  if (stillT != null) {
    const sun = slugs[4];
    sun.p = sun.target = 4 + stillT * 2.6;
    sun.k = Math.round(sun.p);
    const here = slugs[2];
    here.p = here.target = 2 + stillT * 6;
    here.k = Math.round(here.p);
    const by = slugs[6];
    by.p = by.target = by.k = 5;
  }

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
    const k = clamp(Math.round(r), held.kmin, held.kmax);
    if (k !== held.k) {
      // Several steps in one move still tick once each.
      const n = Math.min(4, Math.abs(k - held.k));
      for (let i = 0; i < n; i++) setTimeout(() => click(3400, 0.05), i * 18);
      held.k = k;
    }
    // A little of the remaining pull shows, like lead resisting the next step.
    const rest = clamp(r - k, -0.5, 0.5);
    held.target = k + rest * 0.16 * (r < held.kmin - 0.5 || r > held.kmax + 0.5 ? 0.3 : 1);
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

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.globalCompositeOperation = "multiply";
    for (const s of slugs) {
      const density = (s.ink === "red" ? 0.92 : 0.95) + s.seat * 0.05;
      ctx.globalAlpha = Math.min(1, density);
      if (s.rev) {
        // A reversed slug: solid ink with the letters left as bare paper.
        const r = bounds(s, s.p);
        octx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
        octx.globalCompositeOperation = "source-over";
        octx.clearRect(-ox / scale, -oy / scale, W / scale, H / scale);
        octx.fillStyle = BLACK;
        octx.fillRect(r.x, r.y, r.w, r.h);
        octx.globalCompositeOperation = "destination-out";
        drawSlug(octx, s, "#000");
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, 0, 0);
        ctx.restore();
      } else {
        drawSlug(ctx, s, s.ink === "red" ? RED : BLACK);
      }
    }

    // Ink that did not quite take: pale flecks over the printed areas only.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  stage.onFrame((dt) => {
    let active = dirty;
    dirty = false;
    if (stillT == null) {
      for (const s of slugs) {
        if (s.settled && s.seat <= 0) continue;
        active = true;
        // Stiff and critically damped while held; a touch stiffer to seat.
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
          click(1300, 0.09, 1.4);
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
