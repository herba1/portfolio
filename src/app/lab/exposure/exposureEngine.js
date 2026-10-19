import { createExposureAudio } from "./exposureAudio";
import { createExposureGL } from "./exposureGL";

export const FONT_FAMILY = "ExposureArimo";
export const STEP = 12;
export const START_EV = 1;
const LIMIT = 108;
const ZOOM = 1.04;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function formatEv(v) {
  const thirds = Math.round(v * 3);
  if (thirds === 0) return "±0";
  const sign = thirds > 0 ? "+" : "−";
  const whole = Math.floor(Math.abs(thirds) / 3);
  const rest = Math.abs(thirds) % 3;
  const frac = rest === 1 ? "⅓" : rest === 2 ? "⅔" : "";
  return `${sign}${whole || !frac ? whole : ""}${frac}`;
}

export function spokenEv(v) {
  const thirds = Math.round(v * 3);
  if (thirds === 0) return "0 EV";
  const sign = thirds > 0 ? "plus" : "minus";
  const whole = Math.floor(Math.abs(thirds) / 3);
  const rest = Math.abs(thirds) % 3;
  const parts = [];
  if (whole) parts.push(String(whole));
  if (rest) parts.push(rest === 1 ? "one third" : "two thirds");
  return `${sign} ${parts.join(" and ")} EV`;
}

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
  const x = 0.0024 * Math.sin(t * 0.21 + 1.1) + 0.0012 * Math.sin(t * 0.53 + 2.3);
  const y = 0.0018 * Math.sin(t * 0.17 + 0.2) + 0.001 * Math.sin(t * 0.61 + 4.1);
  const r = 0.0012 * Math.sin(t * 0.13 + 0.6);
  return [x, y, r, ZOOM + 0.006 * Math.sin(t * 0.09)];
}

const magnet = (raw) => {
  const n = Math.round(raw / STEP);
  const f = raw / STEP - n;
  return STEP * (n + f - (0.72 * Math.sin(2 * Math.PI * f)) / (2 * Math.PI));
};

export function createExposureEngine(opts) {
  const { stage, canvas, knob, rotor, readout, embedded, photos, onEv, onReady, onFail } = opts;
  let gl = null;
  try {
    gl = createExposureGL(canvas);
  } catch {
    gl = null;
  }
  if (!gl) {
    onFail?.();
    return { destroy() {}, setSound: async () => false };
  }

  const audio = createExposureAudio();
  const textCanvas = document.createElement("canvas");
  const tctx = textCanvas.getContext("2d");
  let w = 1;
  let h = 1;
  let dpr = 1;
  let cover = [1, 1];
  let ready = false;
  let readyAt = 0;
  let visible = true;
  let destroyed = false;
  let raf = 0;
  let lastT = 0;
  const t0 = performance.now() / 1000;

  let angle = -START_EV * 36;
  let vel = 0;
  let target = angle;
  let raw = angle;
  let drag = null;
  let ev = START_EV;
  let lastDetent = Math.round(angle / STEP);
  let soundWanted = null;
  let wheelAcc = 0;
  let shownThirds = null;
  let current = 0;
  let wanted = 0;
  let swap = 1;
  let swapping = false;
  let loadToken = 0;
  const cache = new Map();

  const valueOf = (a) => -a / 36;

  const drawCaption = () => {
    const size = Math.round(clamp(Math.min(h * 0.036, w * 0.058), 18, 30)) * dpr;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
    tctx.font = `400 ${size}px ${FONT_FAMILY}, Arimo, Arial, sans-serif`;
    tctx.fillStyle = "#fff";
    tctx.textAlign = "center";
    tctx.textBaseline = "alphabetic";
    const maxW = w * dpr - 48 * dpr;
    const words = photos[current].caption.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && tctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length === 2 || (lines.length === 1 && w < 700)) {
      let best = 1;
      let bestW = Infinity;
      for (let i = 1; i < words.length; i += 1) {
        const wide = Math.max(tctx.measureText(words.slice(0, i).join(" ")).width, tctx.measureText(words.slice(i).join(" ")).width);
        if (wide < bestW) {
          bestW = wide;
          best = i;
        }
      }
      lines.splice(0, lines.length, words.slice(0, best).join(" "), words.slice(best).join(" "));
    }
    const lead = size * 1.18;
    const cy = h * dpr * (w < 700 ? 0.71 : 0.66);
    lines.forEach((l, i) => tctx.fillText(l, (w * dpr) / 2, cy + (i - (lines.length - 1) / 2) * lead + size * 0.35));
    gl.setText(textCanvas);
  };

  const updateDial = (now) => {
    if (rotor) rotor.style.transform = `rotate(${angle.toFixed(3)}deg)`;
    const thirds = Math.round(valueOf(angle) * 3);
    if (thirds !== shownThirds) {
      shownThirds = thirds;
      const v = thirds / 3;
      if (readout) readout.textContent = formatEv(v);
      if (knob) {
        knob.setAttribute("aria-valuenow", v.toFixed(2));
        knob.setAttribute("aria-valuetext", spokenEv(v));
      }
      onEv?.(v);
    }
    const detent = Math.round(angle / STEP);
    if (detent !== lastDetent) {
      const steps = Math.abs(detent - lastDetent);
      lastDetent = detent;
      const atStop = Math.abs(detent * STEP) >= LIMIT;
      audio.detent(Math.abs(vel) / 60 + steps, detent % 3 === 0, atStop);
    }
    return now;
  };

  const fetchPhoto = (i) => {
    if (!cache.has(i)) cache.set(i, loadImage(photos[i].src));
    return cache.get(i);
  };

  const choose = (i) => {
    if (!ready || i === wanted || !photos[i]) return;
    wanted = i;
    const token = ++loadToken;
    swapping = true;
    audio.shutter?.();
    wake();
    const started = performance.now();
    fetchPhoto(i)
      .then((img) => {
        const wait = Math.max(0, 230 - (performance.now() - started));
        window.setTimeout(() => {
          if (destroyed || token !== loadToken) return;
          gl.setImage(img);
          current = i;
          drawCaption();
          swapping = false;
          wake();
        }, wait);
      })
      .catch(() => {
        if (token !== loadToken) return;
        swapping = false;
        wanted = current;
        wake();
      });
  };

  const settled = () => !drag && Math.abs(angle - target) < 0.01 && Math.abs(vel) < 0.01;

  const frame = (ms) => {
    raf = 0;
    if (destroyed || !visible || document.hidden) return;
    const now = ms / 1000;
    const dt = clamp(lastT ? now - lastT : 1 / 60, 0, 0.5);
    lastT = now;
    if (drag) {
      const prev = angle;
      angle = magnet(raw);
      vel = (angle - prev) / Math.max(dt, 1 / 240);
    } else {
      const k = 900;
      const c = 2 * Math.sqrt(k) * 0.92;
      let rem = dt;
      while (rem > 0) {
        const step = Math.min(1 / 480, rem);
        const acc = -k * (angle - target) - c * vel;
        vel += acc * step;
        angle += vel * step;
        rem -= step;
      }
      if (settled()) {
        angle = target;
        vel = 0;
      }
    }
    const v = valueOf(angle);
    ev += (v - ev) * (1 - Math.exp(-dt / 0.07));
    updateDial(now);
    const t = performance.now() / 1000 - t0;
    if (swapping) swap = Math.max(0, swap - dt / 0.22);
    else if (swap < 1) swap = Math.min(1, swap + dt / 0.6);
    const fadeIn = ready ? clamp((performance.now() - readyAt) / 900, 0, 1) : 0;
    const [iw, ih] = gl.imageSize;
    const a = iw / ih;
    const A = w / h;
    cover = A > a ? [1, a / A] : [A / a, 1];
    const vx = cover[0] / ZOOM / 2 + 0.02;
    const vy = cover[1] / ZOOM / 2 + 0.02;
    gl.draw({
      cover,
      focus: [clamp(photos[current].focus[0], vx, 1 - vx), clamp(photos[current].focus[1], vy, 1 - vy)],
      cam: camera(t),
      ev,
      frame: Math.floor(t * 24) % 997,
      fade: fadeIn * fadeIn * (3 - 2 * fadeIn) * (swap * swap * (3 - 2 * swap)),
      grain: Math.max(1, dpr),
    });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (raf || destroyed || !visible || document.hidden) return;
    lastT = 0;
    raf = requestAnimationFrame(frame);
  }

  const setTarget = (a) => {
    target = clamp(Math.round(a / STEP) * STEP, -LIMIT, LIMIT);
    wake();
  };

  const centre = () => {
    const r = knob.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2];
  };

  const rubber = (a) => {
    if (a > LIMIT) return LIMIT + Math.min(10, (a - LIMIT) * 0.25);
    if (a < -LIMIT) return -LIMIT - Math.min(10, (-LIMIT - a) * 0.25);
    return a;
  };

  const wakeSound = () => {
    if (soundWanted === null && !embedded) setSound(true);
  };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    knob.focus({ preventScroll: true });
    knob.setPointerCapture?.(e.pointerId);
    const [cx, cy] = centre();
    drag = { id: e.pointerId, phi: Math.atan2(e.clientY - cy, e.clientX - cx), acc: 0, base: angle, x: e.clientX };
    raw = angle;
    knob.dataset.dragging = "";
    wakeSound();
    wake();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [cx, cy, r] = centre();
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const phi = Math.atan2(dy, dx);
    let d = phi - drag.phi;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    drag.phi = phi;
    if (dist > r * 0.22) drag.acc += (d * 180) / Math.PI;
    else drag.acc += (e.clientX - drag.x) * 0.5;
    drag.x = e.clientX;
    raw = rubber(drag.base + drag.acc);
    wake();
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    delete knob.dataset.dragging;
    setTarget(clamp(magnet(raw), -LIMIT, LIMIT));
  };

  const nudge = (thirds) => {
    wakeSound();
    setTarget(target - thirds * STEP);
  };

  const onKey = (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") nudge(1);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") nudge(-1);
    else if (e.key === "PageUp") nudge(3);
    else if (e.key === "PageDown") nudge(-3);
    else if (e.key === "Home") setTarget(-LIMIT);
    else if (e.key === "End") setTarget(LIMIT);
    else if (e.key === "0") setTarget(0);
    else return;
    e.preventDefault();
  };

  const onWheel = (e) => {
    if (embedded) return;
    e.preventDefault();
    wheelAcc += e.deltaY + e.deltaX;
    const steps = Math.trunc(wheelAcc / 48);
    if (steps) {
      wheelAcc -= steps * 48;
      nudge(-steps);
    }
  };

  async function setSound(on) {
    soundWanted = on;
    const ok = await audio.setEnabled(on);
    return ok;
  }

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
    if (ready) drawCaption();
    wake();
  };

  const onVisibility = () => {
    if (!document.hidden) wake();
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    wake();
  });
  io.observe(stage);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  knob.addEventListener("pointerdown", onDown);
  knob.addEventListener("pointermove", onMove);
  knob.addEventListener("pointerup", onUp);
  knob.addEventListener("pointercancel", onUp);
  knob.addEventListener("keydown", onKey);
  stage.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("visibilitychange", onVisibility);

  const fontLoad = document.fonts ? document.fonts.load(`400 30px ${FONT_FAMILY}`).catch(() => null) : Promise.resolve(null);
  Promise.all([fetchPhoto(0), fontLoad])
    .then(([img]) => {
      if (destroyed) return;
      gl.setImage(img);
      ready = true;
      resize();
      readyAt = performance.now();
      onReady?.();
      wake();
    })
    .catch(() => onFail?.());

  resize();

  return {
    setSound,
    choose,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      knob.removeEventListener("pointerdown", onDown);
      knob.removeEventListener("pointermove", onMove);
      knob.removeEventListener("pointerup", onUp);
      knob.removeEventListener("pointercancel", onUp);
      knob.removeEventListener("keydown", onKey);
      stage.removeEventListener("wheel", onWheel);
      document.removeEventListener("visibilitychange", onVisibility);
      audio.destroy();
      gl.destroy();
    },
  };
}
