import { createShutter } from "./shutterAudio";

const DOC = 320;
const SQUASH = 0.46;
const INK = "#10134f";
const FAMILY = '"Still Here Tinos", "Times New Roman", Times, serif';
export const MAX_GENERATIONS = 100;
const REST_MS = 1400;
const HOLD_MS = 2600;
const HEAL_MS = 2600;
const WEAR_SLOW = 260;
const WEAR_FAST = 70;
const CLICK_GAP = 120;

function encode(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

async function decode(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

function balance(words, count, measure) {
  if (count === 1) return [words.join(" ")];
  const total = measure(words.join(" "));
  const target = total / count;
  const lines = [];
  let current = [];
  for (let i = 0; i < words.length; i += 1) {
    const remainingLines = count - lines.length;
    const remainingWords = words.length - i;
    const candidate = [...current, words[i]].join(" ");
    if (current.length && remainingLines > 1 && (measure(candidate) > target * 1.08 || remainingWords < remainingLines)) {
      lines.push(current.join(" "));
      current = [words[i]];
    } else {
      current.push(words[i]);
    }
  }
  if (current.length) lines.push(current.join(" "));
  return lines;
}

function layout(ctx, text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: 0, lines: [] };
  ctx.font = `100px ${FAMILY}`;
  const measure = (s) => ctx.measureText(s).width * SQUASH;
  const maxW = DOC * 0.88;
  const maxH = DOC * 0.8;
  let best = { size: 0, lines: [] };
  for (let n = 1; n <= Math.min(5, words.length); n += 1) {
    const lines = balance(words, n, measure);
    const widest = Math.max(...lines.map(measure));
    const lead = 0.98;
    const size = Math.min((maxW / widest) * 100, maxH / (lines.length * lead), DOC * 0.62);
    if (size > best.size * 1.04) best = { size, lines };
  }
  return best;
}

function paintText(ctx, text) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, DOC, DOC);
  const { size, lines } = layout(ctx, text);
  if (!lines.length) return;
  ctx.font = `${size.toFixed(2)}px ${FAMILY}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const lead = size * 0.98;
  const blockH = lead * (lines.length - 1) + size * 0.7;
  const top = (DOC - blockH) / 2 + size * 0.7;
  lines.forEach((line, i) => {
    ctx.save();
    ctx.translate(DOC / 2, top + i * lead);
    ctx.scale(SQUASH, 1);
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
}

function wobble(g) {
  const grow = Math.min(1, g / 48);
  const dx = Math.round((0.6 + 0.9 * grow) * Math.sin(g * 1.73 + 0.4));
  const dy = Math.round((0.6 + 0.9 * grow) * Math.cos(g * 2.29 + 1.1));
  return { dx, dy };
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createGeneration({ canvas, ghost, card, onState }) {
  const make = () => {
    const c = document.createElement("canvas");
    c.width = DOC;
    c.height = DOC;
    return c;
  };
  canvas.width = DOC;
  canvas.height = DOC;
  ghost.width = DOC;
  ghost.height = DOC;
  const ctx = canvas.getContext("2d", { alpha: false });
  const ghostCtx = ghost.getContext("2d", { alpha: false });
  const head = make();
  const headCtx = head.getContext("2d", { alpha: false });
  const pass = make();
  const passCtx = pass.getContext("2d", { alpha: false });
  passCtx.imageSmoothingEnabled = false;

  let text = "still here?";
  let quality = 0.18;
  let frames = [{ blob: null, bytes: 0 }];
  let shown = 0;
  let target = 0;
  let token = 0;
  let syncing = false;
  let invalid = false;
  let playing = true;
  let visible = true;
  let started = false;
  let phase = "rest";
  let phaseAt = 0;
  let timer = 0;
  let destroyed = false;
  let audio = null;
  let soundOn = true;
  let lastClick = 0;
  let clickNext = 0;
  let healFrom = 0;

  const emit = () =>
    onState?.({
      generation: shown,
      bytes: frames[shown]?.bytes ?? 0,
      history: frames.slice(1, shown + 1).map((f) => f.bytes),
      playing,
      phase,
    });

  const crossfade = (ms) => {
    ghostCtx.drawImage(canvas, 0, 0);
    ghost.getAnimations().forEach((a) => a.cancel());
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" });
  };

  const click = (intensity) => {
    const now = performance.now();
    if (now - lastClick < CLICK_GAP) return;
    lastClick = now;
    audio?.shutter(intensity);
  };

  const measureOriginal = async (mine) => {
    const blob = await encode(head, 0.98);
    if (destroyed || mine !== token || !blob) return;
    frames[0].bytes = blob.size;
    if (shown === 0) emit();
  };

  const pristine = () => {
    token += 1;
    paintText(headCtx, text);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(head, 0, 0);
    frames = [{ blob: null, bytes: frames[0]?.bytes ?? 0 }];
    shown = 0;
    target = 0;
    invalid = false;
    emit();
    measureOriginal(token);
  };

  const produce = async (mine) => {
    const g = frames.length;
    const { dx, dy } = wobble(g);
    passCtx.setTransform(1, 0, 0, 1, 0, 0);
    passCtx.fillStyle = "#ffffff";
    passCtx.fillRect(0, 0, DOC, DOC);
    passCtx.filter = "saturate(1.04)";
    passCtx.drawImage(head, dx, dy);
    passCtx.filter = "none";
    const blob = await encode(pass, quality);
    if (destroyed || mine !== token || !blob) return false;
    const bitmap = await decode(blob);
    if (destroyed || mine !== token) {
      bitmap.close?.();
      return false;
    }
    headCtx.setTransform(1, 0, 0, 1, 0, 0);
    headCtx.fillStyle = "#ffffff";
    headCtx.fillRect(0, 0, DOC, DOC);
    headCtx.drawImage(bitmap, -dx, -dy);
    bitmap.close?.();
    frames.push({ blob, bytes: blob.size, dx, dy });
    return true;
  };

  const display = async (g, mine) => {
    if (g === frames.length - 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(head, 0, 0);
      return true;
    }
    if (g === 0) {
      paintText(ctx, text);
      return true;
    }
    const bitmap = await decode(frames[g].blob);
    if (destroyed || mine !== token) {
      bitmap.close?.();
      return false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, DOC, DOC);
    ctx.drawImage(bitmap, -frames[g].dx, -frames[g].dy);
    bitmap.close?.();
    return true;
  };

  const sync = async () => {
    if (syncing || destroyed) return;
    syncing = true;
    const mine = token;
    let aborted = false;
    if (invalid) {
      invalid = false;
      frames = frames.slice(0, shown + 1);
      headCtx.setTransform(1, 0, 0, 1, 0, 0);
      headCtx.drawImage(canvas, 0, 0);
    }
    while (shown !== target && !destroyed && mine === token) {
      const want = target;
      while (frames.length - 1 < want) {
        if (!(await produce(mine))) {
          aborted = true;
          break;
        }
      }
      if (aborted) break;
      if (!(await display(want, mine))) break;
      const forward = want > shown;
      shown = want;
      if (forward && clickNext) click(clickNext);
      if (forward && phase === "wear") press();
      emit();
    }
    syncing = false;
    if (!destroyed && (shown !== target || invalid)) sync();
  };

  const press = () => {
    card.getAnimations().forEach((a) => a.cancel());
    card.animate([{ transform: "scale(0.996)" }, { transform: "scale(1)" }], { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  };

  const goTo = (g, intensity) => {
    target = Math.max(0, Math.min(MAX_GENERATIONS, Math.round(g)));
    clickNext = intensity;
    sync();
  };

  const setPhase = (next) => {
    phase = next;
    phaseAt = performance.now();
    emit();
  };

  const schedule = (ms) => {
    window.clearTimeout(timer);
    if (!playing || !visible || destroyed || !started) return;
    timer = window.setTimeout(tick, ms);
  };

  const tick = () => {
    if (!playing || !visible || destroyed) return;
    const now = performance.now();
    if (phase === "rest") {
      if (now - phaseAt >= REST_MS) {
        setPhase("wear");
        return schedule(0);
      }
      return schedule(REST_MS - (now - phaseAt));
    }
    if (phase === "wear") {
      if (shown >= MAX_GENERATIONS) {
        setPhase("hold");
        return schedule(HOLD_MS);
      }
      if (!syncing && shown === target) goTo(shown + 1, 0.35);
      const p = shown / MAX_GENERATIONS;
      const delay = WEAR_SLOW + (WEAR_FAST - WEAR_SLOW) * (1 - Math.pow(1 - Math.min(1, p * 1.6), 2));
      return schedule(delay);
    }
    if (phase === "hold") {
      if (now - phaseAt >= HOLD_MS) {
        healFrom = shown;
        setPhase("heal");
        return schedule(0);
      }
      return schedule(HOLD_MS - (now - phaseAt));
    }
    if (phase === "heal") {
      const t = Math.min(1, (now - phaseAt) / HEAL_MS);
      const g = Math.round(healFrom * (1 - easeInOut(t)));
      if (g === 0 && shown !== 0) crossfade(500);
      goTo(g, 0);
      if (t >= 1) {
        setPhase("rest");
        return schedule(REST_MS);
      }
      return schedule(32);
    }
    return undefined;
  };

  const resumeFromHere = () => {
    if (shown >= MAX_GENERATIONS) setPhase("hold");
    else if (shown === 0) setPhase("rest");
    else setPhase("wear");
  };

  const ensureAudio = () => {
    if (!audio) audio = createShutter();
    return audio;
  };

  const onFirstGesture = () => {
    window.removeEventListener("pointerdown", onFirstGesture, true);
    window.removeEventListener("keydown", onFirstGesture, true);
    if (!soundOn) return;
    ensureAudio()?.setEnabled(true);
  };
  window.addEventListener("pointerdown", onFirstGesture, true);
  window.addEventListener("keydown", onFirstGesture, true);

  const init = async (startText) => {
    try {
      await document.fonts.load(`100px "Still Here Tinos"`);
    } catch {
      return;
    }
    if (destroyed) return;
    text = startText;
    pristine();
    started = true;
    setPhase("rest");
    schedule(REST_MS);
  };

  return {
    init,
    setText(next) {
      text = next;
      pristine();
      if (playing) {
        setPhase("rest");
        phaseAt = performance.now() - REST_MS * 0.5;
        schedule(REST_MS * 0.5);
      }
    },
    setQuality(q) {
      quality = q;
      invalid = true;
      if (!syncing) sync();
    },
    scrub(g) {
      if (playing) {
        playing = false;
        window.clearTimeout(timer);
      }
      goTo(g, 0.25);
      emit();
    },
    setPlaying(on) {
      playing = on;
      window.clearTimeout(timer);
      if (on) {
        resumeFromHere();
        schedule(phase === "hold" ? HOLD_MS * 0.5 : 0);
      }
      emit();
    },
    setVisible(on) {
      if (visible === on) return;
      visible = on;
      window.clearTimeout(timer);
      if (on && playing) {
        if (phase === "heal") phaseAt = performance.now() - HEAL_MS;
        schedule(0);
      }
    },
    async setSound(on) {
      soundOn = on;
      if (!on) {
        await audio?.setEnabled(false);
        return false;
      }
      const a = ensureAudio();
      if (!a) return false;
      return a.setEnabled(true);
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("keydown", onFirstGesture, true);
      audio?.destroy();
      audio = null;
    },
  };
}
