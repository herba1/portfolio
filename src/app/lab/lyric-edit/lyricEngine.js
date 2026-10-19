import { createLyricAudio } from "./lyricAudio";
import { createLyricGL } from "./lyricGL";
import { BEAT, FONT_FAMILY, LOOP, LYRIC, buildEvents, demoTake, layoutPhrase } from "./lyricText";

const START_AT = 3.35;
const ENTRY = 0.17;
const CLEAR_FADE = 0.09;
const FOCUS = [0.5, 0.56];
const ZOOM = 1.075;

const mod = (a, n) => ((a % n) + n) % n;
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

function camera(t) {
  const x =
    0.0062 * Math.sin(t * 0.37 + 1.1) +
    0.0041 * Math.sin(t * 0.83 + 2.3) +
    0.0016 * Math.sin(t * 2.71 + 0.4) +
    0.0005 * Math.sin(t * 7.3 + 1.9);
  const y =
    0.0048 * Math.sin(t * 0.29 + 0.2) +
    0.0035 * Math.sin(t * 0.91 + 4.1) +
    0.0014 * Math.sin(t * 3.13 + 2.2) +
    0.0005 * Math.sin(t * 6.7 + 0.7);
  const r = 0.0042 * Math.sin(t * 0.23 + 0.6) + 0.0022 * Math.sin(t * 0.67 + 2.9) + 0.0006 * Math.sin(t * 3.7 + 1.3);
  const z = ZOOM + 0.012 * Math.sin(t * 0.11 + 0.5);
  return [x, y, r, z];
}

export function createLyricEngine(opts) {
  const { stage, canvas, marks, head, readout, embedded, imageSrc, onMode, onSound, onReady, onFail } = opts;
  let gl = null;
  try {
    gl = createLyricGL(canvas);
  } catch {
    gl = null;
  }
  if (!gl) {
    onFail?.();
    return { destroy() {}, setSound: async () => false, replay() {}, tap() {} };
  }

  const audio = createLyricAudio();
  const events = buildEvents();
  const phraseStart = [];
  events.forEach((ev, i) => {
    if (ev.kind === "word" && ev.index === 0) phraseStart[ev.phrase] = i;
  });
  const textCanvas = document.createElement("canvas");
  const tctx = textCanvas.getContext("2d");

  let take = demoTake();
  let rec = null;
  let audioClock = false;
  let soundWanted = null;
  let origin = performance.now() / 1000 - START_AT;
  let w = 1;
  let h = 1;
  let dpr = 1;
  let layouts = [];
  let textKey = "";
  let imageReady = false;
  let fontReady = false;
  let readyAt = 0;
  let visible = true;
  let destroyed = false;
  let raf = 0;
  let lastSecond = -1;
  let marksKey = "";
  let trackW = 1;
  let started = performance.now() / 1000;

  const now = () => (audioClock ? audio.time() - audio.latency : performance.now() / 1000);
  const pos = () => mod(now() - origin, LOOP);

  const syncAudio = () => {
    if (!audioClock) return;
    const when = audio.time() + 0.03;
    audio.startBeat(when, mod(when - origin, LOOP));
  };

  const switchClock = (useAudio) => {
    const x = pos();
    const recElapsed = rec ? now() - rec.startClock : 0;
    audioClock = useAudio;
    origin = now() - x;
    if (rec) rec.startClock = now() - recElapsed;
    if (useAudio) syncAudio();
    else audio.stopBeat();
  };

  const layoutFor = (phrase) => {
    if (!layouts[phrase]) layouts[phrase] = layoutPhrase(tctx, LYRIC[phrase], w, h, dpr);
    return layouts[phrase];
  };

  const stateAt = (e) => {
    const times = take.times;
    let k = 0;
    while (k < times.length && times[k] <= e) k += 1;
    if (k === 0) return { phrase: -1, count: 0, ages: [], fade: 1, latest: Infinity };
    const last = events[k - 1];
    const latest = e - times[k - 1];
    if (last.kind === "clear") {
      if (latest < CLEAR_FADE) {
        const n = LYRIC[last.phrase].length;
        const ages = [];
        for (let i = 0; i < n; i += 1) ages.push(1);
        return { phrase: last.phrase, count: n, ages, fade: 1 - latest / CLEAR_FADE, latest: Infinity };
      }
      return { phrase: -1, count: 0, ages: [], fade: 1, latest: Infinity };
    }
    const ages = [];
    for (let i = 0; i <= last.index; i += 1) ages.push(e - times[phraseStart[last.phrase] + i]);
    return { phrase: last.phrase, count: last.index + 1, ages, fade: 1, latest };
  };

  const drawText = (s) => {
    const animating = s.fade < 1 || s.ages.some((a) => a < ENTRY);
    const key = `${s.phrase}:${s.count}:${w}:${h}`;
    if (!animating && key === textKey) return;
    textKey = animating ? "" : key;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
    if (s.phrase >= 0) {
      const lay = layoutFor(s.phrase);
      tctx.font = lay.font;
      tctx.fillStyle = "#fff";
      tctx.textBaseline = "alphabetic";
      for (let i = 0; i < s.count; i += 1) {
        const slot = lay.slots[i];
        const p = clamp(s.ages[i] / ENTRY, 0, 1);
        const ease = 1 - (1 - p) ** 3;
        tctx.globalAlpha = clamp(p * 3.2, 0, 1) * s.fade;
        tctx.fillText(LYRIC[s.phrase][i], slot.x, slot.y - (1 - ease) * lay.size * 0.16);
      }
      tctx.globalAlpha = 1;
    }
    gl.setText(textCanvas);
  };

  const renderMarks = () => {
    const key = `${take.start}:${take.times.length}:${rec ? 1 : 0}`;
    if (key === marksKey) return;
    marksKey = key;
    if (!marks) return;
    const parts = take.times.map((t, i) => {
      const at = mod(take.start + t, LOOP) / LOOP;
      const kind = events[i].kind;
      return `<span class="lyric-edit-mark" data-kind="${kind}" style="left:${(at * 100).toFixed(3)}%"></span>`;
    });
    marks.innerHTML = parts.join("");
  };

  const updateChrome = (x) => {
    if (head) head.style.transform = `translate3d(${(x / LOOP) * trackW}px,0,0)`;
    const sec = Math.floor(x);
    if (readout && sec !== lastSecond) {
      lastSecond = sec;
      readout.textContent = `0:${String(sec).padStart(2, "0")}`;
    }
  };

  const finishTake = () => {
    if (!rec) return;
    rec = null;
    marksKey = "";
    renderMarks();
    onMode?.("take");
  };

  const frame = () => {
    raf = 0;
    if (destroyed || !visible || document.hidden) return;
    const x = pos();
    if (rec && now() - rec.startClock >= LOOP - 0.04) finishTake();
    const e = mod(x - take.start, LOOP);
    const s = stateAt(e);
    if (fontReady) drawText(s);
    const t = performance.now() / 1000 - started;
    const fade = imageReady ? clamp((performance.now() - readyAt) / 900, 0, 1) : 0;
    gl.draw({
      cover: coverFor(),
      focus: focusFor(),
      cam: camera(t),
      frame: Math.floor(t * 24) % 997,
      flash: Math.max(0, 1 - s.latest / 0.3) * 0.8,
      fade: fade * fade * (3 - 2 * fade),
      grain: Math.max(1, dpr),
    });
    updateChrome(x);
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (raf || destroyed || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  };

  let cover = [1, 1];
  const coverFor = () => cover;
  const focusFor = () => {
    const vx = cover[0] / ZOOM / 2 + 0.02;
    const vy = cover[1] / ZOOM / 2 + 0.02;
    return [clamp(FOCUS[0], vx, 1 - vx), clamp(FOCUS[1], vy, 1 - vy)];
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    gl.setSize(pw, ph);
    textCanvas.width = pw;
    textCanvas.height = ph;
    layouts = [];
    textKey = "";
    const [iw, ih] = gl.imageSize;
    const a = iw / ih;
    const A = w / h;
    cover = A > a ? [1, a / A] : [A / a, 1];
    if (marks) trackW = marks.getBoundingClientRect().width || 1;
    wake();
  };

  const tap = () => {
    if (!imageReady) return;
    if (!rec) {
      take = { start: pos(), times: [], demo: false };
      rec = { startClock: now() };
      onMode?.("rec");
    }
    const e = now() - rec.startClock;
    take.times.push(Math.max(e, take.times.length ? take.times[take.times.length - 1] + 0.001 : 0));
    const ev = events[take.times.length - 1];
    audio.tick(ev.kind);
    if (take.times.length >= events.length) finishTake();
    renderMarks();
    if (soundWanted === null && !embedded) setSound(true);
  };

  const replay = () => {
    if (rec) finishTake();
    origin = now() - mod(take.start - BEAT * 2, LOOP);
    syncAudio();
    lastSecond = -1;
    wake();
  };

  async function setSound(on) {
    soundWanted = on;
    if (on) {
      const ok = await audio.enable();
      if (destroyed) return false;
      if (!ok || soundWanted !== true) {
        onSound?.(false);
        return false;
      }
      if (!audioClock) switchClock(true);
      onSound?.(true);
      return true;
    }
    if (audioClock) switchClock(false);
    onSound?.(false);
    return false;
  }

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest?.("button, a, [data-lyric-edit-chrome]")) return;
    tap();
  };

  const onKey = (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space" || e.key === " ") {
      if (tag === "BUTTON") return;
      e.preventDefault();
      tap();
    } else if (e.key === "Escape" && rec) {
      finishTake();
    }
  };

  const onVisibility = () => {
    if (document.hidden) {
      if (audioClock) audio.suspend();
    } else {
      if (audioClock) audio.resume();
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
  if (marks) ro.observe(marks);
  stage.addEventListener("pointerdown", onPointerDown);
  if (!embedded) window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);

  const fontLoad = document.fonts
    ? document.fonts.load(`400 48px ${FONT_FAMILY}`).catch(() => null)
    : Promise.resolve(null);
  Promise.all([loadImage(imageSrc), fontLoad])
    .then(([img]) => {
      if (destroyed) return;
      gl.setImage(img);
      fontReady = true;
      imageReady = true;
      resize();
      readyAt = performance.now();
      started = performance.now() / 1000;
      renderMarks();
      onMode?.("demo");
      onReady?.();
      wake();
    })
    .catch(() => onFail?.());

  resize();

  return {
    tap,
    replay,
    setSound,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      stage.removeEventListener("pointerdown", onPointerDown);
      if (!embedded) window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      audio.destroy();
      gl.destroy();
    },
  };
}
