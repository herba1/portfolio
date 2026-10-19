import { createShutter } from "./shutterAudio";

const DOC = 320;
const SQUASH = 0.46;
const INK = "#10134f";
const FAMILY = '"Still Here Tinos", "Times New Roman", Times, serif';
const HOLD_FIRST = 320;
const HOLD_SLOW = 150;
const HOLD_FAST = 70;

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

export function createGeneration({ canvas, ghost, card, onState }) {
  canvas.width = DOC;
  canvas.height = DOC;
  ghost.width = DOC;
  ghost.height = DOC;
  const ctx = canvas.getContext("2d", { alpha: false });
  const ghostCtx = ghost.getContext("2d", { alpha: false });
  const pass = document.createElement("canvas");
  pass.width = DOC;
  pass.height = DOC;
  const passCtx = pass.getContext("2d", { alpha: false });
  passCtx.imageSmoothingQuality = "high";

  let text = "still here?";
  let quality = 0.32;
  let generation = 0;
  let bytes = 0;
  let history = [];
  let token = 0;
  let busy = false;
  let queued = 0;
  let holding = false;
  let holdTimer = 0;
  let measureTimer = 0;
  let holdCount = 0;
  let destroyed = false;
  let audio = null;
  let soundOn = true;

  const emit = () => onState?.({ generation, bytes, history: history.slice(-64), text, quality });

  const crossfade = (ms) => {
    ghostCtx.drawImage(canvas, 0, 0);
    ghost.getAnimations().forEach((a) => a.cancel());
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" });
  };

  const measureOriginal = async (mine) => {
    const blob = await encode(canvas, 0.98);
    if (destroyed || mine !== token || !blob) return;
    bytes = blob.size;
    history = [blob.size];
    emit();
  };

  const pristine = (fade) => {
    token += 1;
    queued = 0;
    if (fade) crossfade(fade);
    paintText(ctx, text);
    generation = 0;
    history = [];
    emit();
    window.clearTimeout(measureTimer);
    const mine = token;
    measureTimer = window.setTimeout(() => measureOriginal(mine), 220);
  };

  const wobble = (g) => {
    const s = 1 + 0.003 * Math.sin(g * 2.399 + 0.6);
    const r = 0.0009 * Math.sin(g * 1.31 + 2.1);
    const dx = 0.1 * Math.sin(g * 1.73);
    const dy = 0.1 * Math.cos(g * 2.29);
    return { s, r, dx, dy };
  };

  const generationOnce = async () => {
    const mine = token;
    const g = generation + 1;
    const { s, r, dx, dy } = wobble(g);
    passCtx.setTransform(1, 0, 0, 1, 0, 0);
    passCtx.fillStyle = "#ffffff";
    passCtx.fillRect(0, 0, DOC, DOC);
    passCtx.translate(DOC / 2 + dx, DOC / 2 + dy);
    passCtx.rotate(r);
    passCtx.scale(s, s);
    passCtx.drawImage(canvas, -DOC / 2, -DOC / 2);
    const blob = await encode(pass, quality);
    if (destroyed || mine !== token || !blob) return false;
    const bitmap = await decode(blob);
    if (destroyed || mine !== token) {
      bitmap.close?.();
      return false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    generation = g;
    bytes = blob.size;
    history.push(blob.size);
    if (history.length > 400) history = history.slice(-400);
    return true;
  };

  const press = () => {
    card.getAnimations().forEach((a) => a.cancel());
    card.animate([{ transform: "scale(0.992)" }, { transform: "scale(1)" }], { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  };

  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queued > 0 && !destroyed) {
      queued -= 1;
      const ok = await generationOnce();
      if (ok) {
        audio?.shutter(holding ? 0.6 : 1);
        press();
        emit();
      }
    }
    busy = false;
  };

  const save = () => {
    if (destroyed) return;
    audio?.wake();
    queued = Math.min(queued + 1, 2);
    pump();
  };

  const holdTick = () => {
    if (!holding || destroyed) return;
    if (!busy) save();
    holdCount += 1;
    const delay = Math.max(HOLD_FAST, HOLD_SLOW - holdCount * 8);
    holdTimer = window.setTimeout(holdTick, delay);
  };

  const hold = (on) => {
    window.clearTimeout(holdTimer);
    holding = on;
    holdCount = 0;
    if (on) {
      save();
      holdTimer = window.setTimeout(holdTick, HOLD_FIRST);
    }
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

  const init = async (startText, startGenerations) => {
    try {
      await document.fonts.load(`100px "Still Here Tinos"`);
    } catch {
      return;
    }
    if (destroyed) return;
    text = startText;
    paintText(ctx, text);
    const mine = token;
    const original = await encode(canvas, 0.98);
    if (original) history = [original.size];
    for (let i = 0; i < startGenerations && !destroyed && mine === token; i += 1) await generationOnce();
    if (destroyed) return;
    emit();
  };

  return {
    init,
    save,
    hold,
    setText(next) {
      text = next;
      pristine(0);
    },
    setQuality(q) {
      quality = q;
      emit();
    },
    reset() {
      pristine(420);
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
      window.clearTimeout(holdTimer);
      window.clearTimeout(measureTimer);
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("keydown", onFirstGesture, true);
      audio?.destroy();
      audio = null;
    },
  };
}
