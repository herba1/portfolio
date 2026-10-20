import { createTempoSound } from "./tempoAudio";

const FAMILY = "TempoArial";
const BEAT = 0.5;
const ARRIVE = 0.17;
const LEAVE = 0.36;
const STEP = 1 / 240;
const K = 2600;
const C = 2 * Math.sqrt(K);
const LEAD = 0.34;
const MAX_WORD = 22;
const MAX_WORDS = 16;
const INK = "#f3f2ee";
const GROUND = "#040404";

const PHRASES = [
  { text: "we can stay out till the streetlights go soft", rhythm: [0, 1, 2, 4, 6, 7, 8, 12, 14] },
  { text: "i keep your voice on the walk home", rhythm: [0, 1, 2, 4, 6, 7, 8, 10] },
  { text: "nothing good comes easy but it comes", rhythm: [0, 2, 4, 6, 8, 9, 12] },
  { text: "it will take a while to feel like this again", rhythm: [0, 1, 2, 3, 4, 7, 8, 10, 11, 12] },
  { text: "you don't have to be anyone tonight", rhythm: [0, 1, 2, 3, 4, 6, 10] },
  { text: "call me when the city goes quiet", rhythm: [0, 1, 2, 3, 4, 6, 8] },
  { text: "the whole point is not knowing and going anyway", rhythm: [0, 1, 2, 4, 5, 6, 9, 10, 12] },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const ceilTo = (v, step) => Math.ceil(v / step - 1e-6) * step;

const autoRhythm = (words) => {
  const out = [];
  let t = 0;
  words.forEach((w, i) => {
    out.push(t);
    const next = words[i + 1];
    let dur = w.length <= 3 && next ? 1 : 2;
    if ((t + dur) % 2 === 1 && next && next.length > 4) dur += 1;
    t += dur;
  });
  return out;
};

export function createTempo(stage, { embedded = false, onLive = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "tempo-surface";
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "Lyrics set word by word on the beat into a justified block. Tap to restart the line. Type to set your own line, press Enter to loop it.");
  if (embedded) root.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "tempo-canvas";
  root.append(canvas);
  const input = document.createElement("input");
  input.className = "tempo-input";
  input.type = "text";
  input.setAttribute("aria-label", "Your own line");
  input.autocapitalize = "none";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "done";
  root.append(input);
  stage.append(root);
  const g = canvas.getContext("2d");

  let W = 0;
  let H = 0;
  let dpr = 1;
  let baseSize = 40;
  let measure = 240;
  let sound = null;
  let soundWanted = false;
  let soundStarting = false;
  let beatBytes = null;
  let freeBeat = -1;
  let freeBase = performance.now();
  let lastBeat = -1;
  let slew = 0;
  let audioLocked = false;
  let phrase = null;
  let phraseIndex = 0;
  let userLine = null;
  let live = [];
  let leaving = [];
  let queue = [];
  let draft = "";
  let lastKeyAt = 0;
  let blockTop = 0;
  let blockTopT = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let started = false;
  let destroyed = false;
  let press = null;

  fetch("/blog/audio/friday-beat.wav")
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((b) => {
      beatBytes = b;
      if (soundWanted) startSound();
    })
    .catch(() => {});

  const font = (s) => `${s}px ${FAMILY}, Arial, sans-serif`;

  const widthOf = (text, s) => {
    g.font = font(s);
    return g.measureText(text).width;
  };

  const breakLines = (widths, s, m) => {
    const space = widthOf(" ", s);
    const lines = [];
    let cur = [];
    let used = 0;
    widths.forEach((w, i) => {
      if (cur.length && used + space + w > m + 0.5) {
        lines.push(cur);
        cur = [];
        used = 0;
      }
      used += (cur.length ? space : 0) + w;
      cur.push(i);
    });
    if (cur.length) lines.push(cur);
    return lines;
  };

  const lineHeight = (s) => Math.round(s * 1.04);

  const fit = (words) => {
    let s = baseSize;
    const widest = Math.max(1, ...words.map((w) => widthOf(w, 100)));
    s = Math.min(s, (measure * 100) / widest);
    for (let k = 0; k < 24; k += 1) {
      const rows = breakLines(words.map((w) => widthOf(w, s)), s, measure).length;
      if (rows * lineHeight(s) <= H * 0.8) break;
      s *= 0.95;
    }
    return Math.max(10, s);
  };

  const beatNow = () => {
    const now = performance.now();
    if (sound && sound.running && visible && onscreen) {
      const a = sound.beat(BEAT);
      if (a !== null) {
        if (!audioLocked) {
          audioLocked = true;
          slew = lastBeat - a;
        }
        return a + slew;
      }
    }
    return freeBeat + (now - freeBase) / (BEAT * 1000);
  };

  const sizeCanvas = () => {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const gutter = Math.max(16, W * 0.07);
    baseSize = clamp(Math.min(W * 0.13, H * 0.09), 14, 84);
    measure = baseSize * 6.3;
    if (measure > W - gutter * 2) {
      measure = W - gutter * 2;
      baseSize = measure / 6.3;
    }
  };

  const layout = (snap) => {
    if (!phrase) return;
    const s = phrase.size;
    const lh = lineHeight(s);
    const left = Math.round((W - measure) / 2);
    const lines = breakLines(live.map((w) => w.w), s, measure);
    let rows = phrase.rows;
    if (phrase.open) rows = Math.max(1, lines.length + (draft ? 1 : 0));
    blockTopT = Math.round(H / 2 - (rows * lh) / 2);
    if (snap || !phrase.user) blockTop = blockTopT;
    lines.forEach((idx, r) => {
      const sum = idx.reduce((a, i) => a + live[i].w, 0);
      const gap = idx.length > 1 ? (measure - sum) / (idx.length - 1) : 0;
      let x = left;
      idx.forEach((i) => {
        const word = live[i];
        word.tx = x;
        word.row = r;
        if (snap) {
          word.x = x;
          word.v = 0;
        }
        x += word.w + gap;
      });
    });
    phrase.lines = lines;
  };

  const baseline = (row, s) => blockTop + row * lineHeight(s) + s * 0.8;

  const schedule = (beat, fn) => {
    queue.push({ beat, fn });
    queue.sort((a, b) => a.beat - b.beat);
  };

  const makePhrase = (words, rhythm, start, { user = false, open = false } = {}) => {
    const size = fit(words.length ? words : ["word"]);
    const at = rhythm.map((e) => start + e / 2);
    const lastAt = at.length ? at[at.length - 1] : start;
    const wipe = open ? Infinity : start + ceilTo(rhythm[rhythm.length - 1] + 6, 4) / 2;
    const rows = breakLines(words.map((w) => widthOf(w, size)), size, measure).length;
    return { words, at, start, lastAt, wipe, next: wipe + 2, landed: 0, wiping: false, size, rows, user, open, lines: [] };
  };

  const begin = (p) => {
    phrase = p;
    live = [];
    layout(true);
    if (p.words.length) onLive(p.words.join(" "));
    schedule(p.at.length ? p.at[0] : p.start, (t) => sound?.open(t));
  };

  const nextPhrase = (start) => {
    if (userLine) return makePhrase(userLine, autoRhythm(userLine), start, { user: true });
    const ph = PHRASES[phraseIndex % PHRASES.length];
    const words = ph.text.split(" ");
    return makePhrase(words, ph.rhythm, start);
  };

  const wipeAll = (at, step) => {
    const order = live.slice().sort((a, b) => a.row - b.row || b.tx - a.tx);
    order.forEach((w, k) => {
      leaving.push({ text: w.text, x: w.x, y: baseline(w.row, w.size), size: w.size, out: at + k * step });
    });
    live = [];
    if (order.length) {
      const dur = ((order.length - 1) * step + LEAVE / BEAT) * BEAT;
      schedule(at, (t) => sound?.wipe(t, dur, 1));
    }
  };

  const land = (i, at) => {
    const text = phrase.words[i];
    const w = { text, w: widthOf(text, phrase.size), size: phrase.size, x: 0, v: 0, tx: 0, row: 0, born: at };
    live.push(w);
    layout(false);
    w.x = w.tx;
    w.v = 0;
  };

  const restart = (b) => {
    if (!phrase) return;
    if (phrase.open) {
      finishTyping(b);
      return;
    }
    const at = ceilTo(b + 0.2, 0.5);
    const shown = live.length;
    wipeAll(at, 0.0625);
    if (!shown) {
      phraseIndex += phrase.landed >= phrase.words.length ? 1 : 0;
      begin(nextPhrase(ceilTo(b + 0.3, 1)));
      return;
    }
    const again = phrase.user ? makePhrase(phrase.words, autoRhythm(phrase.words), ceilTo(at + 1.4, 1), { user: true }) : makePhrase(phrase.words, PHRASES[phraseIndex % PHRASES.length].rhythm, ceilTo(at + 1.4, 1));
    begin(again);
  };

  const openTyping = (b) => {
    if (phrase && phrase.open) return;
    const shown = live.length;
    const at = ceilTo(b + 0.2, 0.5);
    wipeAll(at, 0.0625);
    const start = shown ? ceilTo(at + 1.2, 0.5) : ceilTo(b + 0.25, 0.5);
    phrase = makePhrase([], [], start, { user: true, open: true });
    phrase.size = baseSize;
    live = [];
    layout(true);
    schedule(start, (t) => sound?.open(t));
  };

  const commitWord = (b) => {
    const word = draft.trim().slice(0, MAX_WORD);
    draft = "";
    if (!word || !phrase || !phrase.open) return;
    if (phrase.words.length >= MAX_WORDS) return;
    const prev = phrase.at.length ? phrase.at[phrase.at.length - 1] + 0.5 : phrase.start;
    const at = Math.max(prev, ceilTo(b + 0.12, 0.5), phrase.start);
    phrase.words.push(word);
    phrase.at.push(at);
    phrase.lastAt = at;
    const widths = phrase.words.map((w) => widthOf(w, phrase.size));
    const rows = breakLines(widths, phrase.size, measure).length;
    if ((rows + 1) * lineHeight(phrase.size) > H * 0.8) finishTyping(b);
  };

  const finishTyping = (b) => {
    if (!phrase || !phrase.open) return;
    if (draft.trim()) commitWord(b);
    if (!phrase || !phrase.open) return;
    draft = "";
    input.value = "";
    if (!phrase.words.length) {
      phrase.open = false;
      phrase.wipe = ceilTo(b + 0.2, 0.5);
      phrase.next = phrase.wipe + 0.5;
      return;
    }
    userLine = phrase.words.slice();
    phrase.open = false;
    phrase.rows = Math.max(phrase.lines.length, breakLines(userLine.map((w) => widthOf(w, phrase.size)), phrase.size, measure).length);
    phrase.wipe = ceilTo(Math.max(b, phrase.lastAt) + 3, 1);
    phrase.next = phrase.wipe + 2;
    onLive(userLine.join(" "));
  };

  const tick = (b) => {
    if (!phrase) return;
    while (phrase.landed < phrase.at.length && b >= phrase.at[phrase.landed]) {
      land(phrase.landed, phrase.at[phrase.landed]);
      phrase.landed += 1;
    }
    if (!phrase.open && !phrase.wiping && b >= phrase.wipe - LEAD) {
      phrase.wiping = true;
      while (phrase.landed < phrase.at.length) {
        land(phrase.landed, phrase.at[phrase.landed]);
        phrase.landed += 1;
      }
      wipeAll(phrase.wipe, 0.125);
    }
    if (!phrase.open && b >= phrase.next - LEAD) {
      if (!phrase.user || !userLine) phraseIndex += 1;
      begin(nextPhrase(phrase.next));
    }
    if (phrase.open) {
      const idle = performance.now() - lastKeyAt;
      if (draft && idle > 1600) commitWord(b);
      if (!draft && phrase.words.length && idle > 3400) finishTyping(b);
      if (!draft && !phrase.words.length && idle > 5000) {
        phrase.open = false;
        phrase.wipe = b;
        phrase.next = b + 0.5;
      }
    }
  };

  const fireSounds = (b) => {
    if (!sound || !sound.running) {
      queue = queue.filter((q) => q.beat > b + 0.05);
      return;
    }
    const horizon = sound.ctx.currentTime + 0.14;
    while (queue.length) {
      const t = sound.timeOf(queue[0].beat, BEAT);
      if (t > horizon) break;
      const q = queue.shift();
      if (t > sound.ctx.currentTime - 0.08) q.fn(t);
    }
  };

  const drawWord = (text, x, y, alpha) => {
    if (alpha <= 0.002) return;
    g.globalAlpha = Math.min(1, alpha);
    g.fillText(text, x, y);
  };

  const draw = (b) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = GROUND;
    g.fillRect(0, 0, W, H);
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.textBaseline = "alphabetic";
    for (const w of leaving) {
      g.font = font(w.size);
      const age = (b - w.out) * BEAT;
      if (age <= 0) {
        drawWord(w.text, w.x, w.y, 1);
        continue;
      }
      const p = clamp(age / LEAVE, 0, 1);
      const dx = w.size * 2.6 * p * p;
      const stretch = 1 + 1.6 * p * p;
      for (let j = 5; j >= 1; j -= 1) {
        const gx = w.x + dx * (1 - j / 6);
        g.setTransform(dpr * (1 + (stretch - 1) * (1 - j / 6)), 0, 0, dpr, gx * dpr, 0);
        drawWord(w.text, 0, w.y, (1 - p) * 0.34 * (1 - j / 6));
      }
      g.setTransform(dpr * stretch, 0, 0, dpr, (w.x + dx) * dpr, 0);
      drawWord(w.text, 0, w.y, (1 - p) ** 1.6);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (phrase) {
      g.font = font(phrase.size);
      for (const w of live) {
        const y = baseline(w.row, w.size);
        const age = (b - w.born) * BEAT;
        if (age < ARRIVE) {
          const p = clamp(age / ARRIVE, 0, 1);
          const dx = w.size * 0.3 * (1 - easeOut(p));
          for (let j = 3; j >= 1; j -= 1) drawWord(w.text, w.x + dx + j * w.size * 0.17 * (1 - p), y, 0.42 * (1 - p) * (1 - j * 0.24));
          drawWord(w.text, w.x + dx, y, 1);
        } else {
          drawWord(w.text, w.x, y, 1);
        }
      }
      if (phrase.open && draft && !leaving.length) {
        const s = phrase.size;
        const rows = phrase.lines.length;
        g.globalAlpha = 1;
        g.lineWidth = Math.max(1, s / 44);
        g.strokeText(draft, Math.round((W - measure) / 2), baseline(rows, s));
      }
    }
    g.globalAlpha = 1;
  };

  const step = (dt) => {
    for (const w of live) {
      const a = -K * (w.x - w.tx) - C * w.v;
      w.v += a * dt;
      w.x += w.v * dt;
    }
    blockTop += (blockTopT - blockTop) * Math.min(1, dt * 14);
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed || !visible || !onscreen) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    let b = beatNow();
    if (lastBeat >= 0 && b < lastBeat) b = lastBeat;
    if (lastBeat >= 0 && b > lastBeat + dt / BEAT + 0.25) b = lastBeat + dt / BEAT;
    slew *= Math.exp(-dt * 5);
    lastBeat = b;
    freeBeat = b;
    freeBase = performance.now();
    tick(b);
    fireSounds(b);
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    leaving = leaving.filter((w) => (b - w.out) * BEAT < LEAVE);
    draw(b);
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || raf || !started || !visible || !onscreen) return;
    last = performance.now();
    freeBase = last;
    raf = requestAnimationFrame(frame);
  };

  const pause = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sound?.suspend();
    audioLocked = false;
  };

  const startSound = async () => {
    if (soundStarting || !beatBytes || !sound) return;
    soundStarting = true;
    sound.feed(beatBytes);
    const ok = await sound.setEnabled(true);
    if (ok && !destroyed) await sound.startAt(() => lastBeat, BEAT);
    soundStarting = false;
  };

  const gesture = () => {
    onGesture();
    if (soundWanted) return;
    soundWanted = true;
    sound = createTempoSound();
    if (!sound) return;
    sound.ctx.resume().catch(() => {});
    startSound();
  };

  const onDown = (e) => {
    if (!started) return;
    gesture();
    if (embedded) root.focus({ preventScroll: true });
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), touch: e.pointerType !== "mouse" };
    restart(lastBeat);
  };

  const onUp = (e) => {
    if (!press || press.id !== e.pointerId) return;
    const held = performance.now() - press.t;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (press.touch && held > 450 && moved < 12) {
      input.value = "";
      input.focus({ preventScroll: true });
    }
    press = null;
  };

  const ALLOWED = /^[a-zA-Z0-9'&!?.,\-]$/;

  const typeChar = (ch) => {
    lastKeyAt = performance.now();
    if (!phrase || !phrase.open) openTyping(lastBeat);
    if (draft.length >= MAX_WORD) return;
    draft += ch.toLowerCase();
    layout(false);
    sound?.tick(0);
  };

  const onKey = (e) => {
    if (!started || e.target === input) return;
    if (embedded && !root.contains(document.activeElement)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") gesture();
    if (e.key === "Escape") {
      userLine = null;
      if (phrase?.open) finishTyping(lastBeat);
      userLine = null;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (phrase?.open) {
        lastKeyAt = performance.now();
        finishTyping(lastBeat);
      } else restart(lastBeat);
      return;
    }
    if (e.key === "Backspace") {
      if (phrase?.open && draft) {
        e.preventDefault();
        draft = draft.slice(0, -1);
        lastKeyAt = performance.now();
        layout(false);
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (phrase?.open && draft) {
        lastKeyAt = performance.now();
        commitWord(lastBeat);
        layout(false);
        sound?.tick(0.3);
      }
      return;
    }
    if (e.key.length === 1 && ALLOWED.test(e.key)) {
      e.preventDefault();
      typeChar(e.key);
    }
  };

  const onInput = () => {
    gesture();
    const raw = input.value.replace(/[^a-zA-Z0-9'&!?.,\- ]/g, "").toLowerCase();
    lastKeyAt = performance.now();
    if (!phrase || !phrase.open) openTyping(lastBeat);
    const parts = raw.split(" ");
    const rest = parts.pop() ?? "";
    for (const p of parts) {
      if (!p) continue;
      draft = p;
      commitWord(lastBeat);
    }
    draft = rest.slice(0, MAX_WORD);
    if (parts.length) input.value = draft;
    layout(false);
    sound?.tick(0);
  };

  const onInputKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lastKeyAt = performance.now();
      finishTyping(lastBeat);
      input.blur();
    }
  };

  const onInputBlur = () => {
    if (phrase?.open) finishTyping(lastBeat);
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) {
      sound?.resume();
      wake();
    } else pause();
  };

  const ro = new ResizeObserver(() => {
    sizeCanvas();
    if (phrase) {
      phrase.size = phrase.open ? baseSize : fit(phrase.words);
      phrase.rows = breakLines(phrase.words.map((w) => widthOf(w, phrase.size)), phrase.size, measure).length;
      for (const w of live) {
        w.size = phrase.size;
        w.w = widthOf(w.text, phrase.size);
      }
      layout(true);
    }
    leaving = [];
    if (started && !raf) draw(lastBeat);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) {
      sound?.resume();
      wake();
    } else pause();
  });
  io.observe(root);

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onInputKey);
  input.addEventListener("blur", onInputBlur);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);

  const go = () => {
    if (destroyed) return;
    sizeCanvas();
    started = true;
    lastBeat = 0;
    freeBeat = 0;
    freeBase = performance.now();
    begin(nextPhrase(1));
    draw(0);
    root.dataset.ready = "";
    wake();
  };

  const fontReady = document.fonts?.load ? document.fonts.load(font(40), "streetlights") : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))]).then(() => requestAnimationFrame(go));

  return {
    async setSound(on) {
      if (on) {
        gesture();
        return true;
      }
      sound?.setEnabled(false);
      return false;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onInputKey);
      input.removeEventListener("blur", onInputBlur);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      root.remove();
    },
  };
}
