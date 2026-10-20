import { createAudio } from "./smearAudio";

const FAMILY = '"Smear Arimo", Arimo, Arial, "Helvetica Neue", sans-serif';
const MAX_DPR = 2;
const HIST = 32;
const COPIES = 5;
const COPY_STEP = 18;
const SHUTTER = 42;
const STREAK = 7;
const MAX_SPEED = 4200;
const HOLD_MS = 380;
const SLOP = 8;
const REST_MS = 3000;
const IDLE_MS = 3200;
const SET_K = 210;
const GLOW_SCALE = 0.25;
const HALO_SCALE = 0.0833;
const GLOW_FADE = 210;
const GLOW_STEP = 24;
const GLOW_TAIL = 18;

export const POEM = [
  "it’s been a long, long winter",
  "since i learned the way you laugh",
  "it’s been three hours now",
  "since i walked you to the train",
  "and when i get home late",
  "i leave the hall light on",
  "and when the radio plays our song",
  "i turn it up and then down",
  "i do miss you, i do",
  "and when the streetlights go soft",
  "i keep your voice on the walk home",
  "the kettle starts to sing",
  "i feel small and i feel fine",
  "and i would call but it is late",
  "and saying it out loud is hard",
  "so i will write it here instead",
  "and i won’t stay up too long",
  "but you were the light i needed",
  "and nothing good comes easy",
  "but it comes",
];

function hash(n) {
  const x = Math.sin(n * 91.7 + 13.13) * 24634.6345;
  return x - Math.floor(x);
}

export function createSmear(root, refs, { onReady } = {}) {
  const stage = refs.stage;
  const canvas = document.createElement("canvas");
  canvas.className = "smear-canvas";
  canvas.setAttribute("aria-hidden", "true");
  stage.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const meter = document.createElement("canvas").getContext("2d");
  const glow = document.createElement("canvas");
  const gctx = glow.getContext("2d");
  const halo = document.createElement("canvas");
  const hctx = halo.getContext("2d");
  let glowDirty = false;
  const audio = createAudio();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let F = 18;
  let LH = 26;
  let ascent = 14;
  let words = [];
  let rows = [];
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let ready = false;
  let still = 0;
  let press = null;
  let scattered = false;
  let seed = 0;
  let audioAt = 0;
  let avail = { top: 0, bottom: 0 };
  let blockLeft = 0;
  let blockTop = 0;
  let mode = 1;
  let wave = 0;
  let lastInput = 0;
  let ambientTimer = 0;
  let turnAt = 0;

  const font = (size) => `400 ${size}px ${FAMILY}`;

  const build = () => {
    words = [];
    rows = [];
    let id = 0;
    POEM.forEach((line, li) => {
      const row = [];
      line.split(" ").forEach((text, col) => {
        const word = {
          id,
          text,
          line: li,
          col,
          w: 0,
          tx: 0,
          ty: 0,
          ax: 0,
          bx: 0,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          ox: 0,
          oy: 0,
          back: 0,
          delay: 0,
          flip: -1,
          shown: true,
          peak: 0,
          k: 64 + hash(id + 7) * 22,
          kk: 0,
          hx: new Float32Array(HIST),
          hy: new Float32Array(HIST),
          ht: new Float64Array(HIST),
          head: 0,
          count: 0,
          idle: 0,
          sprites: null,
          lit: 0,
        };
        words.push(word);
        row.push(word);
        id += 1;
      });
      rows.push(row);
    });
  };

  const readInsets = () => {
    const box = root.getBoundingClientRect();
    const top = refs.caption ? refs.caption.getBoundingClientRect().bottom - box.top : 0;
    const bottom = refs.controls ? box.bottom - refs.controls.getBoundingClientRect().top : 0;
    avail = { top: Math.max(top + 24, 24), bottom: Math.max(bottom + 24, 24) };
  };

  const makeSprite = (word, color) => {
    const c = document.createElement("canvas");
    c.width = Math.ceil((word.w + 4) * dpr);
    c.height = Math.ceil(LH * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.font = font(F);
    g.fillStyle = color;
    g.textBaseline = "alphabetic";
    g.fillText(word.text, 2, ascent);
    return c;
  };

  const layout = () => {
    const ah = H - avail.top - avail.bottom;
    const aw = W - 40;
    F = Math.max(11, Math.min(19, Math.floor(ah / (POEM.length * 1.4))));
    LH = Math.round(F * 1.4);
    ascent = Math.round(LH * 0.5 + F * 0.36);
    meter.font = font(F);
    const space = meter.measureText(" ").width;
    for (const word of words) word.w = meter.measureText(word.text).width;
    const natural = rows.map((row) => row.reduce((s, w) => s + w.w, 0) + space * (row.length - 1));
    const measure = Math.min(aw, Math.max(F * 19, Math.max(...natural) * 1.36));
    blockLeft = Math.round((W - measure) / 2);
    blockTop = Math.round(avail.top + (ah - POEM.length * LH) / 2);
    rows.forEach((row, li) => {
      const sum = row.reduce((s, w) => s + w.w, 0);
      const free = row.length > 1 ? (measure - sum) / (row.length - 1) : 0;
      const cap = F * (3.6 + hash(li * 3 + 1) * 2.2);
      const gap = Math.max(space, Math.min(free, cap));
      let a = blockLeft;
      let b = blockLeft;
      row.forEach((word) => {
        word.ax = a;
        word.bx = b;
        word.ty = blockTop + li * LH;
        a += word.w + space;
        b += word.w + gap;
      });
    });
    for (const word of words) {
      word.tx = mode ? word.bx : word.ax;
      word.sprites = {
        white: makeSprite(word, "#f4f3ee"),
        warm: makeSprite(word, "#e9e4cf"),
        r: makeSprite(word, "#f43a2e"),
        g: makeSprite(word, "#2ef06a"),
        b: makeSprite(word, "#3a66ff"),
        ember: makeSprite(word, "#dcdcd8"),
      };
    }
  };

  const resetHistory = (word) => {
    word.count = 0;
    word.head = 0;
  };

  const record = (word, t) => {
    word.head = (word.head + 1) % HIST;
    word.hx[word.head] = word.x;
    word.hy[word.head] = word.y;
    word.ht[word.head] = t;
    word.count = Math.min(HIST, word.count + 1);
  };

  const sample = (word, t, outp) => {
    let i = word.head;
    for (let n = 0; n < word.count - 1; n += 1) {
      const j = (i - 1 + HIST) % HIST;
      if (word.ht[j] <= t) {
        const span = word.ht[i] - word.ht[j];
        const f = span > 0 ? (t - word.ht[j]) / span : 0;
        outp[0] = word.hx[j] + (word.hx[i] - word.hx[j]) * f;
        outp[1] = word.hy[j] + (word.hy[i] - word.hy[j]) * f;
        return true;
      }
      i = j;
    }
    return false;
  };

  const arrive = (lead = 0) => {
    scattered = false;
    mode = 1;
    for (const word of words) {
      word.ox = 0;
      word.oy = 0;
      word.back = 0;
      word.flip = -1;
      word.kk = 0;
      word.tx = word.bx;
      const far = W * 0.42 + word.col * F * 2.6 + hash(word.id) * F * 6;
      word.x = word.tx + far;
      word.y = word.ty;
      word.vx = -1800 - hash(word.id + 3) * 900;
      word.vy = 0;
      word.delay = Math.max(0, word.line * 0.1 + word.col * 0.035 - lead);
      word.shown = word.delay <= 0;
      word.peak = 0;
      word.lit = 0;
      resetHistory(word);
    }
    scheduleAmbient(5200);
    wake();
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const prevW = W;
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    glow.width = Math.max(1, Math.ceil(W * GLOW_SCALE));
    glow.height = Math.max(1, Math.ceil(H * GLOW_SCALE));
    halo.width = Math.max(1, Math.ceil(W * HALO_SCALE));
    halo.height = Math.max(1, Math.ceil(H * HALO_SCALE));
    clearGlow();
    readInsets();
    layout();
    if (ready && prevW) {
      for (const word of words) {
        if (word.delay <= 0 && !scattered) {
          word.x = word.tx;
          word.y = word.ty;
          word.vx = 0;
          word.vy = 0;
          resetHistory(word);
        }
      }
    }
    wake();
  };

  const turn = () => {
    if (destroyed || scattered || press) return;
    mode = mode ? 0 : 1;
    wave += 1;
    const fromTop = wave % 4 < 2;
    for (const word of words) {
      const li = fromTop ? word.line : POEM.length - 1 - word.line;
      const dir = mode ? 1 : -1;
      const order = dir > 0 ? rows[word.line].length - 1 - word.col : word.col;
      word.flip = li * 0.075 + order * 0.022 + hash(word.id * 5 + wave) * 0.03;
      word.lit = 0.6;
    }
    wake();
  };

  function scheduleAmbient(ms = REST_MS) {
    clearTimeout(ambientTimer);
    if (destroyed) return;
    turnAt = performance.now() + ms;
    const check = () => {
      if (destroyed) return;
      const now = performance.now();
      if (turnAt - now > ms + 50) turnAt = now + ms;
      if (lastInput > now) lastInput = now - IDLE_MS;
      if (now < turnAt - 4) {
        ambientTimer = setTimeout(check, Math.max(16, turnAt - now));
        return;
      }
      const quiet = now - lastInput;
      if (!visible || document.hidden || press || scattered || quiet < IDLE_MS) {
        scheduleAmbient(Math.max(600, IDLE_MS - quiet + 200));
        return;
      }
      turn();
      scheduleAmbient(REST_MS + POEM.length * 75);
    };
    ambientTimer = setTimeout(check, ms);
  }

  const step = (dt) => {
    let moving = false;
    let energy = 0;
    let ex = 0;
    let ew = 0;
    for (const word of words) {
      if (word.delay > 0) {
        word.delay -= dt;
        moving = true;
        if (word.delay > 0) continue;
        word.shown = true;
        resetHistory(word);
      }
      if (word.flip >= 0) {
        word.flip -= dt;
        moving = true;
        if (word.flip < 0) {
          word.tx = mode ? word.bx : word.ax;
          word.kk = SET_K;
          word.vx += (word.tx - word.x) * 7;
          word.quiet = true;
        }
      }
      if (word.back > 0) {
        word.back -= dt;
        moving = true;
        if (word.back <= 0) {
          word.ox = 0;
          word.oy = 0;
        }
      }
      const k = scattered ? 26 : word.kk || word.k;
      const c = 2 * Math.sqrt(k) * (scattered ? 1.1 : word.kk ? 1 : 0.94);
      const gx = word.tx + word.ox;
      const gy = word.ty + word.oy;
      word.vx += ((gx - word.x) * k - word.vx * c) * dt;
      word.vy += ((gy - word.y) * k - word.vy * c) * dt;
      const sp = Math.hypot(word.vx, word.vy);
      if (sp > MAX_SPEED) {
        word.vx *= MAX_SPEED / sp;
        word.vy *= MAX_SPEED / sp;
      }
      word.x += word.vx * dt;
      word.y += word.vy * dt;
      const off = Math.abs(gx - word.x) + Math.abs(gy - word.y);
      const speed = Math.abs(word.vx) + Math.abs(word.vy);
      word.peak = Math.max(word.peak, speed);
      if (word.peak > 500 && speed < 60 && off < 3) {
        word.peak = 0;
        if (!word.quiet) audio.land((word.x / W) * 1.6 - 0.8, word.line);
        else if (word.col === 0) audio.land((word.x / W) * 1.6 - 0.8, word.line, 0.45);
      }
      if (off > 0.08 || speed > 0.8) {
        moving = true;
        word.idle = 0;
      } else {
        word.x = gx;
        word.y = gy;
        word.vx = 0;
        word.vy = 0;
        word.idle += dt;
        word.kk = 0;
        word.quiet = false;
      }
      energy += Math.min(speed, 2400);
      ex += word.x * speed;
      ew += speed;
    }
    return { moving, energy: energy / (words.length * 900), pan: ew > 0 ? (ex / ew / W) * 1.6 - 0.8 : 0 };
  };

  const tmp = [0, 0];

  function clearGlow() {
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = "source-over";
    gctx.globalAlpha = 1;
    gctx.fillStyle = "#000";
    gctx.fillRect(0, 0, glow.width, glow.height);
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.fillStyle = "#000";
    hctx.fillRect(0, 0, halo.width, halo.height);
    glowDirty = false;
  }

  const expose = (now, dt) => {
    let any = false;
    for (const word of words) {
      word.lit = Math.max(0, word.lit - dt * 0.9);
      if (word.shown && word.lit > 0.01 && word.count > 1) any = true;
    }
    if (!any) {
      if (glowDirty) clearGlow();
      return;
    }
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = "source-over";
    gctx.globalAlpha = 1;
    gctx.fillStyle = "#000";
    gctx.fillRect(0, 0, glow.width, glow.height);
    gctx.setTransform(GLOW_SCALE, 0, 0, GLOW_SCALE, 0, 0);
    gctx.globalCompositeOperation = "lighter";
    let deposited = false;
    for (const word of words) {
      if (!word.shown || !word.sprites || word.lit <= 0.01 || word.count < 2) continue;
      const sp = word.sprites.ember;
      const sw = sp.width / dpr;
      const sh = sp.height / dpr;
      const speed = Math.min(1, Math.abs(word.vx) / 1400);
      if (speed > 0.08) {
        gctx.globalAlpha = 0.4 * word.lit * speed;
        gctx.drawImage(sp, word.x - 2, word.y, sw, sh);
        deposited = true;
      }
      for (let j = 1; j <= GLOW_TAIL; j += 1) {
        const age = j * GLOW_STEP;
        if (!sample(word, now - age, tmp)) break;
        const dx = Math.abs(tmp[0] - word.x);
        if (dx < 2) continue;
        gctx.globalAlpha = 0.38 * word.lit * Math.min(1, dx / 48) * Math.exp(-age / GLOW_FADE);
        gctx.drawImage(sp, tmp[0] - 2, tmp[1], sw, sh);
        deposited = true;
      }
    }
    if (!deposited) {
      if (glowDirty) clearGlow();
      return;
    }
    glowDirty = true;
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.globalCompositeOperation = "source-over";
    hctx.globalAlpha = 1;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(glow, 0, 0, halo.width, halo.height);
  };

  const drawGlow = () => {
    if (!glowDirty) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 0.3;
    ctx.drawImage(glow, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.drawImage(halo, 0, 0, W, H);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(halo, 0, 0, W, H);
  };

  const draw = (now) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGlow();
    for (const word of words) {
      if (!word.shown || !word.sprites || word.idle >= 0.25 || word.count < 2) continue;
      const sp = word.sprites;
      const sw = sp.white.width / dpr;
      const sh = sp.white.height / dpr;
      ctx.globalCompositeOperation = "lighter";
      for (let j = COPIES; j >= 1; j -= 1) {
        if (!sample(word, now - SHUTTER - j * COPY_STEP, tmp)) continue;
        const dx = tmp[0] - word.x;
        const dy = tmp[1] - word.y;
        if (dx * dx + dy * dy < 4) continue;
        const fade = 1 - j / (COPIES + 1);
        ctx.globalAlpha = 0.34 * fade * fade;
        ctx.drawImage(sp.warm, tmp[0] - 2, tmp[1], sw, sh);
      }
      for (let j = STREAK; j >= 1; j -= 1) {
        if (!sample(word, now - (j / STREAK) * SHUTTER, tmp)) continue;
        const dx = tmp[0] - word.x;
        if (dx * dx < 1) continue;
        ctx.globalAlpha = 0.16 * (1 - j / (STREAK + 2));
        ctx.drawImage(sp.white, tmp[0] - 2, tmp[1], sw, sh);
      }
    }
    for (const word of words) {
      if (!word.shown || !word.sprites) continue;
      const sp = word.sprites;
      const sw = sp.white.width / dpr;
      const sh = sp.white.height / dpr;
      const speed = Math.abs(word.vx);
      if (speed > 40) {
        const split = Math.min(3.2, speed * 0.0016);
        const dir = Math.sign(word.vx);
        const settle = Math.min(1, speed / 400);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = settle;
        ctx.drawImage(sp.r, word.x - 2 - dir * split, word.y, sw, sh);
        ctx.drawImage(sp.g, word.x - 2, word.y, sw, sh);
        ctx.drawImage(sp.b, word.x - 2 + dir * split * 0.6, word.y, sw, sh);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1 - settle;
        if (ctx.globalAlpha > 0.02) ctx.drawImage(sp.white, word.x - 2, word.y, sw, sh);
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.drawImage(sp.white, word.x - 2, word.y, sw, sh);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    let moving = false;
    let energy = 0;
    let pan = 0;
    const sub = 2;
    for (let i = 0; i < sub; i += 1) {
      const r = step(dt / sub);
      moving = r.moving || moving;
      energy = r.energy;
      pan = r.pan;
    }
    for (const word of words) if (word.shown) record(word, now);
    expose(now, dt);
    draw(now);
    if (now - audioAt > 33) {
      audioAt = now;
      audio.motion(energy, pan);
    }
    if (moving || press || glowDirty || words.some((w) => w.lit > 0.01)) {
      still = 0;
      wake();
    } else if (still < 16) {
      still += 1;
      wake();
    } else {
      last = 0;
      audio.quiet();
    }
  };

  function wake() {
    if (raf || destroyed || !visible || document.hidden || !W) return;
    raf = requestAnimationFrame(frame);
  }

  const local = (e) => {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const touch = () => {
    lastInput = performance.now();
  };

  const scatter = () => {
    scattered = true;
    seed += 1;
    for (const word of words) {
      if (word.delay > 0) {
        word.delay = 0;
        word.shown = true;
        resetHistory(word);
      }
      word.flip = -1;
      word.kk = 0;
      word.tx = mode ? word.bx : word.ax;
      const spread = 1.5 + hash(word.line * 7 + seed) * 2.6;
      const shift = Math.max(12 - blockLeft, (hash(word.line * 13 + seed * 3) - 0.35) * W * 0.5);
      const target = blockLeft + (word.tx - blockLeft) * spread + shift;
      word.ox = target - word.tx;
      word.oy = 0;
      word.back = 0;
      word.lit = 0.6;
    }
    root.setAttribute("data-scattered", "");
    wake();
  };

  const gather = () => {
    if (!scattered) return;
    scattered = false;
    for (const word of words) {
      word.back = 0.04 + word.line * 0.07 + word.col * 0.012;
      word.lit = 0.6;
    }
    root.removeAttribute("data-scattered");
    touch();
    wake();
  };

  const push = (p, vx, vy) => {
    const rx = Math.max(28, F * 1.8);
    const ry = LH * 1.25;
    for (const word of words) {
      if (!word.shown) continue;
      const cxw = word.x + word.w / 2;
      const cyw = word.y + LH / 2;
      const dx = Math.max(0, Math.abs(p.x - cxw) - word.w / 2);
      const dy = Math.abs(p.y - cyw);
      if (dx > rx || dy > ry) continue;
      const f = (1 - dx / rx) * (1 - dy / ry);
      const fall = f * f;
      word.vx += vx * 0.55 * fall;
      word.lit = Math.min(1, word.lit + fall * 1.5);
      word.vy += vy * 0.12 * fall;
      const limit = W * 0.5;
      if (Math.abs(word.x - word.tx) > limit) word.vx *= 0.5;
    }
  };

  const ripple = (p) => {
    for (const word of words) {
      if (!word.shown) continue;
      const dy = Math.abs(word.y + LH / 2 - p.y) / LH;
      if (dy > 2.6) continue;
      const cxw = word.x + word.w / 2;
      const side = cxw < p.x ? -1 : 1;
      const near = Math.max(0, 1 - Math.abs(cxw - p.x) / (W * 0.6));
      const reach = Math.pow(1 - dy / 2.6, 2);
      word.vx += side * (900 + 700 * near) * reach;
      word.lit = Math.min(1, word.lit + reach * 0.8);
    }
    wake();
  };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    audio.unlock();
    touch();
    const p = local(e);
    stage.setPointerCapture?.(e.pointerId);
    press = { id: e.pointerId, x0: p.x, y0: p.y, lx: p.x, ly: p.y, lt: performance.now(), vx: 0, vy: 0, mode: "pending", timer: 0 };
    press.timer = setTimeout(() => {
      if (press && press.mode === "pending") {
        press.mode = "hold";
        press.holdAt = performance.now();
        scatter();
      }
    }, HOLD_MS);
    root.setAttribute("data-pressing", "");
    wake();
  };

  const onMove = (e) => {
    if (!press || press.id !== e.pointerId) return;
    touch();
    const p = local(e);
    const now = performance.now();
    const dt = Math.max(1, now - press.lt) / 1000;
    const ivx = (p.x - press.lx) / dt;
    const ivy = (p.y - press.ly) / dt;
    press.vx = press.vx * 0.4 + ivx * 0.6;
    press.vy = press.vy * 0.4 + ivy * 0.6;
    if (press.mode === "hold" && now - press.holdAt < 160 && Math.hypot(p.x - press.x0, p.y - press.y0) > SLOP) {
      press.mode = "drag";
      gather();
    }
    if (press.mode === "pending" && Math.hypot(p.x - press.x0, p.y - press.y0) > SLOP) {
      press.mode = "drag";
      clearTimeout(press.timer);
    }
    if (press.mode === "drag") {
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - press.lx, p.y - press.ly) / 12));
      const cap = 2600;
      const vx = Math.max(-cap, Math.min(cap, press.vx));
      const vy = Math.max(-cap, Math.min(cap, press.vy));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        push({ x: press.lx + (p.x - press.lx) * t, y: press.ly + (p.y - press.ly) * t }, vx / steps, vy / steps);
      }
    }
    press.lx = p.x;
    press.ly = p.y;
    press.lt = now;
    wake();
  };

  const onUp = (e) => {
    if (!press || press.id !== e.pointerId) return;
    clearTimeout(press.timer);
    touch();
    const mode0 = press.mode;
    const p = { x: press.lx, y: press.ly };
    press = null;
    root.removeAttribute("data-pressing");
    if (mode0 === "hold") gather();
    else if (mode0 === "pending" && e.type === "pointerup") ripple(p);
    wake();
  };

  const onKeyDown = (e) => {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (e.repeat) return;
      audio.unlock();
      touch();
      scatter();
    } else if (e.key === "Enter") {
      e.preventDefault();
      audio.unlock();
      touch();
      arrive();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      audio.unlock();
      touch();
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      for (const word of words) {
        word.vx += dir * (1400 + hash(word.id) * 900);
        word.lit = 0.8;
      }
      wake();
    }
  };

  const onKeyUp = (e) => {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      gather();
    }
  };

  const onVisibility = () => {
    if (!document.hidden) {
      last = 0;
      wake();
    } else {
      audio.quiet();
    }
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKeyDown);
  stage.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      last = 0;
      wake();
    } else {
      audio.quiet();
    }
  });
  io.observe(root);
  const ro = new ResizeObserver(() => resize());

  const start = () => {
    if (destroyed) return;
    build();
    ro.observe(stage);
    resize();
    arrive(0.55);
    ready = true;
    onReady?.();
  };

  const fontReady = document.fonts ? document.fonts.load(font(18), "a").catch(() => null) : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))]).then(start);

  return {
    replay() {
      audio.unlock();
      touch();
      arrive();
    },
    setSound(on) {
      return audio.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(ambientTimer);
      if (press) clearTimeout(press.timer);
      io.disconnect();
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKeyDown);
      stage.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      audio.destroy();
      canvas.remove();
    },
  };
}
