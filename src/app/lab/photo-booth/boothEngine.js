import { createBoothGL } from "./boothGL";
import { STRIP, STRIP_LEN, poseSet, printStrip, readyMono } from "./boothPrint";

const SUB = 1 / 240;
const SEGS = 22;
const ITER = 12;
const GRAVITY = 9000;
const DAMP = 0.9976;
const HINGE_MAX = 0.17;
const MAX_STEP = 16;
const BEND = 0.45;
const SPANS = [1, 3, 7];
const MAX_STRIPS = 7;
const DRY_S = 7.5;
const COUNT_AT = [0, 0.7, 1.4];
const FLASH_AT = [2.1, 2.95, 3.8, 4.65];
const BUILD_AT = 5.15;
const CUT_AT = 5.3;
const FEED_AT = 5.75;
const FEED_S = 2.6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function stampFor(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear()).slice(-2);
  return `${d}.${m}.${y}`;
}

export function createBoothEngine({ root, stage, canvas, flash, lamp, pips, insets, embedded, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1 };
  const lay = { mx: 0, my: 0, W: 80, len: 300, perf: 4, floorY: 400, wallL: 0, wallR: 400 };
  const strips = [];
  const pointer = { x: 0, y: 0, lx: 0, ly: 0, has: false };
  const shown = { lamp: "", pips: -1, busy: false, hover: false, grabbing: false };
  let gl = null;
  let mono = null;
  let portrait = null;
  let cast = [];
  let video = null;
  let visible = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let acc = 0;
  let drag = null;
  let stub = null;
  let seq = null;
  let seedCounter = 11;
  let readyFired = false;

  function seg(strip) {
    return strip.len / SEGS;
  }

  function makeStrip(tex, seed, wet) {
    const n = SEGS + 1;
    return {
      tex,
      seed,
      W: lay.W,
      len: lay.len,
      perf: lay.perf,
      x: new Float32Array(n),
      y: new Float32Array(n),
      ox: new Float32Array(n),
      oy: new Float32Array(n),
      mode: "hang",
      fed: lay.len,
      tear: 0,
      tearSide: 0,
      tearOpen: 0,
      autoTear: 0,
      tornTop: false,
      wet,
      dryFrom: wet > 0 ? -1 : 0,
      lift: 0.15,
      still: 0,
      asleep: false,
      depth: 0,
      tilt: 0,
      tip: Math.random() < 0.5 ? -1 : 1,
      grabSoft: 1,
    };
  }

  function placeHanging(strip, sway) {
    const s = seg(strip);
    for (let i = 0; i <= SEGS; i += 1) {
      const k = i / SEGS;
      strip.x[i] = lay.mx + Math.sin(k * 1.2) * sway * k * strip.len * 0.12;
      strip.y[i] = lay.my + i * s;
      strip.ox[i] = strip.x[i];
      strip.oy[i] = strip.y[i];
    }
  }

  function placeLying(strip, cx) {
    const s = seg(strip);
    const y = lay.floorY - strip.depth - strip.W / 2;
    const x0 = cx - strip.len / 2;
    for (let i = 0; i <= SEGS; i += 1) {
      strip.x[i] = x0 + i * s;
      strip.y[i] = y - strip.tilt * (i * s - strip.len / 2);
      strip.ox[i] = strip.x[i];
      strip.oy[i] = strip.y[i];
    }
    strip.asleep = true;
    strip.lift = 0;
  }

  function hanging() {
    for (let i = strips.length - 1; i >= 0; i -= 1) if (strips[i].mode !== "free") return strips[i];
    return null;
  }

  function layout() {
    const rect = root.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pad = insets();
    const wide = !embedded && view.width >= 900;
    const floorY = view.height - (embedded ? 12 : wide ? 24 : 16);
    const my = embedded ? Math.max(30, view.height * 0.075) : Math.max(wide ? 132 : 96, pad.top + 28);
    let W = (floorY - my) / (STRIP_LEN + 0.72);
    W = Math.min(W, ((view.width - 28) / STRIP_LEN) * 0.98);
    W = Math.max(36, W);
    const len = W * STRIP_LEN;
    const mx = wide ? Math.round(view.width * 0.47) : Math.round(view.width * (view.width < 640 ? 0.4 : 0.44));
    const ctrlX = wide ? mx + Math.max(190, W * 1.7) : Math.min(view.width - 52, mx + W / 2 + (view.width - mx - W / 2) / 2 + 6);
    const ctrlY = my + Math.min(len * 0.42, (floorY - W - 30 - my) * 0.6);
    Object.assign(lay, { mx, my, W, len, perf: W * STRIP.stub, floorY, wallL: 6, wallR: view.width - 6 });
    const css = root.style;
    css.setProperty("--pb-mx", `${mx}px`);
    css.setProperty("--pb-my", `${my}px`);
    css.setProperty("--pb-w", `${W}px`);
    css.setProperty("--pb-floor", `${floorY}px`);
    css.setProperty("--pb-cx", `${Math.round(ctrlX)}px`);
    css.setProperty("--pb-cy", `${Math.round(ctrlY)}px`);
    css.setProperty("--pb-ctrl", `${clamp(W * 0.62, 52, 84)}px`);
    if (gl) gl.resize(Math.round(view.width * view.dpr), Math.round(view.height * view.dpr), view.width, view.height);
  }

  function relayout() {
    const oldWidth = view.width;
    layout();
    let pileIndex = 0;
    for (const strip of strips) {
      strip.W = lay.W;
      strip.len = lay.len;
      strip.perf = lay.perf;
      if (strip.mode === "free") {
        let cx = 0;
        for (let i = 0; i <= SEGS; i += 1) cx += strip.x[i];
        cx = (cx / (SEGS + 1)) * (view.width / Math.max(1, oldWidth));
        cx = clamp(cx, lay.len / 2 + 8, view.width - lay.len / 2 - 8);
        if (lay.len + 16 > view.width) cx = view.width / 2;
        strip.tilt = 0;
        placeLying(strip, cx);
        pileIndex += 1;
      } else {
        strip.mode = "hang";
        strip.fed = strip.len;
        placeHanging(strip, 0);
        strip.asleep = true;
      }
    }
    if (drag) drag = null;
    wake();
  }

  function pinCount(strip) {
    if (strip.mode === "free") return 0;
    if (strip.mode === "hang") return 1;
    const hid = strip.len - strip.fed;
    return Math.min(SEGS + 1, Math.floor(hid / seg(strip)) + 1);
  }

  function pinAt(strip, i, jitter) {
    const hid = strip.mode === "hang" ? 0 : strip.len - strip.fed;
    return [lay.mx + jitter, lay.my - (hid - i * seg(strip))];
  }

  function distance(strip, a, b, rest, wa, wb) {
    const dx = strip.x[b] - strip.x[a];
    const dy = strip.y[b] - strip.y[a];
    const d = Math.hypot(dx, dy) || 1e-6;
    const w = wa + wb;
    if (w <= 0) return;
    const c = (d - rest) / (d * w);
    strip.x[a] += dx * c * wa;
    strip.y[a] += dy * c * wa;
    strip.x[b] -= dx * c * wb;
    strip.y[b] -= dy * c * wb;
  }

  function straighten(strip, ax, ay, a, b, c, wa, wb, wc, k) {
    const bx = strip.x[b];
    const by = strip.y[b];
    const cx = strip.x[c];
    const cy = strip.y[c];
    const pax = a < 0 ? ax : strip.x[a];
    const pay = a < 0 ? ay : strip.y[a];
    const ex = bx - (pax + cx) / 2;
    const ey = by - (pay + cy) / 2;
    const denom = wb + wa / 4 + wc / 4;
    if (denom <= 0) return;
    const lx = (-ex / denom) * k;
    const ly = (-ey / denom) * k;
    strip.x[b] += wb * lx;
    strip.y[b] += wb * ly;
    if (a >= 0) {
      strip.x[a] -= (wa / 2) * lx;
      strip.y[a] -= (wa / 2) * ly;
    }
    strip.x[c] -= (wc / 2) * lx;
    strip.y[c] -= (wc / 2) * ly;
  }

  function collide(strip) {
    const half = strip.W / 2;
    let touching = false;
    for (let i = 0; i <= SEGS; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(SEGS, i + 1);
      let tx = strip.x[b] - strip.x[a];
      let ty = strip.y[b] - strip.y[a];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const extY = half * Math.abs(tx);
      const extX = half * Math.abs(ty);
      const floor = lay.floorY - strip.depth;
      if (strip.y[i] + extY > floor) {
        strip.y[i] = floor - extY;
        strip.oy[i] = strip.y[i];
        strip.ox[i] = strip.x[i] - (strip.x[i] - strip.ox[i]) * 0.55;
        touching = true;
      }
      if (strip.x[i] - extX < lay.wallL) {
        strip.x[i] = lay.wallL + extX;
        strip.ox[i] = strip.x[i];
      } else if (strip.x[i] + extX > lay.wallR) {
        strip.x[i] = lay.wallR - extX;
        strip.ox[i] = strip.x[i];
      }
    }
    return touching;
  }

  function grabPoint(strip) {
    const g = drag.idx;
    const f = drag.f;
    const n = Math.min(SEGS, g + 1);
    return [strip.x[g] + (strip.x[n] - strip.x[g]) * f, strip.y[g] + (strip.y[n] - strip.y[g]) * f];
  }

  function stepStrip(strip, h, target, jitter) {
    const np = pinCount(strip);
    const s = seg(strip);
    const g2 = GRAVITY * h * h;
    let fastest = 0;
    for (let i = np; i <= SEGS; i += 1) fastest = Math.max(fastest, Math.hypot(strip.x[i] - strip.ox[i], strip.y[i] - strip.oy[i]));
    const cap = fastest > MAX_STEP ? MAX_STEP / fastest : 1;
    for (let i = np; i <= SEGS; i += 1) {
      const vx = (strip.x[i] - strip.ox[i]) * DAMP * cap;
      const vy = (strip.y[i] - strip.oy[i]) * DAMP * cap;
      strip.ox[i] = strip.x[i];
      strip.oy[i] = strip.y[i];
      strip.x[i] += vx;
      strip.y[i] += vy + g2;
    }
    if (strip.mode === "free" && !target && np === 0) {
      const top = strip.y[0] < strip.y[SEGS] ? 0 : SEGS;
      const bottom = SEGS - top;
      const span = Math.hypot(strip.x[top] - strip.x[bottom], strip.y[top] - strip.y[bottom]);
      const upright = Math.abs(strip.x[top] - strip.x[bottom]) < strip.len * 0.2 && span > strip.len * 0.9;
      if (!strip.tipped && upright && strip.y[bottom] > lay.floorY - strip.depth - 4) {
        strip.tipped = true;
        strip.ox[top] -= strip.tip * 0.6;
      }
    }
    for (let i = 0; i < np; i += 1) {
      const [px, py] = pinAt(strip, i, jitter);
      strip.ox[i] = strip.x[i];
      strip.oy[i] = strip.y[i];
      strip.x[i] = px;
      strip.y[i] = py;
    }
    const w = (i) => (i < np ? 0 : 1);
    for (let it = 0; it < ITER; it += 1) {
      if (target) {
        const g = drag.idx;
        const n = Math.min(SEGS, g + 1);
        const f = drag.f;
        const [gx, gy] = grabPoint(strip);
        const k = 0.42 * strip.grabSoft;
        const dx = (target[0] - gx) * k;
        const dy = (target[1] - gy) * k;
        const w0 = w(g) * (1 - f);
        const w1 = w(n) * f;
        const den = w0 * w0 + w1 * w1;
        if (den > 1e-6) {
          strip.x[g] += (dx * w0) / den;
          strip.y[g] += (dy * w0) / den;
          if (n !== g) {
            strip.x[n] += (dx * w1) / den;
            strip.y[n] += (dy * w1) / den;
          }
        }
      }
      if (np >= 1 && np <= SEGS) {
        const b = np - 1;
        const a = b - 1;
        const [ax, ay] = a < 0 ? [lay.mx + jitter, lay.my - s] : [0, 0];
        straighten(strip, ax, ay, a, b, np, 0, 0, 1, 0.12);
      }
      for (const span of SPANS) {
        for (let i = Math.max(span, np - 1); i + span <= SEGS; i += 1) straighten(strip, 0, 0, i - span, i, i + span, w(i - span), w(i), w(i + span), BEND);
      }
      for (let i = 0; i < SEGS; i += 1) distance(strip, i, i + 1, s, w(i), w(i + 1));
      if (np >= 1 && np <= SEGS) {
        const dx = strip.x[np] - lay.mx;
        const dy = strip.y[np] - lay.my;
        const d = Math.hypot(dx, dy);
        if (d > 1 && dy > -d) {
          const ang = Math.atan2(dx, Math.max(dy, 1e-3));
          if (Math.abs(ang) > HINGE_MAX) {
            const lim = Math.sign(ang) * HINGE_MAX;
            const tx = lay.mx + Math.sin(lim) * d;
            const ty = lay.my + Math.cos(lim) * d;
            strip.x[np] += (tx - strip.x[np]) * 0.6;
            strip.y[np] += (ty - strip.y[np]) * 0.6;
          }
        }
        if (dy < 2) strip.y[np] = Math.max(strip.y[np], lay.my + 2);
      }
      if (strip.mode === "free" && it % 3 === 2) collide(strip);
    }
    if (strip.mode === "free") return collide(strip);
    return false;
  }

  function detach(strip, kick) {
    if (strip.mode === "free") return;
    const s = seg(strip);
    const ang = Math.atan2(strip.x[1] - strip.x[0], Math.max(1e-3, strip.y[1] - strip.y[0]));
    stub = { tex: strip.tex, seed: strip.seed, W: strip.W, perf: strip.perf, len: strip.len, angle: ang, av: 0, owner: strip };
    strip.mode = "free";
    strip.tornTop = true;
    strip.tear = 1;
    strip.autoTear = 0;
    strip.grabSoft = 0.15;
    strip.depth = 2 + Math.random() * 12;
    strip.tip = Math.random() < 0.5 ? -1 : 1;
    strip.tipped = false;
    for (let i = 0; i <= SEGS; i += 1) {
      strip.ox[i] = strip.x[i] - kick[0] * (i * s) / strip.len;
      strip.oy[i] = strip.y[i] - kick[1];
    }
    strip.asleep = false;
    strip.still = 0;
  }

  function startAutoTear(strip) {
    if (!strip || strip.mode !== "hang" || strip.autoTear) return;
    const lean = strip.x[SEGS] - lay.mx;
    strip.tearSide = lean > 0 ? 0 : lean < 0 ? 1 : Math.random() < 0.5 ? 0 : 1;
    strip.autoTear = reduced ? 6 : 2.6;
    strip.asleep = false;
    wake();
  }

  function frameSource(index) {
    if (video && video.readyState >= 2 && video.videoWidth) {
      const c = document.createElement("canvas");
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      c.width = 360;
      c.height = Math.round(360 * (vh / vw));
      const ctx = c.getContext("2d");
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, c.width, c.height);
      return { source: c, pose: { zoom: 1.0, cx: 0.5, cy: 0.5, rot: 0, exposure: 0.04, contrast: 1.25 } };
    }
    return { source: portrait, pose: seq.poses[index] };
  }

  function build() {
    const seed = (seedCounter += 7);
    const canvasPrint = printStrip({ mono, frames: seq.frames, seed, stamp: stampFor(new Date()) });
    seq.tex = gl.texture(canvasPrint);
    seq.seed = seed;
  }

  function startFeed() {
    if (stub) stub = null;
    const strip = makeStrip(seq.tex, (seq.seed % 97) + 0.5, 1);
    strip.mode = "feed";
    strip.fed = 0;
    for (let i = 0; i <= SEGS; i += 1) {
      const [px, py] = pinAt(strip, i, 0);
      strip.x[i] = px;
      strip.y[i] = py;
      strip.ox[i] = px;
      strip.oy[i] = py;
    }
    strips.push(strip);
    while (strips.length > MAX_STRIPS) {
      const old = strips.shift();
      if (drag && drag.strip === old) drag = null;
      gl.freeTexture(old.tex);
    }
    seq.strip = strip;
  }

  function updateSequence() {
    if (!seq) return;
    const t = time - seq.t0;
    let lampText = "";
    if (t < FLASH_AT[0] - 0.05) lampText = String(3 - Math.min(2, Math.floor(t / (COUNT_AT[1] - COUNT_AT[0]))));
    let fired = 0;
    for (let i = 0; i < FLASH_AT.length; i += 1) {
      if (t >= FLASH_AT[i]) {
        fired = i + 1;
        if (!seq.frames[i]) seq.frames[i] = frameSource(i);
      }
    }
    if (t >= BUILD_AT && !seq.tex) build();
    if (t >= CUT_AT && !seq.cut) {
      seq.cut = true;
      const old = hanging();
      if (old) startAutoTear(old);
    }
    if (t >= FEED_AT && !seq.strip) {
      const old = hanging();
      if (old) detach(old, [0, 0]);
      startFeed();
    }
    if (seq.strip) {
      const strip = seq.strip;
      const u = clamp((t - FEED_AT) / FEED_S, 0, 1);
      const e = u + (smooth(u) - u) * 0.4;
      const steps = reduced ? e : e - (Math.sin(2 * Math.PI * 24 * e) / (2 * Math.PI * 24)) * 0.55;
      if (strip.mode === "feed") strip.fed = clamp(steps, 0, 1) * strip.len;
      if (u >= 1) {
        if (strip.mode === "feed") {
          strip.mode = "hang";
          strip.fed = strip.len;
        }
        strip.dryFrom = time;
        seq = null;
        fired = 0;
      }
    }
    setLamp(lampText, fired);
  }

  function setLamp(text, fired) {
    if (shown.lamp !== text) {
      shown.lamp = text;
      if (lamp) {
        lamp.textContent = text;
        if (text) lamp.setAttribute("data-lit", "");
        else lamp.removeAttribute("data-lit");
      }
    }
    if (shown.pips !== fired) {
      shown.pips = fired;
      pips?.forEach((pip, i) => {
        if (i < fired) pip.setAttribute("data-on", "");
        else pip.removeAttribute("data-on");
      });
    }
    const busy = Boolean(seq);
    if (shown.busy !== busy) {
      shown.busy = busy;
      if (busy) root.setAttribute("data-busy", "");
      else root.removeAttribute("data-busy");
    }
  }

  function flashLevel() {
    if (!seq) return 0;
    const t = time - seq.t0;
    let v = 0;
    for (const at of FLASH_AT) {
      const d = t - at;
      if (d < 0) continue;
      const f = d < 0.035 ? d / 0.035 : Math.exp(-(d - 0.035) / 0.17);
      v = Math.max(v, f);
    }
    return v * (reduced ? 0.35 : 1);
  }

  function updateTear(strip, dt, target) {
    if (strip.mode !== "hang") return;
    if (strip.autoTear) {
      strip.tear = Math.min(1, strip.tear + strip.autoTear * dt);
      strip.tearOpen = Math.min(strip.W * 0.05, strip.tearOpen + dt * strip.W * 0.2);
      if (strip.tear >= 1) detach(strip, [strip.tearSide === 0 ? 0.8 : -0.8, 0]);
      return;
    }
    if (!target || drag?.strip !== strip) return;
    const [gx, gy] = grabPoint(strip);
    const residual = Math.hypot(target[0] - gx, target[1] - gy);
    const ang = Math.atan2(strip.x[1] - strip.x[0], Math.max(1e-3, strip.y[1] - strip.y[0]));
    const reach = Math.atan2(Math.abs(target[0] - lay.mx), Math.max(1, target[1] - lay.my));
    const drive = Math.max(0, reach - 0.22) * 220 + residual * 0.6;
    if (strip.tear <= 0) {
      if (drive > 30) {
        strip.tearSide = target[0] > lay.mx ? 0 : 1;
        strip.tear = 0.02;
      }
    } else if (drive > 10) {
      strip.tear = Math.min(1, strip.tear + (drive - 10) * 0.028 * dt);
    }
    if (strip.tear > 0) {
      const open = clamp(drive / 70, 0.15, 1) * strip.W * 0.06;
      strip.tearOpen += (open - strip.tearOpen) * Math.min(1, dt * 14);
    }
    if (strip.tear >= 1) {
      const dir = Math.sign(target[0] - gx) || Math.sign(ang) || 1;
      detach(strip, [dir * 1.2, 0]);
    }
  }

  function simulate(dt) {
    const steps = clamp(Math.round((acc += dt) / SUB), 0, 10);
    acc -= steps * SUB;
    if (acc > SUB * 4) acc = 0;
    let moving = false;
    const jitterAmp = seq?.strip && seq.strip.mode === "feed" && !reduced ? 0.35 : 0;
    for (const strip of strips) {
      if (strip.grabSoft < 1) strip.grabSoft = Math.min(1, strip.grabSoft + dt * 4.5);
      const held = drag && drag.strip === strip;
      if (strip.asleep && !held && strip.mode !== "feed" && !strip.autoTear) continue;
      let maxMove = 0;
      for (let k = 0; k < steps; k += 1) {
        const f = (k + 1) / steps;
        const target = held ? [pointer.lx + (pointer.x - pointer.lx) * f, pointer.ly + (pointer.y - pointer.ly) * f] : null;
        const jitter = jitterAmp * Math.sin((time + k * SUB) * 2 * Math.PI * 47);
        stepStrip(strip, SUB, target, jitter);
      }
      for (let i = 0; i <= SEGS; i += 1) maxMove = Math.max(maxMove, Math.abs(strip.x[i] - strip.ox[i]) + Math.abs(strip.y[i] - strip.oy[i]));
      updateTear(strip, dt, held ? [pointer.x, pointer.y] : null);
      const liftTarget = held ? 1 : strip.mode === "free" ? (maxMove > 0.6 ? 0.55 : 0) : 0.15;
      strip.lift += (liftTarget - strip.lift) * Math.min(1, dt * 6);
      if (!held && strip.mode !== "feed" && !strip.autoTear && maxMove < 0.02 && Math.abs(strip.lift - liftTarget) < 0.01) {
        strip.still += 1;
        if (strip.still > 40) {
          strip.asleep = true;
          for (let i = 0; i <= SEGS; i += 1) {
            strip.ox[i] = strip.x[i];
            strip.oy[i] = strip.y[i];
          }
        }
      } else {
        strip.still = 0;
        strip.asleep = false;
      }
      if (!strip.asleep) moving = true;
    }
    if (stub) {
      const k = 120;
      const c = 2 * Math.sqrt(k) * 0.9;
      stub.av += (-k * stub.angle - c * stub.av) * dt;
      stub.angle += stub.av * dt;
      if (Math.abs(stub.angle) > 1e-4 || Math.abs(stub.av) > 1e-3) moving = true;
      else stub.angle = 0;
    }
    pointer.lx = pointer.x;
    pointer.ly = pointer.y;
    return moving;
  }

  function buildMesh(strip) {
    return (out, extend) => {
      const half = strip.W / 2 + extend;
      const s = seg(strip);
      let o = 0;
      for (let i = 0; i <= SEGS; i += 1) {
        const a = Math.max(0, i - 1);
        const b = Math.min(SEGS, i + 1);
        let tx = strip.x[b] - strip.x[a];
        let ty = strip.y[b] - strip.y[a];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        if (i === 0 && strip.mode === "hang") {
          tx = 0;
          ty = 1;
        }
        const nx = -ty;
        const ny = tx;
        let cx = strip.x[i];
        let cy = strip.y[i];
        let sv = i * s;
        if (i === 0) {
          cx -= tx * extend;
          cy -= ty * extend;
          sv -= extend;
        } else if (i === SEGS) {
          cx += tx * extend;
          cy += ty * extend;
          sv += extend;
        }
        out[o++] = cx + nx * half;
        out[o++] = cy + ny * half;
        out[o++] = -half;
        out[o++] = sv;
        out[o++] = tx;
        out[o++] = cx - nx * half;
        out[o++] = cy - ny * half;
        out[o++] = half;
        out[o++] = sv;
        out[o++] = tx;
      }
    };
  }

  function stubMesh() {
    return (out, extend) => {
      const half = stub.W / 2 + extend;
      const length = stub.perf + 4;
      const tx = Math.sin(stub.angle);
      const ty = Math.cos(stub.angle);
      const nx = -ty;
      const ny = tx;
      let o = 0;
      const rows = [
        [lay.mx - tx * extend, lay.my - ty * extend, -extend],
        [lay.mx + tx * (length + extend), lay.my + ty * (length + extend), length + extend],
      ];
      for (const [cx, cy, sv] of rows) {
        out[o++] = cx + nx * half;
        out[o++] = cy + ny * half;
        out[o++] = -half;
        out[o++] = sv;
        out[o++] = tx;
        out[o++] = cx - nx * half;
        out[o++] = cy - ny * half;
        out[o++] = half;
        out[o++] = sv;
        out[o++] = tx;
      }
    };
  }

  function wetness(strip) {
    if (strip.dryFrom < 0) return 1;
    if (strip.wet <= 0) return 0;
    const u = clamp((time - strip.dryFrom) / DRY_S, 0, 1);
    const w = 1 - smooth(u);
    if (u >= 1) strip.wet = 0;
    return w;
  }

  function draw() {
    gl.begin();
    if (stub) {
      const mesh = stubMesh();
      gl.drawShadow(mesh, 4, { ox: 1.5, oy: 2.5, blur: 3, alpha: 0.18, w: stub.W, len: stub.perf + 4, top: 0, clip: 0, mouth: lay.my });
      gl.drawStrip(mesh, 4, {
        tex: stub.tex,
        w: stub.W,
        len: stub.len,
        perf: stub.perf,
        clip: 0,
        attached: false,
        tornTop: false,
        tornBottom: true,
        tear: 0,
        tearSide: 0,
        tearOpen: 0,
        wet: 0,
        seed: stub.seed,
        gloss: 1,
        mouth: lay.my,
      });
    }
    let drying = false;
    for (const strip of strips) {
      const mesh = buildMesh(strip);
      const count = (SEGS + 1) * 2;
      const lift = strip.lift;
      const attached = strip.mode !== "free";
      const clip = strip.mode === "feed" ? strip.len - strip.fed : 0;
      const top = strip.tornTop ? strip.perf : 0;
      gl.drawShadow(mesh, count, {
        ox: 1.5 + lift * 10,
        oy: 3 + lift * 18,
        blur: 3.5 + lift * 16,
        alpha: 0.26 - lift * 0.1,
        w: strip.W,
        len: strip.len,
        top,
        clip,
        mouth: attached ? lay.my : undefined,
      });
      const wet = wetness(strip);
      if (wet > 0 && wet < 1) drying = true;
      gl.drawStrip(mesh, count, {
        tex: strip.tex,
        w: strip.W,
        len: strip.len,
        perf: strip.perf,
        clip,
        attached,
        tornTop: strip.tornTop,
        tornBottom: false,
        tear: strip.mode === "hang" ? strip.tear : 0,
        tearSide: strip.tearSide,
        tearOpen: strip.tearOpen,
        wet,
        seed: strip.seed,
        gloss: 1,
        mouth: attached ? lay.my : undefined,
      });
    }
    return drying;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) {
      last = 0;
      return;
    }
    const dt = last ? clamp((now - last) / 1000, 0, 1 / 20) : 1 / 60;
    last = now;
    time += dt;
    updateSequence();
    const moving = simulate(dt);
    const f = flashLevel();
    if (flash) flash.style.opacity = f > 0.001 ? f.toFixed(3) : "0";
    const drying = draw();
    if (!readyFired) {
      readyFired = true;
      onReady?.();
    }
    if (moving || drying || seq || f > 0.001 || drag) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = root.getBoundingClientRect();
    return [clamp(e.clientX - rect.left, 0, rect.width), clamp(e.clientY - rect.top, 0, rect.height)];
  }

  function hit(px, py) {
    for (let k = strips.length - 1; k >= 0; k -= 1) {
      const strip = strips[k];
      const s = seg(strip);
      const clip = strip.mode === "feed" ? strip.len - strip.fed : 0;
      const top = strip.tornTop ? strip.perf : 0;
      for (let i = 0; i < SEGS; i += 1) {
        const dx = strip.x[i + 1] - strip.x[i];
        const dy = strip.y[i + 1] - strip.y[i];
        const l = Math.hypot(dx, dy) || 1;
        const tx = dx / l;
        const ty = dy / l;
        const rx = px - strip.x[i];
        const ry = py - strip.y[i];
        const along = rx * tx + ry * ty;
        const across = Math.abs(-rx * ty + ry * tx);
        if (along < -1 || along > l + 1 || across > strip.W / 2 + 8) continue;
        const sv = i * s + along;
        if (sv < Math.max(clip, top) - 2) continue;
        return { strip, idx: i, f: clamp(along / l, 0, 1) };
      }
    }
    return null;
  }

  function setAttr(name, on, key) {
    if (shown[key] === on) return;
    shown[key] = on;
    if (on) root.setAttribute(name, "");
    else root.removeAttribute(name);
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [px, py] = local(e);
    const h = hit(px, py);
    if (!h) return;
    if (e.target.closest?.("a, input")) return;
    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);
    pointer.x = pointer.lx = px;
    pointer.y = pointer.ly = py;
    drag = { strip: h.strip, idx: h.idx, f: h.f, id: e.pointerId };
    h.strip.asleep = false;
    h.strip.still = 0;
    h.strip.grabSoft = 0.35;
    h.strip.tipped = false;
    const at = strips.indexOf(h.strip);
    if (at >= 0 && h.strip.mode === "free") {
      strips.splice(at, 1);
      strips.push(h.strip);
    }
    setAttr("data-grabbing", true, "grabbing");
    wake();
  }

  function onMove(e) {
    const [px, py] = local(e);
    if (drag && e.pointerId === drag.id) {
      pointer.x = px;
      pointer.y = py;
      wake();
      return;
    }
    if (e.pointerType === "mouse") setAttr("data-hover", Boolean(hit(px, py)), "hover");
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    stage.releasePointerCapture?.(e.pointerId);
    drag = null;
    setAttr("data-grabbing", false, "grabbing");
    wake();
  }

  function onVisibility() {
    if (!document.hidden) wake();
  }

  async function init() {
    try {
      const [m, george, john, paul] = await Promise.all([
        readyMono(),
        loadImage("/cast/george.webp"),
        loadImage("/cast/john.webp").catch(() => null),
        loadImage("/cast/paul.webp").catch(() => null),
      ]);
      if (destroyed) return;
      mono = m;
      portrait = george;
      cast = [john, paul].filter(Boolean);
      gl = createBoothGL(canvas);
      if (!gl) {
        onFail?.();
        return;
      }
      layout();
      const rand = Math.random;
      const pile = cast.map((img, i) => {
        const poses = poseSet(rand);
        const tex = gl.texture(printStrip({ mono, frames: poses.map((pose) => ({ source: img, pose })), seed: 3 + i * 5, stamp: i ? "14.10.26" : "09.10.26" }));
        const strip = makeStrip(tex, 3.5 + i * 5, 0);
        strip.mode = "free";
        strip.tornTop = true;
        strip.depth = i ? 9 : 2;
        strip.tilt = 0;
        return strip;
      });
      const span = view.width;
      pile.forEach((strip, i) => {
        const cx = lay.len + 16 > span ? span / 2 + (i ? 10 : -10) : clamp(span * (i ? 0.66 : 0.3), lay.len / 2 + 10, span - lay.len / 2 - 10);
        placeLying(strip, cx);
        strips.push(strip);
      });
      const tex = gl.texture(printStrip({ mono, frames: poseSet(rand).map((pose) => ({ source: george, pose })), seed: 21, stamp: stampFor(new Date()) }));
      const hang = makeStrip(tex, 21.5, 0);
      placeHanging(hang, reduced ? 0 : 1);
      if (!reduced) {
        for (let i = 1; i <= SEGS; i += 1) hang.ox[i] = hang.x[i] - (i / SEGS) * 0.32;
      }
      strips.push(hang);
      wake();
    } catch (error) {
      console.error(error);
      onFail?.();
    }
  }

  const ro = new ResizeObserver(() => {
    if (!gl) return;
    const rect = root.getBoundingClientRect();
    if (Math.abs(rect.width - view.width) < 0.5 && Math.abs(rect.height - view.height) < 0.5) return;
    relayout();
  });
  ro.observe(root);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(root);
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  init();

  return {
    print() {
      if (seq || !gl) return false;
      seq = { t0: time, frames: [], poses: poseSet(Math.random), tex: null, strip: null, cut: false, seed: 0 };
      wake();
      return true;
    },
    tearOff() {
      startAutoTear(hanging());
    },
    setCamera(el) {
      video = el;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      if (gl) {
        for (const strip of strips) gl.freeTexture(strip.tex);
        if (seq?.tex && !seq.strip) gl.freeTexture(seq.tex);
        gl.destroy();
      }
      gl = null;
    },
  };
}
