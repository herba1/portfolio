// Colour Code: a line of type encoded as flat printed squares, one colour per
// letter, and a card decoder wheel that reads them back. The lower disc is
// printed with a flush colour ring; a solid black die-cut cover, pinned at
// the centre, frames one segment and shows its letter and number through a
// wide window.
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

  // Tracking law, for canvas text: px below 20px, em from 20px up.
  const track = (size) => -0.043 * (size - 12);
  const tracking = (size) => (size < 20 ? `${track(size).toFixed(2)}px` : `${(track(size) / size).toFixed(4)}em`);

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

  // The wheel's proportions, as fractions of its radius. The colour ring
  // runs flush from the cover's edge to the rim; a strip square is cut to
  // the same depth as a ring segment, so the line and the key share a unit.
  const RING_IN = 0.76;
  const UNIT = 1 - RING_IN;

  function lineWidth(size) {
    const { lines, gap } = wrap(size, Infinity);
    const line = lines[0];
    const tail = line[line.length - 1];
    if (!tail) return 0;
    return tail.x + (tail.it.code < 0 ? 0 : size + gap) - gap;
  }

  function layout() {
    const portrait = W < H * 1.15;
    let maxStrip;
    let stripX;
    let stripCy;
    if (!portrait) {
      // Largest wheel, down to three quarters of it, that lets the whole
      // line sit on one row beside it; past that the line wraps.
      const gapG = Math.max(56, Math.round(W * 0.06));
      const room = W * 0.88;
      const R0 = Math.min(H * 0.33, W * 0.2);
      R = R0;
      for (let r = R0; r >= R0 * 0.74; r -= 2) {
        R = r;
        const size = Math.round(r * UNIT);
        // wrap() measures a word with its trailing gap, so allow for it
        if (lineWidth(size) + Math.max(2, Math.round(size * 0.14)) <= room - 2 * r - gapG) break;
      }
      maxStrip = room - 2 * R - gapG;
      const size = Math.round(R * UNIT);
      const used = Math.min(maxStrip, lineWidth(size));
      const left = Math.round((W - (used + gapG + 2 * R)) / 2);
      stripX = left;
      wcx = Math.round(left + used + gapG + R);
      wcy = Math.round(H / 2);
      stripCy = wcy;
    } else {
      R = Math.min(W * 0.4, H * 0.27);
      wcx = Math.round(W / 2);
      wcy = Math.round(H * 0.38);
      maxStrip = W - 2 * Math.max(16, W * 0.08);
      stripCy = wcy + R + Math.max(48, (H - wcy - R) * 0.36);
    }
    let size = Math.round(R * UNIT);
    let res = wrap(size, maxStrip);
    while (res.lines.length > 3 && size > 8) {
      size -= 1;
      res = wrap(size, maxStrip);
    }
    S = size;
    G = res.gap;
    if (portrait) {
      // centre the widest row under the wheel
      let widest = 0;
      for (const line of res.lines) {
        const tail = line[line.length - 1];
        if (tail) widest = Math.max(widest, tail.x + (tail.it.code < 0 ? 0 : S));
      }
      stripX = Math.round((W - widest) / 2);
    }
    const lineGap = Math.max(8, Math.round((S * 0.6) / 4) * 4);
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

  // Two inks on a sleeve stock: the colour set and a dense black. Nothing
  // is lit, shaded or textured; the wheel is a printed and die-cut object.
  const GROUND = "rgb(242 240 235)";
  const INK = "rgb(24 23 22)";
  const CARD = "rgb(249 247 242)";

  // Annular sector centred on twelve o'clock, angles measured from the top.
  function sectorPath(path, a0, a1, r0, r1) {
    const q = -Math.PI / 2;
    path.moveTo(Math.cos(q + a0) * r0, Math.sin(q + a0) * r0);
    path.arc(0, 0, r1, q + a0, q + a1);
    path.arc(0, 0, r0, q + a1, q + a0, true);
    path.closePath();
    return path;
  }

  // The window: a wide die-cut slot in the cover, a sector so it reads as
  // part of the wheel's geometry. Its letter sits on an inner disc that
  // advances one whole window per detent, so exactly one letter is shown
  // at rest and the next one turns in as the last one turns out.
  const WIN = { r0: 0.18, r1: 0.69, half: 0.45 };
  const PITCH = WIN.half * 2;

  function drawRing() {
    const rot = -wheel.theta * STEP;
    const r0 = R * RING_IN - 1;
    const r1 = R;
    ctx.save();
    ctx.rotate(rot);
    // Flush segments: each one runs a hair past its seam and the next one
    // covers it, so no ground shows through between neighbours.
    const over = 1.2 / R;
    for (let i = 0; i < N; i += 1) {
      ctx.fillStyle = PALETTE[i];
      ctx.fill(sectorPath(new Path2D(), (i - 0.5) * STEP, (i + 0.5) * STEP + over, r0, r1));
    }
    ctx.fillStyle = PALETTE[0];
    ctx.fill(sectorPath(new Path2D(), -0.5 * STEP, -0.5 * STEP + over, r0, r1));
    ctx.restore();
  }

  function drawWindow() {
    const r0 = R * WIN.r0;
    const r1 = R * WIN.r1;
    const win = sectorPath(new Path2D(), -WIN.half, WIN.half, r0, r1);
    ctx.save();
    ctx.clip(win);
    ctx.fillStyle = CARD;
    ctx.fillRect(-r1, -r1, 2 * r1, r1);

    const gSize = Math.round(R * 0.36);
    const nSize = Math.max(10, Math.round(R * 0.068));
    const rGlyph = R * 0.355; // baseline radius of the letter
    const rNum = R * 0.235; // baseline radius of the number
    // Intermittent drive, like a Geneva wheel: the letter disc dwells
    // upright through the middle of each detent and flips across between
    // them, so the window always reads as a letter or a click, never a tilt.
    const base = Math.floor(wheel.theta);
    const u = Math.min(1, Math.max(0, (wheel.theta - base - 0.22) / 0.56));
    const shown = base + u * u * (3 - 2 * u);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < N; i += 1) {
      let d = (i - shown) % N;
      if (d > N / 2) d -= N;
      if (d < -N / 2) d += N;
      if (Math.abs(d) > 1.6) continue;
      ctx.save();
      ctx.rotate(d * PITCH);
      ctx.font = `${wGlyph} ${gSize}px ${sans}`;
      ctx.letterSpacing = tracking(gSize);
      // canvas adds tracking after the last glyph too; take half of it back
      ctx.fillText(ALPHA[i], -track(gSize) / 2, -rGlyph);
      ctx.font = `${wNum} ${nSize}px ${mono}`;
      ctx.letterSpacing = tracking(nSize);
      ctx.fillText(String(i + 1).padStart(2, "0"), -track(nSize) / 2, -rNum);
      ctx.restore();
    }
    ctx.letterSpacing = "0px";
    ctx.restore();
    return win;
  }

  function drawCover(win) {
    const rc = R * RING_IN;
    // the black disc, window cut out
    const cover = new Path2D();
    cover.arc(0, 0, rc, 0, TAU);
    cover.addPath(win);
    ctx.fillStyle = INK;
    ctx.fill(cover, "evenodd");

    // A tongue of the same black reaches over the ring at twelve o'clock and
    // frames exactly one segment: the colour that belongs to the letter.
    const b = R * 0.03;
    const half = STEP / 2;
    const frame = new Path2D();
    sectorPath(frame, -half - b / R, half + b / R, rc - 2, R + b);
    sectorPath(frame, -half, half, rc - 2, R);
    ctx.fill(frame, "evenodd");

    // printed on the cover in the stock colour: a detent mark per letter
    ctx.strokeStyle = CARD;
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.lineCap = "butt";
    for (let k = 0; k < N; k += 1) {
      const a = k * STEP;
      if (Math.min(a, TAU - a) < WIN.half + 0.06) continue;
      const [x0, y0] = pt(a, rc - R * 0.06);
      const [x1, y1] = pt(a, rc - R * 0.025);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // the pin: a flat punched eyelet, stock showing through
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(3, R * 0.022), 0, TAU);
    ctx.fillStyle = GROUND;
    ctx.fill();
  }

  const pt = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];

  function drawStrip(t) {
    for (const it of items) {
      if (it.code < 0 || it.a < 0.005 || it.delay > 0) continue;
      const s = S * Math.max(0, it.sc);
      const settled = Math.abs(it.x - it.tx) < 0.05 && Math.abs(it.y - it.ty) < 0.05 && Math.abs(it.sc - 1) < 0.002;
      let x = it.x + (S - s) / 2;
      let y = it.y + (S - s) / 2;
      let sz = s;
      if (settled) {
        x = Math.round(x * dpr) / dpr;
        y = Math.round(y * dpr) / dpr;
        sz = Math.round(sz * dpr) / dpr;
      }
      ctx.globalAlpha = Math.min(1, it.a);
      ctx.fillStyle = PALETTE[it.code];
      ctx.fillRect(x, y, sz, sz);
      // the square being read gets a rule in the cover's black, the same
      // ink that frames its segment on the wheel
      if (it.lift > 0.01 && !it.dying) {
        const w = S * Math.min(1, it.lift);
        const h = Math.max(2, Math.round(S * 0.08));
        ctx.fillStyle = INK;
        ctx.fillRect(Math.round(it.tx + (S - w) / 2), it.ty + S + Math.max(4, Math.round(S * 0.16)), w, h);
      }
    }
    ctx.globalAlpha = 1;
    if (document.activeElement === input && !embedded) {
      const on = (t * 1000 - lastType) % 1060 < 600 || t * 1000 - lastType < 500;
      if (on) {
        ctx.fillStyle = INK;
        ctx.fillRect(caret.x, caret.y, 2, S);
      }
    }
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    drawStrip(t);
    ctx.save();
    ctx.translate(wcx, wcy);
    drawRing();
    const win = drawWindow();
    drawCover(win);
    ctx.restore();
  }

  /* ----- input ----- */

  const hit = (x, y) => {
    const pad = G / 2 + 1;
    for (const it of items) {
      if (it.dying || it.code < 0) continue;
      if (x >= it.tx - pad && x <= it.tx + S + pad && y >= it.ty - pad && y <= it.ty + S + pad) return it;
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
