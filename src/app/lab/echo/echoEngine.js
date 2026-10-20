import { FLUTTER_HZ, WOW_HZ, createEchoSound, noteFor } from "./echoAudio";

const FAMILY = "EchoSerif, Georgia, serif";
const INK = "rgb(238, 234, 224)";
const GROUND = "#0b0b0a";
const MAX_BLUR = 30;
const IDLE = 9;
const TAU = Math.PI * 2;

const LINES = [
  "i keep your voice on the walk home",
  "it will take a while to feel like this again",
  "you don't have to be anyone tonight",
  "still here?",
  "we can stay out till the streetlights go soft",
  "nothing good comes easy but it comes",
];

const delayFor = (u) => 0.2 * Math.pow(3, u);
const feedbackFor = (u) => 0.66 - 0.1 * u;
const allowed = (ch) => /^[a-z0-9 .,!?'’\-:;&]$/i.test(ch);

export function createEcho(stage, { embedded = false, input = null, onLive = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "echo-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Typed letters repeating down the screen like tape echoes");
  const canvas = document.createElement("canvas");
  canvas.className = "echo-canvas";
  root.append(canvas);
  stage.append(root);
  const ctx = canvas.getContext("2d");
  const meter = document.createElement("canvas").getContext("2d");

  let sound = null;
  let soundState = "off";
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let fontPx = 48;
  let side = 24;
  let top = 120;
  let availW = 300;
  let sprites = new Map();
  let raf = 0;
  let last = 0;
  let clock = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let u = 0.3;
  let uShown = 0.3;
  let dragged = false;
  let mode = "attract";
  let lastKeyAt = -Infinity;
  let blocks = [];
  let active = null;
  let script = { line: 0, i: 0, nextAt: 0.5, phase: "type" };
  let seed = 4242;
  let lastTapeSent = -1;
  let phrases = LINES.map((text) => ({ text, last: true }));

  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const font = (px) => `400 ${px}px ${FAMILY}`;

  const measure = (text, px) => {
    meter.font = font(px);
    return meter.measureText(text).width;
  };

  const sprite = (ch, b) => {
    const key = `${ch}|${b}`;
    const hit = sprites.get(key);
    if (hit) return hit;
    const px = fontPx * dpr;
    const pad = Math.ceil(b * 1.6) + 4;
    const adv = measure(ch, px);
    const w = Math.ceil(adv + px * 0.3) + pad * 2;
    const h = Math.ceil(px * 1.5) + pad * 2;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.font = font(px);
    g.fillStyle = INK;
    g.textBaseline = "alphabetic";
    const bx = pad + px * 0.1;
    const by = pad + px * 1.08;
    if (b > 0) {
      g.shadowColor = INK;
      g.shadowBlur = b;
      g.shadowOffsetX = 20000;
      g.fillText(ch, bx - 20000, by);
    } else {
      g.fillText(ch, bx, by);
    }
    const built = { c, ox: bx / dpr, oy: by / dpr, w: w / dpr, h: h / dpr };
    sprites.set(key, built);
    return built;
  };

  const layout = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.round(r.width);
    const nh = Math.round(r.height);
    if (nw === cssW && nh === cssH && nextDpr === dpr) return false;
    const oldSide = side;
    const oldFont = fontPx;
    cssW = nw;
    cssH = nh;
    dpr = nextDpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    side = Math.max(20, Math.round(cssW * 0.08));
    availW = cssW - side * 2;
    const target = Math.max(20, Math.min(64, cssH * 0.075, cssW * 0.085));
    phrases = [];
    for (const line of LINES) {
      const parts = splitLine(line, target);
      parts.forEach((text, i) => phrases.push({ text, last: i === parts.length - 1 }));
    }
    const longest = Math.max(...phrases.map((p) => measure(p.text, 100))) / 100;
    fontPx = Math.max(20, Math.min(target, availW / (longest * 1.04)));
    script.line %= phrases.length;
    top = Math.round(Math.max(88, cssH * 0.14) + fontPx * 0.9);
    sprites = new Map();
    const k = fontPx / oldFont;
    for (const block of blocks) {
      block.caret = side + (block.caret - oldSide) * k;
      for (const l of block.letters) l.x = side + (l.x - oldSide) * k;
    }
    return true;
  };

  function splitLine(line, px) {
    for (let n = 1; n <= 4; n += 1) {
      const words = line.split(" ");
      const parts = [];
      const per = line.length / n;
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (cur && next.length > per * 1.12 && parts.length < n - 1) {
          parts.push(cur);
          cur = w;
        } else cur = next;
      }
      parts.push(cur);
      if (parts.every((p) => measure(p, px) * 1.04 <= availW)) return parts;
    }
    return [line];
  }

  const pitchFor = (value) => fontPx * 1.16 * (delayFor(value) / 0.2);

  const newBlock = () => {
    if (active) leave(active);
    active = { letters: [], caret: side, born: clock, leaving: false, leaveAt: 0 };
    blocks.push(active);
    return active;
  };

  function leave(block) {
    if (block.leaving) return;
    block.leaving = true;
    block.leaveAt = clock;
    if (block === active) active = null;
  }

  const startSound = () => {
    if (soundState !== "off") return;
    soundState = "starting";
    sound = createEchoSound();
    if (!sound) {
      soundState = "failed";
      return;
    }
    sendTape(true);
    sound.enable().then((ok) => {
      soundState = ok ? "on" : "failed";
      if (ok) sendTape(true);
    });
  };

  function sendTape(force) {
    if (!sound) return;
    if (!force && Math.abs(u - lastTapeSent) < 0.002) return;
    lastTapeSent = u;
    sound.setTape(delayFor(u), feedbackFor(u));
  }

  const print = (ch) => {
    let block = active || newBlock();
    const w = measure(ch, fontPx);
    if (block.caret + w > side + availW && ch !== " ") {
      block = newBlock();
    }
    if (ch === " " && block.letters.length === 0) return;
    block.letters.push({ ch, x: block.caret, w, t: clock, shown: 0, at: [clock], jitter: rand() * TAU });
    block.caret += w;
    if (ch.trim() && sound && sound.running) sound.note(noteFor(ch), ((block.caret - w / 2) / cssW - 0.5) * 1.2, 0.85 + rand() * 0.25);
  };

  const userKey = (ch) => {
    startSound();
    if (mode === "attract") {
      mode = "user";
      if (active) leave(active);
    }
    lastKeyAt = clock;
    print(ch);
  };

  const userBreak = () => {
    startSound();
    mode = "user";
    lastKeyAt = clock;
    if (active && active.letters.length) newBlock();
  };

  const runScript = () => {
    if (mode !== "attract" || clock < script.nextAt) return;
    const phrase = phrases[script.line % phrases.length];
    const line = phrase.text;
    if (script.phase === "type") {
      if (script.i === 0) {
        newBlock();
        onLive(line);
      }
      const ch = line[script.i];
      print(ch);
      script.i += 1;
      const base = ch === " " ? 0.2 : 0.11;
      script.nextAt = clock + base + rand() * 0.09 + (/[,?.]/.test(ch) ? 0.3 : 0);
      if (script.i >= line.length) {
        script.phase = "hold";
        script.nextAt = clock + (phrase.last ? 2.6 + delayFor(u) * 7 : 0.9 + delayFor(u) * 4);
      }
    } else if (script.phase === "hold") {
      if (active) leave(active);
      script.phase = "type";
      script.line += 1;
      script.i = 0;
      script.nextAt = clock + (phrase.last ? 1.1 : 0.35);
    }
  };

  const reveal = (D, fb) => {
    const maxRows = Math.max(1, Math.ceil(Math.log(0.02) / Math.log(fb)));
    for (const block of blocks) {
      for (const l of block.letters) {
        const due = Math.min(maxRows, Math.floor((clock - l.t) / D) + 1);
        while (l.shown < due) {
          l.shown += 1;
          if (l.at.length < l.shown) l.at.push(clock);
        }
      }
    }
  };

  const draw = (D, fb, pitch) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const blurStep = fontPx * dpr * 0.055;
    const gone = [];
    for (const block of blocks) {
      let blockAlpha = 1;
      let sink = 0;
      if (block.leaving) {
        const p = Math.min(1, (clock - block.leaveAt) / 0.7);
        const e = 1 - Math.pow(1 - p, 3);
        blockAlpha = 1 - e;
        sink = e * pitch * 0.3;
        if (p >= 1) {
          gone.push(block);
          continue;
        }
      }
      for (const l of block.letters) {
        if (!l.ch.trim()) continue;
        for (let k = 0; k < l.shown; k += 1) {
          const since = clock - l.at[k];
          const fadeIn = since >= 0.09 ? 1 : 1 - Math.pow(1 - since / 0.09, 2);
          const gain = Math.pow(fb, k);
          const alpha = blockAlpha * Math.pow(gain, 0.82) * fadeIn;
          if (alpha < 0.008) continue;
          const playAt = l.t + k * D;
          const wobble = fontPx * (0.034 * Math.pow(k, 0.9) * Math.sin(TAU * WOW_HZ * playAt + 1.3) + 0.009 * k * Math.sin(TAU * FLUTTER_HZ * playAt + l.jitter));
          const drift = fontPx * 0.006 * k * Math.sin(TAU * WOW_HZ * 0.5 * clock + k * 0.9);
          const slide = fontPx * 0.016 * k * Math.sin(TAU * WOW_HZ * 0.7 * playAt + 2.1) + (1 - fadeIn) * fontPx * -0.08;
          const y = top + k * pitch + wobble + drift + sink;
          if (y - fontPx > cssH) break;
          const b = Math.min(MAX_BLUR, Math.round(k * blurStep));
          const s = sprite(l.ch, b);
          ctx.globalAlpha = alpha;
          ctx.drawImage(s.c, l.x + slide - s.ox, y - s.oy, s.w, s.h);
        }
      }
    }
    if (gone.length) blocks = blocks.filter((b) => !gone.includes(b));
    if (active) {
      const typing = clock - (active.letters.length ? active.letters[active.letters.length - 1].t : active.born);
      const blink = typing < 0.6 ? 1 : 0.5 + 0.5 * Math.cos(TAU * (typing - 0.6) * 0.9);
      ctx.globalAlpha = 0.85 * blink;
      ctx.fillStyle = INK;
      const cw = Math.max(1.5, fontPx * 0.035);
      ctx.fillRect(active.caret + fontPx * 0.06, top - fontPx * 0.74, cw, fontPx * 0.92);
    }
    ctx.globalAlpha = 1;
  };

  const step = (dt) => {
    clock += dt;
    if (!dragged && mode === "attract") {
      u = 0.32 + 0.26 * Math.sin((TAU * clock) / 16 - 0.6);
    }
    sendTape(false);
    uShown += (u - uShown) * (1 - Math.exp(-dt / 0.09));
    if (mode === "user" && clock - lastKeyAt > IDLE) {
      mode = "attract";
      if (active) leave(active);
      script = { line: script.line + 1, i: 0, nextAt: clock + 1.2, phase: "type" };
    }
    runScript();
    const D = delayFor(uShown);
    const fb = feedbackFor(uShown);
    reveal(D, fb);
    return { D, fb, pitch: pitchFor(uShown) };
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min(1 / 20, Math.max(0.001, (now - last) / 1000));
    last = now;
    const s = step(dt);
    draw(s.D, s.fb, s.pitch);
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    sound?.resume();
    raf = requestAnimationFrame(frame);
  };

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sound?.suspend();
  };

  const editable = (t) => t && t !== root && t !== document.body && t !== input && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable);

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target === input || editable(e.target)) return;
    if (e.key === "Enter") {
      userBreak();
      e.preventDefault();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      startSound();
      dragged = true;
      u = Math.max(0, Math.min(1, u + (e.key === "ArrowDown" ? 0.08 : -0.08)));
      e.preventDefault();
    } else if (e.key.length === 1 && allowed(e.key)) {
      userKey(e.key.toLowerCase());
      e.preventDefault();
    }
  };

  let lastInput = "";
  const onInput = () => {
    const value = input.value;
    if (value.length > lastInput.length) {
      const added = value.startsWith(lastInput) ? value.slice(lastInput.length) : value.slice(-1);
      for (const ch of added) if (allowed(ch)) userKey(ch.toLowerCase());
    }
    lastInput = value;
    if (value.length > 40) {
      input.value = "";
      lastInput = "";
    }
  };

  const onInputKey = (e) => {
    if (e.key === "Enter") {
      userBreak();
      input.value = "";
      lastInput = "";
    }
  };

  let drag = null;
  const onDown = (e) => {
    startSound();
    drag = { id: e.pointerId, y: e.clientY, u0: u, moved: false };
    root.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 6) {
      drag.moved = true;
      dragged = true;
      root.dataset.dragging = "";
    }
    if (drag.moved) u = Math.max(0, Math.min(1, drag.u0 + dy / (cssH * 0.7)));
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tapped = !drag.moved;
    drag = null;
    delete root.dataset.dragging;
    if (tapped && input) input.focus({ preventScroll: true });
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout();
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  const begin = () => {
    if (destroyed) return;
    layout();
    const line = phrases[0].text;
    const warm = 9;
    for (let i = 0; i < Math.round(warm * 60); i += 1) {
      step(1 / 60);
      if (script.line > 0 || (script.phase === "type" && script.i > line.length * 0.62 && script.line === 0)) break;
    }
    const s = step(1 / 60);
    draw(s.D, s.fb, s.pitch);
    ready = true;
    root.dataset.ready = "";
    wake();
  };

  const fontReady = document.fonts && document.fonts.load ? document.fonts.load("400 48px EchoSerif") : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 1500))]).then(begin, begin);

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      keyTarget.removeEventListener("keydown", onKey);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("keydown", onInputKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      root.remove();
    },
  };
}
