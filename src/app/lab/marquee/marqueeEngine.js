import { createMarqueeSound } from "./marqueeAudio";
import { GLYPH_ROWS, rasterize } from "./marqueeFont";
import { createMarqueeGL } from "./marqueeGL";

const ROWS = 11;
const TOP = 1;
const SPEED = 26;
const MAX_CHARS = 72;

const MESSAGES = [
  "still here?",
  "♪ here comes the sun",
  "we can stay out till the streetlights go soft",
  "how are you?",
  "♪ in my life",
  "i keep your voice on the walk home",
  "it must be out there.",
  "♪ across the universe",
  "nothing good comes easy but it comes",
  "you don't have to be anyone tonight",
  "♪ come together",
  "the whole point is not knowing and going anyway",
  "♪ the long and winding road",
  "see you after the show",
];

const ENTERS = ["wipe", "drop", "dissolve", "scroll", "roll", "open"];
const EXITS = ["dissolve", "roll", "wipe", "drop", "close", "scroll"];

function hash(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createMarquee(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "marquee-sign";
  root.setAttribute("role", "img");
  const canvas = document.createElement("canvas");
  canvas.className = "marquee-canvas";
  root.append(canvas);
  const input = document.createElement("input");
  input.className = "marquee-input";
  input.type = "text";
  input.maxLength = MAX_CHARS;
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.enterKeyHint = "done";
  input.setAttribute("aria-label", "Write a line for the sign");
  stage.append(root);
  stage.append(input);

  const gl = createMarqueeGL(canvas);
  if (!gl) {
    root.remove();
    input.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sound = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let pitch = 16;
  let cols = 60;
  let originX = 0;
  let originY = 0;
  let target = new Uint8Array(cols * ROWS);
  let level = new Float32Array(cols * ROWS);
  let bytes = new Uint8Array(cols * ROWS);
  let playlist = MESSAGES.slice();
  let index = 0;
  let enterTurn = 1;
  let exitTurn = 0;
  let show = null;
  let editing = false;
  let draft = "";
  let lastTyped = 0;
  let fade = reduced ? 1 : 0;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let salt = 1;
  let litFraction = 0;

  const makeShow = (text, forceEnter) => {
    const bmp = rasterize(text);
    const long = bmp.w > cols - 4;
    const x0 = Math.floor((cols - bmp.w) / 2);
    let enter = forceEnter;
    if (!enter) {
      enter = ENTERS[enterTurn % ENTERS.length];
      enterTurn += 1;
    }
    const exit = EXITS[exitTurn % EXITS.length];
    exitTurn += 1;
    salt += 1;
    const hold = 2.2 + Math.min(2.4, [...text].length * 0.07);
    return { text, bmp, long, x0, enter: long ? "run" : enter, exit, hold, flash: !long && salt % 3 === 0, phase: "enter", t: 0, salt };
  };

  const startNext = () => {
    const text = playlist[index % playlist.length];
    index = (index + 1) % playlist.length;
    show = makeShow(text);
    sound?.relay();
    onLive(text.replace("♪ ", ""));
  };

  const clear = () => target.fill(0);

  const blit = (bmp, ox, oy, mask) => {
    for (let y = 0; y < bmp.h; y += 1) {
      const ty = oy + y;
      if (ty < 0 || ty >= ROWS) continue;
      for (let x = 0; x < bmp.w; x += 1) {
        if (!bmp.bits[y * bmp.w + x]) continue;
        const tx = ox + x;
        if (tx < 0 || tx >= cols) continue;
        if (mask && !mask(tx, ty, x)) continue;
        target[ty * cols + tx] = 1;
      }
    }
  };

  const blitSpans = (bmp, ox, oy, offsetFor) => {
    bmp.spans.forEach((s, i) => {
      const dy = offsetFor(i);
      if (dy === null) return;
      for (let y = 0; y < GLYPH_ROWS; y += 1) {
        const ty = oy + y + dy;
        if (ty < 0 || ty >= ROWS) continue;
        for (let x = 0; x < s.w; x += 1) {
          if (!s.g.bits[y * s.w + x]) continue;
          const tx = ox + s.x + x;
          if (tx >= 0 && tx < cols) target[ty * cols + tx] = 1;
        }
      }
    });
  };

  const bar = (col) => {
    if (col < 0 || col >= cols) return;
    for (let y = 0; y < ROWS; y += 1) target[y * cols + col] = 1;
  };

  const compose = () => {
    clear();
    if (editing) {
      const bmp = rasterize(draft || "");
      const cursorW = 5;
      const room = cols - 4;
      const total = (draft ? bmp.w + 2 : 0) + cursorW;
      const ox = total > room ? cols - 2 - total : 2;
      if (draft) blit(bmp, ox, TOP);
      const cx = ox + (draft ? bmp.w + 2 : 0);
      const blinkOn = clock - lastTyped < 0.5 || Math.floor((clock - lastTyped) / 0.53) % 2 === 1;
      if (blinkOn) {
        for (let y = 0; y < 7; y += 1) for (let x = 0; x < cursorW; x += 1) {
          const tx = cx + x;
          if (tx >= 0 && tx < cols) target[(TOP + y) * cols + tx] = 1;
        }
      }
      return;
    }
    if (!show) return;
    const s = show;
    const { bmp, x0, t } = s;
    const n = bmp.spans.length;
    if (s.phase === "enter") {
      if (s.enter === "run") {
        const ox = cols - Math.floor(t * SPEED);
        blit(bmp, ox, TOP);
        if (ox < -bmp.w - 2) s.done = true;
        return;
      }
      if (s.enter === "scroll") {
        const ox = Math.max(x0, cols - Math.floor(t * SPEED * 1.4));
        blit(bmp, ox, TOP);
        if (ox === x0) s.done = true;
        return;
      }
      if (s.enter === "wipe") {
        const edge = x0 - 2 + Math.floor(t * 64);
        blit(bmp, x0, TOP, (tx) => tx < edge);
        if (edge <= x0 + bmp.w + 1) bar(edge);
        else s.done = true;
        return;
      }
      if (s.enter === "drop") {
        let landed = 0;
        blitSpans(bmp, x0, TOP, (i) => {
          const tau = t - i * 0.06;
          if (tau < 0) return null;
          const fall = Math.floor(0.5 * 150 * tau * tau);
          const dy = Math.min(0, -ROWS + fall);
          if (dy === 0) landed += 1;
          return dy;
        });
        if (landed === n) s.done = true;
        return;
      }
      if (s.enter === "dissolve") {
        const p = t / 0.9;
        blit(bmp, x0, TOP, (tx, ty) => hash(tx, ty, s.salt) < p);
        if (p >= 1) s.done = true;
        return;
      }
      if (s.enter === "roll") {
        const dy = Math.max(0, ROWS - Math.floor(t * 30));
        blit(bmp, x0, TOP + dy);
        if (dy === 0) s.done = true;
        return;
      }
      if (s.enter === "open") {
        const mid = x0 + bmp.w / 2;
        const half = t * 44;
        blit(bmp, x0, TOP, (tx) => Math.abs(tx + 0.5 - mid) < half);
        const l = Math.floor(mid - half);
        const r = Math.ceil(mid + half) - 1;
        if (half < bmp.w / 2 + 1) {
          bar(l);
          bar(r);
        } else s.done = true;
        return;
      }
    }
    if (s.phase === "hold") {
      if (s.flash && t > s.hold - 0.9) {
        const k = Math.floor((t - (s.hold - 0.9)) / 0.18);
        if (k % 2 === 0 && k < 4) return;
      }
      blit(bmp, x0, TOP);
      return;
    }
    if (s.phase === "exit") {
      if (s.exit === "dissolve") {
        const p = t / 0.75;
        blit(bmp, x0, TOP, (tx, ty) => hash(tx, ty, s.salt + 7) >= p);
        if (p >= 1) s.done = true;
        return;
      }
      if (s.exit === "roll") {
        const dy = Math.floor(t * 30);
        blit(bmp, x0, TOP - dy);
        if (dy > ROWS) s.done = true;
        return;
      }
      if (s.exit === "wipe") {
        const edge = x0 - 2 + Math.floor(t * 64);
        blit(bmp, x0, TOP, (tx) => tx > edge);
        if (edge <= x0 + bmp.w + 1) bar(edge);
        else s.done = true;
        return;
      }
      if (s.exit === "drop") {
        let gone = 0;
        blitSpans(bmp, x0, TOP, (i) => {
          const tau = t - (n - 1 - i) * 0.045;
          if (tau < 0) return 0;
          const dy = Math.floor(0.5 * 150 * tau * tau);
          if (dy >= ROWS) {
            gone += 1;
            return null;
          }
          return dy;
        });
        if (gone === n) s.done = true;
        return;
      }
      if (s.exit === "close") {
        const mid = x0 + bmp.w / 2;
        const half = bmp.w / 2 + 1 - t * 44;
        blit(bmp, x0, TOP, (tx) => Math.abs(tx + 0.5 - mid) < half);
        if (half > 0) {
          bar(Math.floor(mid - half));
          bar(Math.ceil(mid + half) - 1);
        } else s.done = true;
        return;
      }
      if (s.exit === "scroll") {
        const ox = x0 - Math.floor(t * SPEED * 1.4);
        blit(bmp, ox, TOP);
        if (ox < -bmp.w - 1) s.done = true;
      }
    }
  };

  const advance = (dt) => {
    if (editing) {
      if (draft && clock - lastTyped > 6) commit();
      return;
    }
    if (!show) {
      startNext();
      return;
    }
    show.t += dt;
    if (show.phase === "hold" && show.t >= show.hold) {
      show.phase = "exit";
      show.t = 0;
      show.done = false;
    }
    if (show.done) {
      show.done = false;
      if (show.phase === "enter" && show.enter !== "run") {
        show.phase = "hold";
        show.t = 0;
      } else if (show.phase === "exit" || show.enter === "run") {
        show = null;
        startNext();
      }
    }
  };

  const beginEdit = () => {
    if (editing) return;
    editing = true;
    draft = "";
    input.value = "";
    lastTyped = clock;
    sound?.relay();
    wake();
  };

  const typeText = (text) => {
    if (!editing) beginEdit();
    draft = text.slice(0, MAX_CHARS);
    lastTyped = clock;
    sound?.key();
    wake();
  };

  function commit() {
    const text = draft.trim();
    editing = false;
    draft = "";
    input.value = "";
    if (!text) {
      show = null;
      return;
    }
    const at = index % (playlist.length + 1);
    playlist.splice(at, 0, text);
    index = at;
    show = null;
    startNext();
    wake();
  }

  const cancel = () => {
    editing = false;
    draft = "";
    input.value = "";
    show = null;
    wake();
  };

  const isOwnTarget = (t) => !t || t === document.body || t === root || t === canvas || stage.contains(t);

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t === input) {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        input.blur();
      }
      return;
    }
    if (t && t !== document.body && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable)) return;
    if (!isOwnTarget(t) && embedded) return;
    if (e.key === "Enter") {
      if (editing) {
        e.preventDefault();
        commit();
      }
      return;
    }
    if (e.key === "Escape") {
      if (editing) {
        e.preventDefault();
        cancel();
      }
      return;
    }
    if (e.key === "Backspace") {
      if (editing) {
        e.preventDefault();
        typeText([...draft].slice(0, -1).join(""));
        input.value = draft;
      }
      return;
    }
    if (e.key.length === 1 || e.key === "Spacebar") {
      e.preventDefault();
      const ch = e.key === "Spacebar" ? " " : e.key;
      if (!editing && ch === " ") return;
      typeText(draft + ch);
      input.value = draft;
    }
  };

  const onInput = () => {
    typeText(input.value);
  };

  const onPointerDown = (e) => {
    if (e.button > 0 || e.pointerType !== "mouse") return;
    if (!editing) {
      show = null;
      wake();
    }
  };

  const onPointerUp = (e) => {
    if (e.pointerType === "mouse") return;
    input.focus({ preventScroll: true });
    if (!editing) beginEdit();
  };

  const onBlur = () => {
    if (editing && draft.trim()) commit();
    else if (editing) cancel();
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    W = sr.width;
    H = sr.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const narrow = W < 640;
    const side = narrow ? 12 : 24;
    pitch = Math.max(7, Math.min(22, W / (narrow ? 50 : 64)));
    pitch = Math.round(pitch * dpr) / dpr;
    const nextCols = Math.floor((W - side * 2) / pitch);
    const signW = nextCols * pitch;
    const signH = ROWS * pitch;
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const centre = Math.max(H / 2, capBottom + 24 + signH / 2);
    originX = Math.round(((W - signW) / 2) * dpr);
    originY = Math.round((centre - signH / 2) * dpr);
    root.style.width = `${W}px`;
    root.style.height = `${H}px`;
    input.style.left = `${(W - signW) / 2}px`;
    input.style.top = `${centre - signH / 2}px`;
    input.style.width = `${signW}px`;
    input.style.height = `${signH}px`;
    gl.resize(Math.round(W * dpr), Math.round(H * dpr));
    if (nextCols !== cols) {
      cols = nextCols;
      target = new Uint8Array(cols * ROWS);
      level = new Float32Array(cols * ROWS);
      bytes = new Uint8Array(cols * ROWS);
      if (show) {
        const keep = show;
        show = makeShow(keep.text, keep.enter === "run" ? undefined : keep.enter);
        show.phase = keep.phase === "enter" ? "enter" : "hold";
        show.t = keep.phase === "enter" ? 0 : keep.t;
      }
    }
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    clock += dt;
    if (fade < 1) fade = Math.min(1, fade + dt / 0.5);
    advance(dt);
    compose();
    const rise = Math.min(1, dt / 0.012);
    const fall = Math.exp(-dt / 0.035);
    let lit = 0;
    for (let i = 0; i < target.length; i += 1) {
      const tv = target[i];
      let v = level[i];
      v = tv ? v + (1 - v) * rise : v * fall;
      if (v < 0.004) v = 0;
      level[i] = v;
      bytes[i] = Math.round(v * 255);
      lit += tv;
    }
    const frac = lit / target.length;
    if (Math.abs(frac - litFraction) > 0.01) {
      litFraction = frac;
      sound?.load(frac * 3);
    }
    gl.render({ dots: bytes, cols, rows: ROWS, origin: [originX, originY], pitch: pitch * dpr, fade: fade * fade * (3 - 2 * fade) });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  window.addEventListener("keydown", onKey);
  input.addEventListener("input", onInput);
  input.addEventListener("blur", onBlur);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerup", onPointerUp);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  layout(true);
  show = makeShow(playlist[0], "wipe");
  index = 1;
  if (reduced) {
    show.phase = "hold";
    show.t = 0;
  }
  ready = true;
  root.dataset.ready = "";
  wake();

  return {
    async setSound(on) {
      if (on && !sound) sound = createMarqueeSound();
      if (!sound) return false;
      const result = await sound.setEnabled(on);
      if (result) sound.load(litFraction * 3);
      return result;
    },
    write() {
      input.focus({ preventScroll: true });
      beginEdit();
    },
    destroy() {
      destroyed = true;
      sleep();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onBlur);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
      input.remove();
    },
  };
}
