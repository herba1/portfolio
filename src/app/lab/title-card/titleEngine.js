import { BEATS, SECONDS, VH, VW, drawScene } from "./titleScene";

const BEAT_URL = "/blog/audio/friday-beat.wav";
const LOOP = 5;

function grainTile() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const x = c.getContext("2d");
  const im = x.createImageData(256, 256);
  let s = 90817;
  for (let i = 0; i < 256 * 256; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = 128 + ((s / 4294967296) - 0.5) * 90;
    im.data[i * 4] = v;
    im.data[i * 4 + 1] = v;
    im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}

export function createTitle({ frame, track, onTime = () => {}, onPlaying = () => {} }) {
  const canvas = document.createElement("canvas");
  canvas.className = "title-card-canvas";
  frame.append(canvas);
  const ctx = canvas.getContext("2d");
  const grain = grainTile();
  let pattern = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let t = 0;
  let playing = !reduced;
  let scrub = null;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let visible = !document.hidden;
  let onscreen = true;
  let lastEmit = -1;

  let audio = null;
  let buffer = null;
  let source = null;
  let soundOn = false;
  let audioZero = 0;

  const ensureAudio = async () => {
    if (audio) return audio;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx({ latencyHint: "playback" });
    const gain = audio.createGain();
    gain.gain.value = 0.8;
    gain.connect(audio.destination);
    audio.out = gain;
    try {
      const res = await fetch(BEAT_URL);
      buffer = await audio.decodeAudioData(await res.arrayBuffer());
    } catch {
      buffer = null;
    }
    return audio;
  };

  const stopSource = () => {
    if (!source) return;
    const s = source;
    source = null;
    try {
      const now = audio.currentTime;
      s.fader.gain.setTargetAtTime(0, now, 0.012);
      s.stop(now + 0.06);
    } catch {
      s.disconnect();
    }
  };

  const startSource = () => {
    if (!audio || !buffer || !soundOn || !playing || scrub || audio.state !== "running") return;
    stopSource();
    const s = audio.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = Math.min(LOOP, buffer.duration);
    const fader = audio.createGain();
    const at = audio.currentTime + 0.03;
    fader.gain.setValueAtTime(0, at);
    fader.gain.linearRampToValueAtTime(1, at + 0.015);
    s.connect(fader);
    fader.connect(audio.out);
    s.fader = fader;
    s.onended = () => fader.disconnect();
    const offset = ((t % LOOP) + LOOP) % LOOP;
    s.start(at, offset);
    audioZero = at - t;
    source = s;
  };

  const draw = () => {
    if (!W) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = canvas.width / VW;
    const sy = canvas.height / VH;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    drawScene(ctx, (t / SECONDS) * BEATS);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!pattern) pattern = ctx.createPattern(grain, "repeat");
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const shade = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35, canvas.width / 2, canvas.height / 2, canvas.width * 0.72);
    shade.addColorStop(0, "rgba(30, 18, 6, 0)");
    shade.addColorStop(0.6, "rgba(30, 18, 6, 0.04)");
    shade.addColorStop(1, "rgba(30, 18, 6, 0.16)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const emit = () => {
    const key = Math.round(t * 100);
    if (key === lastEmit) return;
    lastEmit = key;
    onTime(t);
  };

  const tick = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (playing && !scrub) {
      if (source && audio) t = (audio.currentTime - audioZero) % SECONDS;
      else t = (t + dt) % SECONDS;
      if (t < 0) t += SECONDS;
    }
    draw();
    emit();
    if (playing && !scrub) raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (destroyed || raf || !visible || !onscreen) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const redraw = () => {
    draw();
    emit();
  };

  const layout = () => {
    const r = frame.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    pattern = null;
    redraw();
    wake();
  };

  const timeAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(0.9999, (clientX - r.left) / r.width)) * SECONDS;
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    scrub = { id: e.pointerId };
    stopSource();
    track.setPointerCapture?.(e.pointerId);
    track.dataset.scrubbing = "";
    t = timeAt(e.clientX);
    redraw();
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    t = timeAt(e.clientX);
    redraw();
  };

  const onUp = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    scrub = null;
    delete track.dataset.scrubbing;
    startSource();
    wake();
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (!visible) stopSource();
    else {
      startSource();
      wake();
    }
  };

  const ro = new ResizeObserver(() => layout());
  ro.observe(frame);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  });
  io.observe(frame);
  track.addEventListener("pointerdown", onDown);
  track.addEventListener("pointermove", onMove);
  track.addEventListener("pointerup", onUp);
  track.addEventListener("pointercancel", onUp);
  document.addEventListener("visibilitychange", onVisibility);

  const setPlaying = (on) => {
    playing = on;
    onPlaying(on);
    if (on) {
      startSource();
      wake();
    } else stopSource();
  };

  const ready = document.fonts?.load ? Promise.all([document.fonts.load("700 100px TitleArimo"), document.fonts.load("400 40px TitleArimo")]) : Promise.resolve();
  Promise.race([ready, new Promise((r) => setTimeout(r, 2500))]).then(() => {
    if (destroyed) return;
    layout();
    frame.dataset.ready = "";
    onPlaying(playing);
    wake();
  });

  return {
    toggle() {
      setPlaying(!playing);
    },
    seekBeat(delta) {
      const beat = (t / SECONDS) * BEATS;
      const next = (Math.round(beat) + delta + BEATS) % BEATS;
      t = (next / BEATS) * SECONDS;
      redraw();
      if (source) startSource();
    },
    seek(seconds) {
      t = ((seconds % SECONDS) + SECONDS) % SECONDS;
      redraw();
      if (source) startSource();
    },
    async setSound(on) {
      soundOn = on;
      if (!on) {
        stopSource();
        return false;
      }
      const a = await ensureAudio();
      if (!a) return false;
      if (a.state !== "running") {
        try {
          await a.resume();
        } catch {
          return false;
        }
      }
      if (!buffer) return false;
      startSource();
      return a.state === "running";
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      track.removeEventListener("pointerdown", onDown);
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
      stopSource();
      audio?.close().catch(() => {});
      canvas.remove();
    },
  };
}
