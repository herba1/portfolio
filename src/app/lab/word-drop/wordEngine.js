import { createWordAudio } from "./wordAudio";
import { createWordGL } from "./wordGL";

export const FONT_FAMILY = "WordDropArimo";

export const PHRASES = [
  "light is all over the water today",
  "hold still i want to keep this one",
  "it will take a while to feel like this again",
  "we were never in a hurry out here",
].map((p) => p.split(" "));

const BASE_ZOOM = 1.09;
const POP = [
  [0.05, 1.34],
  [0.1, 1.12],
];

const DEMO = [
  { at: [0.1, 0.3], mobile: [0.08, 0.36] },
  { at: [0.08, 0.24], mobile: [0.08, 0.2] },
  { at: [0.56, 0.22], mobile: [0.1, 0.26] },
  { at: [0.1, 0.2], mobile: [0.1, 0.22] },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function camera(t, zoom) {
  const x =
    0.009 * Math.sin(t * 0.41 + 1.1) +
    0.006 * Math.sin(t * 0.97 + 2.3) +
    0.0022 * Math.sin(t * 2.9 + 0.4) +
    0.0007 * Math.sin(t * 7.9 + 1.9);
  const y =
    0.007 * Math.sin(t * 0.33 + 0.2) +
    0.005 * Math.sin(t * 1.07 + 4.1) +
    0.0026 * Math.sin(t * 3.6 + 2.2) +
    0.0008 * Math.sin(t * 8.3 + 0.7);
  const r = 0.006 * Math.sin(t * 0.27 + 0.6) + 0.003 * Math.sin(t * 0.81 + 2.9) + 0.0009 * Math.sin(t * 4.1 + 1.3);
  const z = zoom * (1 + 0.014 * Math.sin(t * 0.19 + 0.5));
  return [x, y, r, z];
}

export function createWordEngine(opts) {
  const { stage, canvas, layer, shots, embedded, onState, onSound, onReady, onFail } = opts;
  let gl = null;
  try {
    gl = createWordGL(canvas);
  } catch {
    gl = null;
  }
  if (!gl) {
    onFail?.();
    return { destroy() {}, setSound: async () => false };
  }

  const audio = createWordAudio();
  const measureCtx = document.createElement("canvas").getContext("2d");
  let w = 1;
  let h = 1;
  let dpr = 1;
  let fs = 40;
  let ready = false;
  let visible = true;
  let destroyed = false;
  let raf = 0;
  let readyAt = 0;
  const t0 = performance.now() / 1000;
  let shot = 0;
  let phrase = 0;
  let next = 0;
  let blocks = [];
  let words = [];
  let demo = true;
  let demoTimer = 0;
  let soundWanted = null;
  let cutFlash = 0;
  let view = { cover: [1, 1], focus: [0.5, 0.5], cam: [0, 0, 0, BASE_ZOOM] };

  const shotZoom = () => BASE_ZOOM * (shots[shot].zoom || 1);

  const viewFor = (t) => {
    const [iw, ih] = gl.sizeOf(shot);
    const a = iw / ih;
    const A = w / h;
    const cover = A > a ? [1, a / A] : [A / a, 1];
    const zoom = shotZoom();
    const vx = cover[0] / zoom / 2 + 0.025;
    const vy = cover[1] / zoom / 2 + 0.025;
    const f = shots[shot].focus;
    const focus = [clamp(f[0], vx, 1 - vx), clamp(f[1], vy, 1 - vy)];
    return { cover, focus, cam: camera(t, zoom) };
  };

  const toScreen = (iu, iv) => {
    const { cover, focus, cam } = view;
    let px = ((iu - focus[0]) / cover[0]) * w - cam[0] * w;
    let py = ((iv - focus[1]) / cover[1]) * h - cam[1] * h;
    px *= cam[3];
    py *= cam[3];
    const c = Math.cos(cam[2]);
    const s = Math.sin(cam[2]);
    return [c * px - s * py + w / 2, s * px + c * py + h / 2];
  };

  const toImage = (sx, sy) => {
    const { cover, focus, cam } = view;
    const x = sx - w / 2;
    const y = sy - h / 2;
    const c = Math.cos(cam[2]);
    const s = Math.sin(cam[2]);
    let px = (c * x + s * y) / cam[3];
    let py = (-s * x + c * y) / cam[3];
    px += cam[0] * w;
    py += cam[1] * h;
    return [(px / w) * cover[0] + focus[0], (py / h) * cover[1] + focus[1]];
  };

  const font = () => `400 ${fs}px ${FONT_FAMILY}, Arimo, Arial, sans-serif`;

  const measure = (text) => {
    measureCtx.font = font();
    return measureCtx.measureText(text).width;
  };

  const report = () => {
    onState?.({ next: PHRASES[phrase][next] ?? null, phrase, total: PHRASES.length, done: next >= PHRASES[phrase].length, demo });
  };

  const clearWords = () => {
    for (const word of words) word.el.remove();
    words = [];
    blocks = [];
  };

  const makeWord = (text, block, ox, oy, width, now) => {
    const el = document.createElement("span");
    el.className = "word-drop-word";
    el.textContent = text;
    el.style.fontSize = `${fs}px`;
    el.style.marginLeft = `${-width / 2}px`;
    el.style.marginTop = `${-fs / 2}px`;
    layer.appendChild(el);
    const word = { el, block, ox, oy, width, born: now, fs };
    words.push(word);
    return word;
  };

  const placeWord = (sx, sy, now, quiet) => {
    const text = PHRASES[phrase][next];
    if (!text) return;
    const width = measure(text);
    const space = measure(" ") * 1.1;
    const lead = fs * 1.02;
    const k = view.cam[3] / shotZoom();
    const rectOf = (b) => {
      const [ax, ay] = toScreen(b.u, b.v);
      return [ax, ay, b.measure * k, (b.line + 1) * lead * k];
    };
    const margin = fs * 2.2;
    let block = null;
    for (let i = blocks.length - 1; i >= 0 && !block; i -= 1) {
      const [ax, ay, bw, bh] = rectOf(blocks[i]);
      if (sx > ax - margin && sx < ax + bw + margin && sy > ay - margin && sy < ay + bh + margin) block = blocks[i];
    }
    if (!block) {
      const blockMeasure = Math.max(fs * 4.2, width);
      const left = clamp(sx - width / 2, 16, Math.max(16, w - blockMeasure - 16));
      const top = clamp(sy - lead / 2, 72, Math.max(72, h - lead * 4 - 96));
      for (const b of blocks) {
        const [ax, ay, bw, bh] = rectOf(b);
        if (left < ax + bw && left + blockMeasure > ax && top < ay + bh + lead * 2 && top + lead > ay - lead) block = b;
      }
      if (!block) {
        const [u, v] = toImage(left, top);
        block = { u, v, measure: blockMeasure, line: 0, cursor: 0 };
        blocks.push(block);
      }
    }
    if (block.cursor > 0 && block.cursor + space + width > block.measure) {
      block.line += 1;
      block.cursor = 0;
    }
    const x = block.cursor + (block.cursor > 0 ? space : 0);
    block.cursor = x + width;
    makeWord(text, block, (x + width / 2) / k, (block.line * lead + lead / 2) / k, width, quiet ? now - 1 : now);
    next += 1;
    if (!quiet) audio.pop(clamp((sx / w) * 2 - 1, -1, 1));
    report();
  };

  const cut = () => {
    clearWords();
    shot = (shot + 1) % shots.length;
    phrase = (phrase + 1) % PHRASES.length;
    next = 0;
    cutFlash = 1;
    audio.cut();
  };

  const tapAt = (sx, sy, quiet) => {
    if (!ready) return;
    const now = performance.now() / 1000;
    if (next >= PHRASES[phrase].length) {
      cut();
      view = viewFor(now - t0);
    }
    placeWord(sx, sy, now, quiet);
    wake();
  };

  const demoPoint = () => {
    const d = DEMO[shot % DEMO.length];
    const at = w < 700 ? d.mobile : d.at;
    const block = blocks[blocks.length - 1];
    if (block && next > 0) {
      const [ax, ay] = toScreen(block.u, block.v);
      return [ax + fs, ay + fs * 0.5];
    }
    return [at[0] * w + fs * 1.4, at[1] * h + fs * 0.5];
  };

  const demoStep = () => {
    demoTimer = 0;
    if (!demo || destroyed) return;
    const done = next >= PHRASES[phrase].length;
    const [x, y] = demoPoint();
    tapAt(x, y, false);
    const finished = next >= PHRASES[phrase].length;
    demoTimer = window.setTimeout(demoStep, finished ? 2600 : done ? 520 : 380 + (next % 3) * 120);
  };

  const stopDemo = () => {
    if (!demo) return;
    demo = false;
    if (demoTimer) window.clearTimeout(demoTimer);
    demoTimer = 0;
    report();
  };

  const updateWords = (now) => {
    const k = view.cam[3] / shotZoom();
    const c = Math.cos(view.cam[2]);
    const s = Math.sin(view.cam[2]);
    const rot = view.cam[2];
    for (const word of words) {
      const [ax, ay] = toScreen(word.block.u, word.block.v);
      const ox = word.ox * k;
      const oy = word.oy * k;
      const x = ax + c * ox - s * oy;
      const y = ay + s * ox + c * oy;
      const age = now - word.born;
      let pop = 1;
      for (const [until, scale] of POP) {
        if (age < until) {
          pop = scale;
          break;
        }
      }
      word.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${rot.toFixed(5)}rad) scale(${(k * pop).toFixed(4)})`;
    }
  };

  const frame = () => {
    raf = 0;
    if (destroyed || !visible || document.hidden) return;
    const now = performance.now() / 1000;
    const t = now - t0;
    view = viewFor(t);
    const fade = ready ? clamp((performance.now() - readyAt) / 700, 0, 1) : 0;
    gl.draw(shot, {
      ...view,
      frame: Math.floor(t * 24) % 997,
      fade: fade * fade * (3 - 2 * fade) * (1 + cutFlash * 0.12),
      grain: Math.max(1, dpr),
      blur: 0,
    });
    cutFlash = cutFlash > 0.5 ? 0.4 : 0;
    updateWords(now);
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (raf || destroyed || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  const relayoutWords = () => {
    const kept = words.map((word) => word.el.textContent);
    const savedPhrase = phrase;
    clearWords();
    next = 0;
    phrase = savedPhrase;
    if (!kept.length) return;
    const [x, y] = demoPoint();
    for (let i = 0; i < kept.length; i += 1) {
      const block = blocks[blocks.length - 1];
      const p = block ? toScreen(block.u, block.v) : [x, y];
      placeWord(block ? p[0] + fs : x, block ? p[1] + fs * 0.5 : y, 0, true);
    }
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const nw = Math.max(1, Math.round(rect.width));
    const nh = Math.max(1, Math.round(rect.height));
    const changed = nw !== w || nh !== h;
    w = nw;
    h = nh;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.setSize(Math.round(w * dpr), Math.round(h * dpr));
    fs = Math.round(clamp(Math.min(h * 0.072, w * 0.1), 28, 64));
    if (ready) {
      view = viewFor(performance.now() / 1000 - t0);
      if (changed) relayoutWords();
    }
    wake();
  };

  async function setSound(on) {
    soundWanted = on;
    if (on) {
      const ok = await audio.enable();
      if (destroyed) return false;
      if (!ok || soundWanted !== true) {
        if (ok) audio.disable();
        onSound?.(false);
        return false;
      }
      onSound?.(true);
      return true;
    }
    audio.disable();
    onSound?.(false);
    return false;
  }

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest?.("button, a, [data-word-drop-chrome]")) return;
    const rect = stage.getBoundingClientRect();
    stopDemo();
    tapAt(e.clientX - rect.left, e.clientY - rect.top, false);
    if (soundWanted === null && !embedded) setSound(true);
  };

  const onVisibility = () => {
    if (document.hidden) audio.suspend();
    else {
      audio.resume();
      wake();
    }
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    wake();
  });
  io.observe(stage);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  stage.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("visibilitychange", onVisibility);

  const fontLoad = document.fonts ? document.fonts.load(`400 48px ${FONT_FAMILY}`).catch(() => null) : Promise.resolve(null);
  Promise.all([...shots.map((s) => loadImage(s.src)), fontLoad])
    .then((loaded) => {
      if (destroyed) return;
      for (let i = 0; i < shots.length; i += 1) gl.addImage(loaded[i]);
      ready = true;
      resize();
      view = viewFor(performance.now() / 1000 - t0);
      const [x, y] = demoPoint();
      for (let i = 0; i < 4; i += 1) {
        const block = blocks[blocks.length - 1];
        const p = block ? toScreen(block.u, block.v) : [x, y];
        placeWord(block ? p[0] + fs : x, block ? p[1] + fs * 0.5 : y, 0, true);
      }
      readyAt = performance.now();
      onReady?.();
      report();
      demoTimer = window.setTimeout(demoStep, 1400);
      wake();
    })
    .catch(() => onFail?.());

  resize();

  return {
    setSound,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (demoTimer) window.clearTimeout(demoTimer);
      io.disconnect();
      ro.disconnect();
      stage.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
      clearWords();
      audio.destroy();
      gl.destroy();
    },
  };
}
