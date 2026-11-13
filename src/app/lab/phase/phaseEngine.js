import { createStage, clamp, damp } from "../_kit/stage";
import { soundAllowed } from "@/lib/sound/desktopOnly";

// Two tape loops of one phrase, after Reich's It's Gonna Rain. Both copies
// run left at the same tape speed; the second runs a hair faster, so the
// offset between them grows steadily, wraps round the loop and comes back to
// zero. The first is printed in blue, the second in red multiplied over it:
// in unison the two inks make one dark line, out of step the red shows as an
// echo and every overlap prints a third ink.
//
// The page is the history of that process, set like a phase score. The live
// pair is the bottom row; once per loop it is printed off and every earlier
// row moves up one line, so the drift reads as a diagonal running up the
// sheet, from solid unison rows to rows broken into two voices.

const PHRASE = "It's gonna rain";
const PAPER = "#f2f0eb";
const INKS = {
  // Ink, then second ink. Where they overlap, multiply.
  blue: ["#23439c", "#e2492c"],
  black: ["#1c1b19", "#e2492c"],
};
// Clicks per loop: the phrase is one bar.
const BEATS = 4;
// One pass of the loop, in seconds: one row of the score.
const LOOP = 4;
// One full walk out of phase and back, in seconds, left alone: twelve rows.
const CYCLE = 48;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// The pulse pair: two identical wood clicks, one per line, panned apart the
// way Reich split the loops across channels. Silent until the first touch.
function createPulse() {
  let ctx = null;
  let out = null;
  let on = false;
  const start = () => {
    if (ctx || !soundAllowed()) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    out = ctx.createGain();
    out.gain.value = 0.32;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    out.connect(comp).connect(ctx.destination);
    on = true;
  };
  const click = (when, pan, accent) => {
    if (!ctx || !on) return;
    const t = Math.max(ctx.currentTime, when);
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(out);
    // A struck body: two damped partials and a breath of noise.
    const peak = accent ? 0.9 : 0.55;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    for (const [f, a] of [
      [accent ? 1180 : 1240, 1],
      [accent ? 2730 : 2860, 0.35],
    ]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.value = f;
      og.gain.setValueAtTime(a, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + (a === 1 ? 0.09 : 0.03));
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.12);
    }
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.012), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) * 0.4;
    n.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    n.connect(hp).connect(g);
    n.start(t);
  };
  return {
    start,
    get ctx() {
      return ctx;
    },
    get live() {
      return !!ctx && on && ctx.state === "running";
    },
    toggle() {
      if (!ctx) return start();
      on = !on;
      out.gain.setTargetAtTime(on ? 0.32 : 0, ctx.currentTime, 0.03);
    },
    resume() {
      if (ctx && ctx.state !== "running") ctx.resume();
    },
    click,
    destroy() {
      ctx?.close();
    },
  };
}

export async function createPhase(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const stillPhase = parseFloat(params.get("phase"));
  const still = Number.isFinite(stillPhase);
  const [inkA, inkB] = INKS[params.get("ink")] || INKS.blue;

  const family = cssVar("--font-sans", "Geist, ui-sans-serif, system-ui, sans-serif");
  const weight = cssVar("--font-weight-semibold", "600");
  try {
    await document.fonts.load(`${weight} 100px ${family}`, PHRASE);
  } catch {
    /* draw with whatever loaded */
  }

  const stage = createStage(host, { dpr: 2 });
  const g = stage.ctx;
  const pulse = embedded ? null : createPulse();

  let size = 64;
  let font = "";
  let spacing = 0;
  let unit = 0; // one phrase plus its breath: the loop length, px
  let rows = 11; // lines on the sheet, the live one included
  let pitch = 64; // line pitch, a multiple of 4
  let top = 0; // top of the first line box
  let drop = 0; // line box top to baseline

  const grid4 = (v) => Math.round(v / 4) * 4;
  const layout = (w, h) => {
    const margin = grid4(clamp(h * 0.04, 16, 48));
    const room = h - margin * 2;
    // Aim for a line about a twentieth of the width, then fit a whole number
    // of lines (nine to thirteen) on a 4px pitch.
    const aim = clamp(w * 0.052, 28, 112);
    rows = Math.round(clamp(room / aim, 9, 13));
    pitch = Math.max(16, Math.floor(room / rows / 4) * 4);
    top = grid4((h - pitch * rows) / 2);
    size = pitch;
    font = `${weight} ${size}px ${family}`;
    // The tracking law: -0.043 x (size - 12), in px for the canvas.
    spacing = -0.043 * (size - 12);
    g.font = font;
    g.letterSpacing = `${spacing}px`;
    unit = g.measureText(PHRASE).width + size * 0.62;
    const cap = g.measureText("H").actualBoundingBoxAscent;
    // Caps sit a touch above the middle of the line so descenders clear.
    drop = grid4((pitch + cap) / 2 - pitch * 0.06);
  };
  stage.onResize(layout);

  // Offsets are kept as fractions of the loop so the sheet survives a resize.
  // history[0] is the row just printed off the live line, history[1] the one
  // above it, and so on; one more than fits, for the line leaving the top.
  const step = LOOP / CYCLE; // drift per row, left alone
  const history = [];
  let age = 1; // seconds since the last row was printed, for the climb
  let since = 0; // seconds into the current loop

  // Tape positions in px, both increasing as the loops run left.
  const speed = () => unit / LOOP; // tape speed
  const drift = () => unit / CYCLE; // the second line's extra speed at rest
  let a = 0;
  let b = 0;
  let rel = null; // the second line's speed over the first, px/s
  let held = null;

  // Rows already on the sheet: the loops that led to `live`, one per row.
  // `from` 0 counts the starting moment itself as already printed.
  const fill = (live, per, from = 1) => {
    history.length = 0;
    for (let j = from; j < from + 14; j++) history.push(live - j * per);
  };

  // A held moment: the phrase set from the left margin, the live line that
  // fraction of a loop ahead, the rows above it the loops that led there.
  // The step is nudged so one row lands exactly on unison.
  const hold = () => {
    a = -size * 0.55;
    b = a + stillPhase * unit;
    const f = ((stillPhase % 1) + 1) % 1;
    const k = Math.round(f / step);
    fill(stillPhase, k > 0 ? f / k : step);
  };
  // Left alone, the piece opens in unison and the sheet above shows the walk
  // that came back to it.
  if (!still) fill(0, step, 0);

  stage.on("down", (p) => {
    held = { x: p.x, b0: b - a };
    pulse?.start();
    pulse?.resume();
  });
  stage.on("up", (p) => {
    if (!held) return;
    held = null;
    // Let go: the second loop keeps the hand's speed, then eases back into
    // its own slow drift.
    rel = clamp(-p.vx * 0.9, -unit * 1.5, unit * 1.5);
  });
  const onKey = (e) => {
    if (e.key === "m" || e.key === "M") pulse?.toggle();
  };
  if (!embedded) window.addEventListener("keydown", onKey);

  // Beat bookkeeping for the clicks: the last beat each line has scheduled.
  const last = [null, null];
  const LOOKAHEAD = 0.12;
  const schedule = (i, x, v, now) => {
    const beat = unit / BEATS;
    const k = Math.floor(x / beat);
    if (last[i] == null || v <= 0) {
      last[i] = k;
      return;
    }
    const next = last[i] + 1;
    if (next < k) {
      // Jumped past several beats (a fast push): skip them, don't machine-gun.
      last[i] = k;
      return;
    }
    const dt = (next * beat - x) / v;
    if (dt > LOOKAHEAD) return;
    last[i] = next;
    pulse.click(now + Math.max(0, dt), i === 0 ? -0.45 : 0.45, ((next % BEATS) + BEATS) % BEATS === 0);
  };

  const drawLine = (x, y, ink) => {
    const W = stage.width;
    g.fillStyle = ink;
    // The loop, tiled across the box: x runs left as the tape advances.
    let left = -(((x % unit) + unit) % unit);
    for (; left < W; left += unit) g.fillText(PHRASE, left, y);
  };
  // One row of the score: the first voice where the tape is now, the second
  // that fraction of a loop ahead of it, multiplied over.
  const drawPair = (y, offset, alpha) => {
    g.globalAlpha = alpha;
    g.globalCompositeOperation = "source-over";
    drawLine(a, y, inkA);
    g.globalCompositeOperation = "multiply";
    drawLine(a + offset * unit, y, inkB);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  };

  stage.onFrame((dt) => {
    const W = stage.width;
    const H = stage.height;
    const p = stage.pointer;
    if (rel == null) rel = drift();

    if (still) hold();
    else {
      const v = speed();
      a += v * dt;
      if (held && p.down) {
        // Holding the second loop: the hand slides it ahead or holds it back
        // against the first, while both keep running.
        const want = held.b0 - (p.x - held.x);
        const before = b;
        b = a + want;
        rel = (b - before) / Math.max(dt, 1e-3) - v;
      } else {
        rel = damp(rel, drift(), 0.9, dt);
        b += (v + rel) * dt;
      }
      // Once per loop the live line is printed off and the sheet climbs.
      since += dt;
      age += dt;
      if (since >= LOOP) {
        since -= LOOP;
        history.unshift((b - a) / unit);
        history.length = Math.min(history.length, 14);
        age = 0;
      }
      // Keep the numbers small without moving anything.
      if (a > unit * 64) {
        const k = Math.floor(a / unit) * unit;
        a -= k;
        b -= k;
        last[0] = last[1] = null;
      }
      if (pulse?.live) {
        const now = pulse.ctx.currentTime;
        schedule(0, a, v, now);
        schedule(1, b, v + rel, now);
      }
    }

    const dpr = stage.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    g.font = font;
    g.letterSpacing = `${spacing}px`;
    g.textBaseline = "alphabetic";

    // The climb: a short ease after each new row, then the sheet sits on its
    // grid until the next loop comes round.
    const t = still ? 1 : clamp(age / 0.7, 0, 1);
    const climb = 1 - (1 - t) * (1 - t) * (1 - t);
    const liveY = top + (rows - 1) * pitch + drop;
    // Every row above the live one, plus the row leaving the top mid-climb.
    const n = Math.min(history.length, climb < 1 ? rows : rows - 1);
    for (let j = 0; j < n; j++) {
      const y = liveY - (j + climb) * pitch;
      // The row just printed lifts off the live line as it inks in.
      drawPair(y, history[j], j === 0 ? climb : 1);
    }
    // The live line, ruled off from the printed rows above it: the rule sits
    // in the clear band between their descenders and its capitals.
    g.fillStyle = inkA;
    g.fillRect(0, top + (rows - 1) * pitch + 4, W, 1);
    drawPair(liveY, (b - a) / unit, 1);
  });

  return {
    destroy() {
      if (!embedded) window.removeEventListener("keydown", onKey);
      pulse?.destroy();
      stage.destroy();
    },
  };
}
