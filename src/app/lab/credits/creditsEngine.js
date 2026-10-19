import { createProjector } from "./creditsAudio";

const NATURAL = 40;
const MAX_SPEED = 1200;
const RELAX = 1.6;
const WHEEL_GAIN = 5;
const FRAME = 1 / 24;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createCredits(root, { film, gate, roll, finale, grain, onEnd }) {
  const gctx = grain.getContext("2d");
  const tiles = [];
  for (let t = 0; t < 4; t += 1) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const x = c.getContext("2d");
    const img = x.createImageData(256, 256);
    let seed = 4100 + t * 977;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const a = seed / 4294967296;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const b = seed / 4294967296;
      const v = clamp(128 + (a + b - 1) * 220, 0, 255);
      img.data[i] = v;
      img.data[i + 1] = v * 0.97;
      img.data[i + 2] = v * 0.92;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    tiles.push(c);
  }

  let W = 0;
  let H = 0;
  let p = 0;
  let v = NATURAL;
  let end = 1;
  let drag = null;
  let raf = 0;
  let last = 0;
  let filmClock = 0;
  let frameIndex = 0;
  let still = 0;
  let visible = true;
  let destroyed = false;
  let paused = false;
  let ended = false;
  let projector = null;
  let speck = null;
  let seed = 7;
  let seek = null;

  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const measure = () => {
    const rect = film.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    const fr = finale.getBoundingClientRect();
    const rr = roll.getBoundingClientRect();
    const finaleCenter = fr.top - rr.top + fr.height / 2;
    end = Math.max(1, finaleCenter - H / 2);
    p = clamp(p, 0, end);
    const scale = 0.5;
    grain.width = Math.max(1, Math.round(W * scale));
    grain.height = Math.max(1, Math.round(H * scale));
    drawGrain();
    place();
  };

  const place = () => {
    roll.style.transform = `translate3d(0, ${(-p).toFixed(2)}px, 0)`;
  };

  const drawGrain = () => {
    const w = grain.width;
    const h = grain.height;
    gctx.globalCompositeOperation = "source-over";
    gctx.globalAlpha = 1;
    const tile = tiles[frameIndex % tiles.length];
    const ox = -Math.floor(rand() * 256);
    const oy = -Math.floor(rand() * 256);
    for (let y = oy; y < h; y += 256) for (let x = ox; x < w; x += 256) gctx.drawImage(tile, x, y);
    if (speck && speck.life > 0) {
      gctx.globalAlpha = speck.alpha;
      gctx.strokeStyle = "#fffaf0";
      gctx.fillStyle = "#fffaf0";
      gctx.lineWidth = speck.hair ? 0.7 : 0;
      if (speck.hair) {
        gctx.beginPath();
        gctx.moveTo(speck.x * w, speck.y * h);
        gctx.bezierCurveTo(speck.x * w + 6, speck.y * h + 10, speck.x * w - 4, speck.y * h + 18, speck.x * w + 3, speck.y * h + 28);
        gctx.stroke();
      } else {
        gctx.beginPath();
        gctx.arc(speck.x * w, speck.y * h, speck.r, 0, Math.PI * 2);
        gctx.fill();
      }
      gctx.globalAlpha = 1;
      speck.life -= 1;
    }
  };

  const weave = () => {
    const t = frameIndex * FRAME;
    const x = 0.55 * Math.sin(t * 2.3) + 0.35 * Math.sin(t * 5.1 + 1.2) + (rand() - 0.5) * 0.3;
    const y = 0.7 * Math.sin(t * 1.7 + 0.4) + 0.4 * Math.sin(t * 4.3) + (rand() - 0.5) * 0.4;
    const flicker = 0.955 + 0.03 * Math.sin(t * 9.1) + rand() * 0.015;
    gate.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    gate.style.opacity = flicker.toFixed(3);
  };

  const target = () => (paused || p >= end - 0.5 ? 0 : NATURAL);

  const step = (dt) => {
    if (!drag) {
      if (seek !== null) {
        const want = clamp((seek - p) * 2.4, -MAX_SPEED, MAX_SPEED);
        v += (want - v) * (1 - Math.exp(-dt * 6));
        if (Math.abs(seek - p) < 1.5) {
          p = seek;
          seek = null;
          v = 0;
        }
      } else {
        const goal = target();
        v += (goal - v) * (1 - Math.exp(-dt * RELAX));
      }
      v = clamp(v, -MAX_SPEED, MAX_SPEED);
      p += v * dt;
      if (p <= 0) {
        p = 0;
        if (v < 0) v = 0;
      }
      if (p >= end) {
        p = end;
        if (v > 0) v = 0;
      }
    }
    place();
    const nowEnded = p >= end - 0.5;
    if (nowEnded !== ended) {
      ended = nowEnded;
      onEnd?.(ended);
    }
    projector?.update(drag ? drag.v / NATURAL : v / NATURAL);
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    step(dt);
    filmClock += dt;
    if (filmClock >= FRAME) {
      filmClock %= FRAME;
      frameIndex += 1;
      if (!speck || speck.life <= 0) {
        if (rand() < 0.035) speck = { x: rand(), y: rand(), r: 0.6 + rand() * 1.2, alpha: 0.25 + rand() * 0.35, hair: rand() < 0.25, life: 1 + Math.floor(rand() * 2) };
      }
      drawGrain();
      weave();
    }
    const moving = drag || seek !== null || Math.abs(v) > 0.5;
    still = moving ? 0 : still + dt;
    if (visible && still < 3) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    still = 0;
    if (destroyed || raf || !visible) return;
    raf = requestAnimationFrame(frame);
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button, a")) return;
    film.setPointerCapture?.(e.pointerId);
    seek = null;
    drag = { id: e.pointerId, y: e.clientY, p0: p, y0: e.clientY, v: 0, samples: [{ t: e.timeStamp, y: e.clientY }] };
    root.dataset.dragging = "";
    v = 0;
    wake();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const want = drag.p0 - (e.clientY - drag.y0);
    let next = want;
    if (next < 0) next = next * 0.25;
    if (next > end) next = end + (next - end) * 0.25;
    p = next;
    drag.samples.push({ t: e.timeStamp, y: e.clientY });
    if (drag.samples.length > 10) drag.samples.shift();
    const a = drag.samples[0];
    const b = drag.samples[drag.samples.length - 1];
    drag.v = b.t > a.t ? (-(b.y - a.y) / (b.t - a.t)) * 1000 : 0;
    wake();
  };

  const onUp = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const samples = drag.samples;
    const lastSample = samples[samples.length - 1];
    let first = samples[0];
    for (const s of samples) {
      if (lastSample.t - s.t <= 100) {
        first = s;
        break;
      }
    }
    const span = lastSample.t - first.t;
    const idle = e ? e.timeStamp - lastSample.t : 0;
    v = span > 8 && idle < 80 ? clamp((-(lastSample.y - first.y) / span) * 1000, -MAX_SPEED, MAX_SPEED) : 0;
    if (p < 0 || p > end) v = 0;
    drag = null;
    delete root.dataset.dragging;
    wake();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    seek = null;
    v = clamp(v + dy * WHEEL_GAIN, -MAX_SPEED, MAX_SPEED);
    wake();
  };

  const onKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowDown" || e.key === "PageDown") v = clamp(v + 420, -MAX_SPEED, MAX_SPEED);
    else if (e.key === "ArrowUp" || e.key === "PageUp") v = clamp(v - 420, -MAX_SPEED, MAX_SPEED);
    else if (e.key === "Home") seek = 0;
    else if (e.key === "End") seek = end;
    else if (e.key === " ") paused = !paused;
    else return;
    e.preventDefault();
    wake();
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible) wake();
  });
  io.observe(film);
  const onVis = () => {
    visible = document.visibilityState === "visible";
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVis);
  const ro = new ResizeObserver(() => {
    measure();
    wake();
  });
  ro.observe(film);
  ro.observe(roll);

  film.addEventListener("pointerdown", onDown);
  film.addEventListener("pointermove", onMove);
  film.addEventListener("pointerup", onUp);
  film.addEventListener("pointercancel", onUp);
  film.addEventListener("lostpointercapture", onUp);
  film.addEventListener("wheel", onWheel, { passive: false });
  film.addEventListener("keydown", onKey);

  measure();
  weave();
  wake();

  return {
    restart() {
      paused = false;
      seek = 0;
      wake();
    },
    async setSound(on) {
      if (on && !projector) projector = createProjector();
      if (!projector) return false;
      const result = await projector.setEnabled(on);
      projector.update(v / NATURAL);
      wake();
      return result;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      film.removeEventListener("wheel", onWheel);
      film.removeEventListener("keydown", onKey);
      projector?.destroy();
      projector = null;
    },
  };
}
