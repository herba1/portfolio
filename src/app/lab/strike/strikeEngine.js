import { createStrikeSound } from "./strikeAudio";
import { createInk, seeded } from "./strikeInk";

const FAMILY = "StrikeType";
const PAGE_LINES = 30;
const LETTERS = [
  "dear june,\n\ni found the record you left here, the one with the scratch on side two. i play it anyway. the skip has become my favourite part.\n\nit's colder now. the streetlights come on before i'm home, and i still walk the long way.\n\nwrite when you can. i'll keep the kettle on.\n\nlove,\nh.",
  "dear sam,\n\ni know it's been a while. i wanted to say that the night you drove me home with the windows down still counts as one of the good ones.\n\nnothing good comes easy, but it comes.\n\ni hope you're sleeping better.\n\nyours,\nh.",
  "mum,\n\nthe garden is doing what it wants this year. the tomatoes came up anyway.\n\ni've been thinking about how you always left the porch light on. i do it now too.\n\nsee you sunday.\n\nh.",
];
const MAP = { "‘": "'", "’": "'", "“": '"', "”": '"', "—": "-", "–": "-", "…": "..." };

function paperTile() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const r = seeded(9001);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const m = Math.sin((TAU * x) / size + 0.7) * Math.sin((TAU * 2 * y) / size) * 0.5 + Math.sin((TAU * 3 * (x + y)) / size) * 0.5;
      const n = (r() - 0.5) * 6 + m * 1.6;
      const i = (y * size + x) * 4;
      img.data[i] = 245 + n;
      img.data[i + 1] = 241 + n;
      img.data[i + 2] = 231 + n * 0.9;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  for (let f = 0; f < 220; f += 1) {
    const x = r() * size;
    const y = r() * size;
    const a = r() * TAU;
    const l = 3 + r() * 9;
    g.strokeStyle = r() < 0.5 ? "rgba(120,100,70,0.045)" : "rgba(255,255,250,0.16)";
    g.lineWidth = 0.5 + r() * 0.5;
    g.beginPath();
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + Math.cos(a + 0.25) * l * 0.5, y + dy + Math.sin(a + 0.25) * l * 0.5, x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
      }
    }
    g.stroke();
  }
  return c.toDataURL("image/png");
}

function wrap(text, width) {
  const out = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export function createStrike(stage, { embedded = false, onLive, onGesture } = {}) {
  const root = document.createElement("div");
  root.className = "strike-surface";
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");
  root.setAttribute("aria-label", "A sheet of paper in a typewriter. Type to strike letters, Enter returns the carriage.");
  const sheet = document.createElement("div");
  sheet.className = "strike-sheet";
  const canvas = document.createElement("canvas");
  canvas.className = "strike-ink";
  sheet.append(canvas);
  const guide = document.createElement("div");
  guide.className = "strike-guide";
  const input = document.createElement("input");
  input.className = "strike-input";
  input.type = "text";
  input.autocapitalize = "none";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Type on the sheet");
  input.setAttribute("enterkeyhint", "enter");
  root.append(sheet, guide, input);
  stage.append(root);
  sheet.style.setProperty("--strike-paper", `url(${paperTile()})`);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const ink = createInk(FAMILY);
  const sound = createStrikeSound();
  const rand = seeded(20261021);

  let W = 0;
  let H = 0;
  let dpr = 1;
  const m = { size: 18, charW: 10.8, lineH: 28, margin: 56, top: 72, cols: 60, sheetW: 700, sheetH: 1000, dpr: 1 };
  let strikeY = 0;
  let k = 0.5;

  let strikes = [];
  let line = 0;
  let col = 0;
  let belled = false;
  let carX = 0;
  let carV = 0;
  let carTween = null;
  let lineF = 0;
  let lineTween = null;
  let bump = 0;
  let feed = null;
  let feedOffset = 0;

  let auto = null;
  let letterIndex = 0;
  let userTyped = false;
  let lastUserAt = 0;
  let lastStrikeAt = 0;
  let destroyed = false;
  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let ready = false;

  const layout = () => {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    m.dpr = dpr;
    m.size = W >= 900 ? 19 : W >= 600 ? 17 : Math.max(12, Math.min(15, Math.round(W / 26)));
    ctx.font = `${m.size}px ${FAMILY}`;
    m.charW = ctx.measureText("m").width || m.size * 0.6;
    m.lineH = Math.max(16, Math.round((m.size * 1.5) / 4) * 4);
    m.margin = Math.round(Math.max(20, Math.min(64, W * 0.06)));
    const maxText = Math.min(64 * m.charW, W - 24 - m.margin * 2);
    m.cols = Math.max(20, Math.floor(maxText / m.charW));
    m.sheetW = Math.round(m.cols * m.charW + m.margin * 2);
    m.top = Math.round(m.lineH * 2.5);
    m.sheetH = Math.round(m.top + PAGE_LINES * m.lineH + m.lineH * 3);
    const centerX = (W - m.sheetW) / 2;
    k = centerX < 48 ? 0 : Math.max(0, Math.min(0.5, (centerX + m.margin - 8) / ((m.cols * m.charW) / 2)));
    strikeY = Math.round(H * (W < 600 ? 0.42 : 0.58));
    canvas.width = Math.round(m.sheetW * dpr);
    canvas.height = Math.round(m.sheetH * dpr);
    sheet.style.width = `${m.sheetW}px`;
    sheet.style.height = `${m.sheetH}px`;
    guide.style.width = `${m.charW}px`;
    redraw();
    place();
  };

  const posOf = (s) => {
    s.x = m.margin + s.col * m.charW;
    s.y = m.top + s.line * m.lineH;
  };

  const redraw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strikes) {
      posOf(s);
      ink.strike(ctx, s, m);
    }
  };

  const place = () => {
    const centerX = (W - m.sheetW) / 2;
    const sheetX = centerX - (carX - m.cols / 2) * m.charW * k;
    const sheetY = strikeY - (m.top + lineF * m.lineH) + bump + feedOffset;
    sheet.style.transform = `translate3d(${sheetX}px, ${sheetY}px, 0)`;
    const gx = sheetX + m.margin + carX * m.charW;
    guide.style.transform = `translate3d(${gx}px, ${strikeY + Math.round(m.size * 0.3)}px, 0)`;
  };

  const wake = () => {
    if (running && !raf && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const pan = () => (col / m.cols - 0.5) * 1.2;

  const strikeChar = (raw, now) => {
    const ch = MAP[raw] ?? raw;
    if (ch.length > 1) {
      for (const c of ch) strikeChar(c, now);
      return;
    }
    if (col >= m.cols) carriageReturn(now);
    const gap = now - lastStrikeAt;
    lastStrikeAt = now;
    if (ch === " ") {
      sound?.space(pan());
      advance();
      return;
    }
    if (!/[\x21-\x7eÀ-ÿ]/.test(ch)) return;
    const force = 0.82 + Math.min(0.3, gap / 900) + (rand() - 0.5) * 0.18;
    const s = {
      ch,
      line,
      col,
      rx: rand(),
      ry: rand(),
      ta: (rand() - 0.5) * 0.8,
      tiltMul: 0.6 + rand() * 0.9,
      density: Math.min(1.1, 0.8 + force * 0.24 + (rand() - 0.5) * 0.18),
      weight: 0.6 + force * 0.5 + (ink.heavy(ch) ? 0.6 : 0),
      jx: (rand() - 0.5) * 0.5,
      jy: (rand() - 0.5) * 0.9,
      rot: (rand() - 0.5) * 0.018,
      clog: rand() < 0.6,
      ghost: rand() < 0.055 ? (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5) : 0,
    };
    posOf(s);
    strikes.push(s);
    ink.strike(ctx, s, m);
    bump = 0.6 + force * 0.5;
    sound?.strike(force, pan(), rand() - 0.5, ink.heavy(ch));
    advance();
  };

  const advance = () => {
    col += 1;
    carTween = null;
    if (!belled && col >= m.cols - 8) {
      belled = true;
      sound?.bell();
    }
    wake();
  };

  const backspace = () => {
    if (col <= 0) return;
    col -= 1;
    carTween = null;
    sound?.back(pan());
    wake();
  };

  const carriageReturn = (now) => {
    const from = carX;
    const dur = 0.16 + 0.36 * Math.min(1, from / m.cols);
    if (from > 0.5) sound?.carriage(dur);
    else sound?.carriage(0.08);
    carTween = { from, start: now, dur: Math.max(0.1, dur) * 1000 };
    col = 0;
    belled = false;
    const text = strikes.filter((s) => s.line === line).sort((a, b) => a.col - b.col);
    if (text.length) {
      let str = "";
      let c = 0;
      for (const s of text) {
        while (c < s.col) {
          str += " ";
          c += 1;
        }
        if (s.col === c) {
          str += s.ch;
          c += 1;
        }
      }
      onLive?.(str.trim());
    }
    line += 1;
    lineTween = { from: lineF, to: line, start: now + 40, dur: 220 };
    if (line >= PAGE_LINES) ejectSheet(now);
    wake();
  };

  const ejectSheet = (now) => {
    if (feed) return;
    feed = { phase: "out", start: now, dur: 900 };
    sound?.feed(0.9);
  };

  const finishEject = (now) => {
    strikes = [];
    line = 0;
    col = 0;
    lineF = 0;
    carX = 0;
    carV = 0;
    carTween = null;
    lineTween = null;
    belled = false;
    redraw();
    feed = { phase: "in", start: now, dur: 900 };
    sound?.feed(0.8);
  };

  const buildAuto = (text, now, instant = 0) => {
    const lines = wrap(text, m.cols - 3);
    const actions = [];
    lines.forEach((l, i) => {
      for (const ch of l) actions.push(ch);
      if (i < lines.length - 1) actions.push("\n");
    });
    auto = { actions, i: 0, at: now + 900, done: false, doneAt: 0 };
    for (let n = 0; n < instant; n += 1) step(now, true);
  };

  const step = (now, silent) => {
    const a = auto.actions[auto.i];
    auto.i += 1;
    const prev = auto.actions[auto.i - 2];
    if (a === "\n") {
      if (silent) {
        col = 0;
        line += 1;
        lineF = line;
        carX = 0;
      } else carriageReturn(now);
    } else if (silent) strikeCharSilent(a);
    else strikeChar(a, now);
    const next = auto.actions[auto.i];
    let delay = 55 + rand() * 80;
    if (a === " ") delay += 30 + rand() * 60;
    if (".,".includes(a)) delay += 160 + rand() * 260;
    if (a === "\n") delay = 420 + rand() * 300 + (prev === "\n" ? 300 : 0);
    if (next === "\n" && a !== "\n") delay += 260;
    if (rand() < 0.03) delay += 500 + rand() * 900;
    if (prev === " " && rand() < 0.08) delay += 300;
    auto.at = now + delay;
    if (auto.i >= auto.actions.length) {
      auto.done = true;
      auto.doneAt = now;
    }
  };

  const strikeCharSilent = (ch) => {
    if (ch === " ") {
      col += 1;
      carX = col;
      return;
    }
    const s = {
      ch,
      line,
      col,
      rx: rand(),
      ry: rand(),
      ta: (rand() - 0.5) * 0.8,
      tiltMul: 0.6 + rand() * 0.9,
      density: 0.98 + (rand() - 0.5) * 0.16,
      weight: 1 + (ink.heavy(ch) ? 0.6 : 0),
      jx: (rand() - 0.5) * 0.5,
      jy: (rand() - 0.5) * 0.9,
      rot: (rand() - 0.5) * 0.018,
      clog: rand() < 0.6,
      ghost: 0,
    };
    posOf(s);
    strikes.push(s);
    ink.strike(ctx, s, m);
    col += 1;
    carX = col;
  };

  const tick = (now) => {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    let busy = false;

    if (auto && !userTyped && !feed) {
      if (!auto.done) {
        if (now >= auto.at) step(now, false);
        busy = true;
      } else if (now - auto.doneAt > 8000) {
        letterIndex = (letterIndex + 1) % LETTERS.length;
        ejectSheet(now);
        auto = null;
        busy = true;
      } else busy = true;
    }

    if (carTween) {
      const e = Math.min(1, (now - carTween.start) / carTween.dur);
      const ease = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
      carX = carTween.from * (1 - ease);
      carV = 0;
      if (e >= 1) {
        carTween = null;
        carX = col;
      }
      busy = true;
    } else {
      const omega = 70;
      const x = carX - col;
      const decay = Math.exp(-omega * dt);
      const j = carV + omega * x;
      carX = col + (x + j * dt) * decay;
      carV = (carV - omega * j * dt) * decay;
      if (Math.abs(carX - col) < 0.002 && Math.abs(carV) < 0.01) {
        carX = col;
        carV = 0;
      } else busy = true;
    }

    if (lineTween) {
      const e = Math.max(0, Math.min(1, (now - lineTween.start) / lineTween.dur));
      const ease = 1 - Math.pow(1 - e, 3);
      lineF = lineTween.from + (lineTween.to - lineTween.from) * ease;
      if (e >= 1) lineTween = null;
      busy = true;
    }

    if (bump > 0.01) {
      bump *= Math.exp(-dt / 0.035);
      busy = true;
    } else bump = 0;

    if (feed) {
      const e = Math.min(1, (now - feed.start) / feed.dur);
      const ease = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
      if (feed.phase === "out") {
        feedOffset = -ease * (m.top + lineF * m.lineH + m.sheetH * 0.2 + H);
        if (e >= 1) finishEject(now);
      } else {
        feedOffset = (1 - ease) * (H - strikeY + m.top + 40);
        if (e >= 1) {
          feed = null;
          feedOffset = 0;
          if (!userTyped) buildAuto(LETTERS[letterIndex], now);
        }
      }
      busy = true;
    }

    guide.toggleAttribute("data-idle", now - Math.max(lastStrikeAt, lastUserAt) > 1200);
    place();
    if (busy || now - lastStrikeAt < 1600) raf = requestAnimationFrame(tick);
  };

  const setRunning = () => {
    const should = visible && document.visibilityState === "visible" && !destroyed && ready;
    if (should === running) return;
    running = should;
    if (running) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const userInput = () => {
    onGesture?.();
    lastUserAt = performance.now();
    if (!userTyped) {
      userTyped = true;
      auto = null;
    }
  };

  const typeText = (text) => {
    const now = performance.now();
    for (const ch of text) {
      if (ch === "\n" || ch === "\r") carriageReturn(now);
      else strikeChar(ch, now);
    }
  };

  const onKeyDown = (e) => {
    if (!ready || e.metaKey || e.ctrlKey || e.altKey) return;
    if (feed) {
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      userInput();
      carriageReturn(performance.now());
    } else if (e.key === "Backspace") {
      e.preventDefault();
      userInput();
      backspace();
    } else if (e.key === "Tab") {
      e.preventDefault();
      userInput();
      const target = Math.min(m.cols, (Math.floor(col / 5) + 1) * 5);
      while (col < target) advance();
      sound?.space(pan());
    } else if (e.key.length === 1 && e.target !== input) {
      e.preventDefault();
      userInput();
      typeText(e.key);
    }
  };

  const onBeforeInput = (e) => {
    if (!ready) return;
    const t = e.inputType;
    if (t === "insertText" && e.data) {
      e.preventDefault();
      if (feed) return;
      userInput();
      typeText(e.data);
    } else if (t === "insertLineBreak" || t === "insertParagraph") {
      e.preventDefault();
      if (feed) return;
      userInput();
      carriageReturn(performance.now());
    } else if (t === "deleteContentBackward") {
      e.preventDefault();
      if (feed) return;
      userInput();
      backspace();
    }
  };

  const onInput = () => {
    const v = input.value;
    if (!v) return;
    input.value = "";
    if (feed) return;
    userInput();
    typeText(v);
  };

  const focusInput = () => {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  };

  const onPointerDown = () => {
    onGesture?.();
    focusInput();
  };

  root.addEventListener("pointerdown", onPointerDown);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("beforeinput", onBeforeInput);
  input.addEventListener("input", onInput);
  const keyTarget = embedded ? root : window;
  const onOuterKey = (e) => {
    if (e.target === input) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Tab") {
      if (e.key === "Tab") return;
      onKeyDown(e);
      focusInput();
    }
  };
  keyTarget.addEventListener("keydown", onOuterKey);

  const ro = new ResizeObserver(() => {
    if (ready) layout();
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    setRunning();
  });
  io.observe(stage);
  const onVis = () => setRunning();
  document.addEventListener("visibilitychange", onVis);

  const boot = async () => {
    try {
      await document.fonts.load(`20px ${FAMILY}`);
    } catch {
      ready = false;
    }
    if (destroyed) return;
    ready = true;
    layout();
    const now = performance.now();
    buildAuto(LETTERS[0], now, 10);
    carX = col;
    lineF = line;
    place();
    root.setAttribute("data-ready", "");
    if (!embedded) focusInput();
    setRunning();
    wake();
  };
  boot();

  return {
    async setSound(on) {
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      keyTarget.removeEventListener("keydown", onOuterKey);
      root.removeEventListener("pointerdown", onPointerDown);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("beforeinput", onBeforeInput);
      input.removeEventListener("input", onInput);
      sound?.destroy();
      root.remove();
    },
  };
}
