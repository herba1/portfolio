// Colour Code: a line of type encoded as flat printed squares, one colour per
// letter, and a card decoder wheel that reads them back. The lower disc is
// printed with the colour ring, a scale, the alphabet and its numbers; a
// black die-cut cover held on a rivet shows one letter through its window.
//
// The disc turns on a spring with a detent potential, so it clicks through
// every letter on the way and seats in the notch it was sent to.
//
// Stills: ?text=LINE&hover=<square index>&t=<seconds> runs the simulation
// for t seconds from load with that square hovered, then holds the frame.

const N = 26;
const STEP = (Math.PI * 2) / N;
const TAU = Math.PI * 2;

/* ---------- palette: own colour alphabet, set in OKLCH ---------- */

function oklchToRgb(L, C, h) {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

function inGamut(L, C, h) {
  let c = C;
  for (let i = 0; i < 40; i += 1) {
    const rgb = oklchToRgb(L, c, h);
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgb;
    c *= 0.94;
  }
  return oklchToRgb(L, 0, h);
}

// A hue walk around the wheel with the lightness stepping on a three-beat
// rhythm, so neighbours never read as a gradient and every pair can be told
// apart at a glance. Two letters break the walk: ink and a warm grey, as a
// printer would hold a black and a neutral in the set.
const PALETTE = (() => {
  const lights = [0.64, 0.8, 0.5];
  const out = [];
  for (let i = 0; i < N; i += 1) {
    const hue = ((28 + i * (334 / N)) * Math.PI) / 180;
    let L = lights[i % 3];
    let C = L > 0.75 ? 0.13 : 0.15;
    if (i === 13) { L = 0.72; C = 0.012; } // N: warm grey
    if (i === 25) { L = 0.25; C = 0.012; } // Z: ink
    const rgb = inGamut(L, C, hue).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
    out.push(`rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`);
  }
  return out;
})();

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function codeOf(ch) {
  const a = ALPHA.indexOf(ch);
  if (a >= 0) return a;
  if (ch >= "1" && ch <= "9") return ch.charCodeAt(0) - 49;
  if (ch === "0") return 9;
  return -1;
}

const sanitize = (s) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/ {2,}/g, " ").slice(0, 48);

/* ---------- paper grain ---------- */

function makeGrain(seed, lo, hi) {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 160;
  const g = c.getContext("2d");
  const img = g.createImageData(160, 160);
  let x = seed;
  for (let i = 0; i < img.data.length; i += 4) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const r = x / 4294967296;
    const v = Math.round((lo + (hi - lo) * r * r) * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------- engine ---------- */

export async function createColourCode({ root, canvas, input, embedded = false }) {
  const box = root.closest(".piece-box") || root;
  const ctx = canvas.getContext("2d");
  const params = new URLSearchParams(window.location.search);

  const cs = getComputedStyle(document.documentElement);
  const sans = cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
  const mono = cs.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";
  const wGlyph = cs.getPropertyValue("--font-weight-semibold").trim() || "600";
  const wNum = cs.getPropertyValue("--font-weight-caption").trim() || "520";
  try {
    await Promise.all([document.fonts.load(`${wGlyph} 32px ${sans}`), document.fonts.load(`${wNum} 10px ${mono}`)]);
  } catch {
    /* fall back to whatever is there */
  }

  const grainPaper = ctx.createPattern(makeGrain(7, 0.9, 1), "repeat");

  // Tracking law, px, for canvas text.
  const track = (size) => -0.043 * (size - 12);

  /* ----- state ----- */
  let W = 1;
  let H = 1;
  let dpr = 1;
  let S = 24; // square size
  let G = 4; // gap between squares
  let R = 200; // wheel radius
  let wcx = 0;
  let wcy = 0;
  let caret = { x: 0, y: 0 };
  let items = [];
  let uid = 0;
  let text = sanitize(params.get("text") || "HOW DOES IT FEEL");

  const wheel = { theta: 0, omega: 0, target: 0, notch: 0 };
  let hover = null;
  let lastPointer = -1e9;
  let lastType = -1e9;
  let autoAt = 0;
  let autoIndex = -1;

  /* ----- layout ----- */

  function wrap(size, maxW) {
    const gap = Math.max(2, Math.round(size * 0.14));
    const space = Math.round(size * 0.9);
    const lines = [[]];
    let x = 0;
    let word = [];
    let wordW = 0;
    const flush = () => {
      if (!word.length) return;
      if (x > 0 && x + wordW > maxW) {
        lines.push([]);
        x = 0;
      }
      const line = lines[lines.length - 1];
      for (const it of word) {
        line.push({ it, x });
        x += size + gap;
      }
      word = [];
      wordW = 0;
    };
    for (const it of items) {
      if (it.dying) continue;
      if (it.code < 0) {
        flush();
        if (x > 0) {
          lines[lines.length - 1].push({ it, x });
          x += space;
        } else lines[lines.length - 1].push({ it, x: 0 });
      } else {
        word.push(it);
        wordW += size + gap;
      }
    }
    flush();
    return { lines, gap, space };
  }

  function layout() {
    const portrait = W < H * 1.15;
    let maxStrip;
    let stripX;
    let stripCy;
    if (!portrait) {
      R = Math.min(H * 0.3, W * 0.19);
      const gapG = Math.max(48, W * 0.06);
      maxStrip = W * 0.86 - 2 * R - gapG;
      const left = (W - (maxStrip + gapG + 2 * R)) / 2;
      stripX = left;
      wcx = left + maxStrip + gapG + R;
      wcy = H / 2;
      stripCy = H / 2;
    } else {
      R = Math.min(W * 0.36, H * 0.25);
      wcx = W / 2;
      wcy = H * 0.38;
      maxStrip = W - 2 * Math.max(16, W * 0.08);
      stripX = (W - maxStrip) / 2;
      stripCy = wcy + R + Math.max(48, (H - wcy - R) * 0.32);
    }
    let size = Math.round(Math.min(30, Math.max(12, R * 0.12)));
    let res = wrap(size, maxStrip);
    while (res.lines.length > 3 && size > 8) {
      size -= 1;
      res = wrap(size, maxStrip);
    }
    S = size;
    G = res.gap;
    const lineGap = Math.round(S * 0.6);
    const blockH = res.lines.length * S + (res.lines.length - 1) * lineGap;
    const top = Math.round(stripCy - blockH / 2);
    res.lines.forEach((line, li) => {
      for (const { it, x } of line) {
        it.tx = Math.round(stripX + x);
        it.ty = top + li * (S + lineGap);
      }
    });
    const lastLine = res.lines[res.lines.length - 1];
    const tail = lastLine[lastLine.length - 1];
    if (tail) {
      caret = { x: tail.it.tx + (tail.it.code < 0 ? res.space : S + G) - Math.round(G / 2) + 2, y: tail.it.ty };
      if (tail.it.code < 0) caret.x = tail.it.tx + res.space;
    } else caret = { x: Math.round(stripX), y: top };
    caret.x = Math.round(caret.x);
  }

  function makeItem(ch, delay) {
    return { id: uid++, ch, code: codeOf(ch), x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, sc: 0.4, vs: 0, a: 0, lift: 0, vl: 0, delay, born: true, dying: false };
  }

  function setText(next, { stagger = 0 } = {}) {
    const alive = items.filter((it) => !it.dying);
    const old = alive.map((it) => it.ch).join("");
    let p = 0;
    while (p < old.length && p < next.length && old[p] === next[p]) p += 1;
    let q = 0;
    while (q < old.length - p && q < next.length - p && old[old.length - 1 - q] === next[next.length - 1 - q]) q += 1;
    const keepHead = alive.slice(0, p);
    const removed = alive.slice(p, alive.length - q);
    const keepTail = alive.slice(alive.length - q);
    const fresh = [];
    for (let i = p; i < next.length - q; i += 1) fresh.push(makeItem(next[i], (i - p) * stagger));
    for (const it of removed) {
      it.dying = true;
      if (hover === it) hover = null;
    }
    const dying = items.filter((it) => it.dying);
    items = [...keepHead, ...fresh, ...keepTail, ...dying];
    text = next;
    layout();
    for (const it of fresh) {
      it.x = it.tx + S * 1.4;
      it.y = it.ty;
    }
    return fresh;
  }

  /* ----- wheel ----- */

  function sendWheel(code) {
    if (code < 0) return;
    const base = code + N * Math.round((wheel.theta - code) / N);
    wheel.target = base;
  }

  /* ----- sound: a dry paper-on-card click per detent ----- */

  let actx = null;
  let noise = null;
  let lastClick = 0;
  const ensureAudio = () => {
    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        noise = actx.createBuffer(1, Math.round(actx.sampleRate * 0.03), actx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (actx.sampleRate * 0.0025));
      }
      if (actx.state === "suspended") actx.resume();
    } catch {
      actx = null;
    }
  };
  const click = (strength) => {
    if (!actx || actx.state !== "running") return;
    const now = performance.now();
    if (now - lastClick < 22) return;
    lastClick = now;
    const t = actx.currentTime;
    const v = Math.min(1, 0.35 + strength);
    const src = actx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 0.9;
    const g = actx.createGain();
    g.gain.value = 0.11 * v;
    src.connect(bp).connect(g).connect(actx.destination);
    src.start(t);
    const o = actx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.03);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.05 * v, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(og).connect(actx.destination);
    o.start(t);
    o.stop(t + 0.04);
  };

  /* ----- simulation ----- */

  function step(dt, frozen = false) {
    // Squares: springs on position, scale and lift.
    const k = 360;
    const c = 2 * Math.sqrt(k) * 0.82;
    for (const it of items) {
      if (it.delay > 0) {
        it.delay -= dt;
        continue;
      }
      const tx = it.dying ? it.x : it.tx;
      const ty = it.dying ? it.y : it.ty;
      it.vx += (k * (tx - it.x) - c * it.vx) * dt;
      it.vy += (k * (ty - it.y) - c * it.vy) * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      const ts = it.dying ? 0.3 : 1;
      it.vs += (k * (ts - it.sc) - c * it.vs) * dt;
      it.sc += it.vs * dt;
      it.a += ((it.dying ? 0 : 1) - it.a) * (1 - Math.exp(-(it.dying ? 22 : 16) * dt));
      const tl = hover === it ? 1 : 0;
      const kl = 520;
      it.vl += (kl * (tl - it.lift) - 2 * Math.sqrt(kl) * 0.9 * it.vl) * dt;
      it.lift += it.vl * dt;
    }
    items = items.filter((it) => !(it.dying && it.a < 0.01));

    // Wheel: pull toward the target, capped so long trips turn at a steady
    // speed, plus a detent potential with a minimum at every letter.
    const K = 84;
    const C = 21;
    const D = 26;
    const pull = Math.max(-3, Math.min(3, wheel.target - wheel.theta));
    const acc = K * pull - C * wheel.omega - D * Math.sin(TAU * wheel.theta);
    wheel.omega += acc * dt;
    wheel.theta += wheel.omega * dt;
    const notch = Math.round(wheel.theta);
    if (notch !== wheel.notch) {
      wheel.notch = notch;
      if (!frozen) click(Math.abs(wheel.omega) / 14);
    }
  }

  /* ----- drawing ----- */

  const INK = "rgb(30 28 26)";
  const CARD = "rgb(249 247 242)";
  const COVER = "rgb(228 223 213)";
  const COVER_INK = "rgb(30 28 26)";
  const pt = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];

  function sector(a0, a1, r0, r1, gap) {
    const o = gap / (2 * r1);
    const i = gap / (2 * r0);
    ctx.beginPath();
    ctx.arc(0, 0, r1, a0 + o - Math.PI / 2, a1 - o - Math.PI / 2);
    ctx.arc(0, 0, r0, a1 - i - Math.PI / 2, a0 + i - Math.PI / 2, true);
    ctx.closePath();
  }

  // The window is a sector of the ring, cut to the disc's own geometry, so
  // it shows exactly one letter and its number and nothing of the neighbours.
  const WIN = { r0: 0.36, r1: 0.685, half: 0.47 };
  function windowPath(path) {
    const r0 = R * WIN.r0;
    const r1 = R * WIN.r1;
    const a = WIN.half * STEP;
    const top = -Math.PI / 2;
    path.moveTo(Math.cos(top - a) * r0, Math.sin(top - a) * r0);
    path.arc(0, 0, r1, top - a, top + a);
    path.arc(0, 0, r0, top + a, top - a, true);
    path.closePath();
    return { r0, r1, a };
  }

  function drawLowerDisc() {
    const rot = -wheel.theta * STEP;
    // shadow on the ground: a wide soft one and a tight contact one
    ctx.save();
    ctx.shadowColor = "rgb(60 44 24 / 0.16)";
    ctx.shadowBlur = R * 0.09 * dpr;
    ctx.shadowOffsetY = R * 0.035 * dpr;
    ctx.shadowOffsetX = R * 0.012 * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fillStyle = CARD;
    ctx.fill();
    ctx.shadowColor = "rgb(40 30 20 / 0.18)";
    ctx.shadowBlur = 1.5 * dpr;
    ctx.shadowOffsetY = 0.75 * dpr;
    ctx.shadowOffsetX = 0;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.clip();
    ctx.rotate(rot);

    // colour ring
    const r0 = R * 0.755;
    const r1 = R * 0.93;
    const gap = Math.max(1.5, R * 0.011);
    for (let i = 0; i < N; i += 1) {
      sector((i - 0.5) * STEP, (i + 0.5) * STEP, r0, r1, gap);
      ctx.fillStyle = PALETTE[i];
      ctx.fill();
    }

    // printed scale at the rim
    ctx.strokeStyle = INK;
    ctx.lineCap = "butt";
    const rs = R * 0.95;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, rs, 0, TAU);
    ctx.stroke();
    for (let k = 0; k < N * 4; k += 1) {
      const a = (k / 4) * STEP;
      const major = k % 4 === 0;
      const half = k % 4 === 2;
      const len = major ? R * 0.034 : half ? R * 0.022 : R * 0.012;
      ctx.lineWidth = major ? 1 : 0.6;
      const [x0, y0] = pt(a, rs);
      const [x1, y1] = pt(a, rs + len);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // alphabet and numbers, radial, upright at twelve o'clock
    const gSize = R * 0.16;
    const nSize = Math.max(8, R * 0.05);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < N; i += 1) {
      ctx.save();
      ctx.rotate(i * STEP);
      ctx.font = `${wGlyph} ${gSize}px ${sans}`;
      ctx.letterSpacing = "0px";
      ctx.fillText(ALPHA[i], 0, -R * 0.5);
      ctx.font = `${wNum} ${nSize}px ${mono}`;
      ctx.letterSpacing = `${track(nSize).toFixed(2)}px`;
      ctx.fillText(String(i + 1).padStart(2, "0"), 0, -R * 0.405);
      ctx.restore();
    }
    ctx.letterSpacing = "0px";

    // registration hairlines under the cover
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.7, 0, TAU);
    ctx.stroke();

    // paper grain, turning with the disc
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = grainPaper;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    ctx.restore();

    // a whisper of edge where the card was cut
    ctx.beginPath();
    ctx.arc(0, 0, R - 0.25, 0, TAU);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgb(0 0 0 / 0.08)";
    ctx.stroke();
  }

  function drawCover() {
    const rc = R * 0.72;
    const path = new Path2D();
    path.arc(0, 0, rc, 0, TAU);
    const win = new Path2D();
    const { r0, a } = windowPath(win);
    path.addPath(win);

    // the cover's shadow falls on the disc, and into its own window
    ctx.save();
    ctx.shadowColor = "rgb(50 36 20 / 0.26)";
    ctx.shadowBlur = R * 0.026 * dpr;
    ctx.shadowOffsetY = R * 0.012 * dpr;
    ctx.shadowOffsetX = R * 0.004 * dpr;
    ctx.fillStyle = COVER;
    ctx.fill(path, "evenodd");
    ctx.restore();

    ctx.save();
    ctx.clip(path, "evenodd");
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = grainPaper;
    ctx.fillRect(-rc, -rc, 2 * rc, 2 * rc);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // printed in warm white: index, a ring of ticks, a hairline
    ctx.fillStyle = COVER_INK;
    ctx.strokeStyle = COVER_INK;
    ctx.lineWidth = 0.75;
    for (let i = 1; i < N; i += 1) {
      const a = i * STEP;
      const [x0, yy0] = pt(a, rc - R * 0.04);
      const [x1, yy1] = pt(a, rc - R * 0.012);
      ctx.beginPath();
      ctx.moveTo(x0, yy0);
      ctx.lineTo(x1, yy1);
      ctx.stroke();
    }
    ctx.restore();

    // the cut faces of the window: the lower wall catches the light
    ctx.save();
    ctx.clip(win);
    ctx.strokeStyle = "rgb(255 252 246 / 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r0 + 0.5, -Math.PI / 2 - a, -Math.PI / 2 + a);
    ctx.stroke();
    ctx.restore();

    // cover rim, a thin catch of light along the top edge
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rc - 0.4, Math.PI * 1.08, Math.PI * 1.92);
    ctx.strokeStyle = "rgb(255 255 255 / 0.7)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawRivet() {
    const rr = Math.max(6, R * 0.052);
    ctx.save();
    ctx.shadowColor = "rgb(0 0 0 / 0.45)";
    ctx.shadowBlur = rr * 0.35 * dpr;
    ctx.shadowOffsetY = rr * 0.16 * dpr;
    const body = ctx.createRadialGradient(-rr * 0.35, -rr * 0.45, rr * 0.05, 0, 0, rr);
    body.addColorStop(0, "rgb(244 242 236)");
    body.addColorStop(0.55, "rgb(186 182 174)");
    body.addColorStop(1, "rgb(128 124 117)");
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();
    // rolled lip and the hollow
    const hole = ctx.createRadialGradient(rr * 0.08, rr * 0.12, 0, 0, 0, rr * 0.4);
    hole.addColorStop(0, "rgb(150 146 138)");
    hole.addColorStop(0.7, "rgb(96 92 86)");
    hole.addColorStop(1, "rgb(70 67 62)");
    ctx.beginPath();
    ctx.arc(0, 0, rr * 0.4, 0, TAU);
    ctx.fillStyle = hole;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, rr * 0.4, Math.PI * 0.1, Math.PI * 0.9);
    ctx.strokeStyle = "rgb(255 255 255 / 0.35)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, rr - 0.3, 0, TAU);
    ctx.strokeStyle = "rgb(0 0 0 / 0.25)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  function drawStrip(t) {
    for (const it of items) {
      if (it.code < 0 || it.a < 0.005 || it.delay > 0) continue;
      const s = S * Math.max(0, it.sc);
      const settled = Math.abs(it.x - it.tx) < 0.05 && Math.abs(it.y - it.ty) < 0.05 && Math.abs(it.sc - 1) < 0.002 && it.lift < 0.002;
      let x = it.x + (S - s) / 2;
      let y = it.y + (S - s) / 2 - it.lift * S * 0.24;
      let sz = s;
      if (settled) {
        x = Math.round(x * dpr) / dpr;
        y = Math.round(y * dpr) / dpr;
        sz = Math.round(sz * dpr) / dpr;
      }
      ctx.globalAlpha = Math.min(1, it.a);
      ctx.fillStyle = PALETTE[it.code];
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.globalAlpha = 1;
    if (document.activeElement === input && !embedded) {
      const on = (t * 1000 - lastType) % 1060 < 600 || t * 1000 - lastType < 500;
      if (on) {
        ctx.fillStyle = INK;
        ctx.fillRect(caret.x, caret.y, 1.5, S);
      }
    }
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgb(242 240 235)";
    ctx.fillRect(0, 0, W, H);
    drawStrip(t);
    ctx.save();
    ctx.translate(wcx, wcy);
    drawLowerDisc();
    drawCover();
    drawRivet();
    ctx.restore();
  }

  /* ----- input ----- */

  const hit = (x, y) => {
    const pad = G / 2 + 1;
    for (const it of items) {
      if (it.dying || it.code < 0) continue;
      if (x >= it.tx - pad && x <= it.tx + S + pad && y >= it.ty - pad - S * 0.24 && y <= it.ty + S + pad) return it;
    }
    return null;
  };
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onMove = (e) => {
    const [x, y] = local(e);
    lastPointer = performance.now();
    autoIndex = -1;
    const it = hit(x, y);
    canvas.dataset.cursor = it ? "pointer" : "";
    if (it && it !== hover) {
      hover = it;
      sendWheel(it.code);
    } else if (!it && hover) hover = null;
  };
  const onLeave = () => {
    hover = null;
    canvas.dataset.cursor = "";
  };
  const onDown = (e) => {
    ensureAudio();
    onMove(e);
    if (!embedded) input.focus({ preventScroll: true });
  };
  const onInput = () => {
    const next = sanitize(input.value);
    if (input.value !== next) input.value = next;
    if (next === text) return;
    lastType = performance.now();
    autoIndex = -1;
    const fresh = setText(next);
    const last = fresh.filter((it) => it.code >= 0).pop();
    if (last) {
      hover = last;
      sendWheel(last.code);
    }
  };
  const onKey = () => ensureAudio();

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerleave", onLeave);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);

  /* ----- sizing ----- */

  const resize = () => {
    const r = box.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    layout();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);
  resize();

  /* ----- start ----- */

  input.value = text;
  const first = setText(text, { stagger: 0.035 });
  // the opening: squares arrive, the wheel reads the first letter
  const firstLetter = first.find((it) => it.code >= 0);
  wheel.theta = firstLetter ? firstLetter.code - 5 : 0;
  wheel.notch = Math.round(wheel.theta);
  if (firstLetter) sendWheel(firstLetter.code);

  const still = params.has("t") ? Math.max(0, parseFloat(params.get("t")) || 0) : null;
  if (still != null) {
    for (const it of items) {
      it.x = it.tx;
      it.y = it.ty;
      it.sc = 1;
      it.a = 1;
      it.delay = 0;
    }
    const letters = items.filter((it) => it.code >= 0);
    const hi = Math.min(letters.length - 1, Math.max(0, parseInt(params.get("hover") || "0", 10)));
    const target = letters[hi];
    // start the wheel on the square before, so the still is mid-turn
    const from = letters[Math.max(0, hi - 1)];
    wheel.theta = from ? from.code : 0;
    wheel.notch = Math.round(wheel.theta);
    wheel.target = wheel.theta;
    // and let the last few squares be arriving
    const tailN = Math.min(3, letters.length - hi - 1);
    for (let j = 0; j < tailN; j += 1) {
      const it = letters[letters.length - 1 - j];
      it.x = it.tx + S * 1.4;
      it.sc = 0.4;
      it.a = 0;
      it.delay = (tailN - 1 - j) * 0.06;
    }
    if (target) {
      hover = target;
      sendWheel(target.code);
    }
    const dt = 1 / 240;
    for (let s = 0; s < still / dt; s += 1) step(dt, true);
  }

  if (!embedded && still == null) input.focus({ preventScroll: true });

  let raf = 0;
  let visible = true;
  let lastT = 0;
  let destroyed = false;
  const loop = (now) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(1 / 20, lastT ? (now - lastT) / 1000 : 1 / 60);
    lastT = now;
    if (still == null) {
      // when nobody is touching it, it reads its own line back, slowly
      const idle = Math.min(now - lastPointer, now - lastType);
      if (idle > 3500 && now > autoAt) {
        const letters = items.filter((it) => !it.dying && it.code >= 0);
        if (letters.length) {
          autoIndex = (autoIndex + 1) % letters.length;
          hover = letters[autoIndex];
          sendWheel(hover.code);
        }
        autoAt = now + 1100;
      }
      const sub = Math.max(1, Math.ceil(dt * 240));
      for (let i = 0; i < sub; i += 1) step(dt / sub);
    }
    draw(now / 1000);
    raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!raf && visible && !destroyed) {
      lastT = 0;
      raf = requestAnimationFrame(loop);
    }
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    wake();
  });
  io.observe(box);
  const onVis = () => {
    visible = !document.hidden;
    wake();
  };
  document.addEventListener("visibilitychange", onVis);
  wake();

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerleave", onLeave);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKey);
      actx?.close?.();
    },
  };
}
