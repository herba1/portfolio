import { sectionAt } from "./wsTracks";

const STEP = 1 / 240;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const clock = (seconds, tenths) => {
  const t = Math.max(0, seconds);
  const whole = Math.floor(t);
  const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((t - whole) * 10)}` : base;
};

export function createScrub(n, track, wave, { playing = true, from = 0, onSection, onPlaying }) {
  const Z = { x: 1, v: 0, to: 1, k: 210, c: 2 * 0.92 * Math.sqrt(210) };
  const media = { playing, offset: from, startedAt: performance.now(), duration: track.duration, scrubbing: false };
  const view = { ta: 0, xa: 0 };
  const pointer = { on: false, x: 0, pressed: false, id: null, timer: 0 };
  const geo = { w: 0, h: 0, dpr: 1 };
  const g = n.canvas.getContext("2d");
  let raf = 0;
  let last = 0;
  let acc = 0;
  let seen = true;
  let section = -1;
  let lastText = "";

  const position = (now = performance.now()) => {
    if (!media.playing || media.scrubbing) return media.offset;
    const t = media.offset + (now - media.startedAt) / 1000;
    if (t >= media.duration) {
      media.offset = 0;
      media.startedAt = now;
      return 0;
    }
    return t;
  };

  const windowNow = () => {
    const D = media.duration / Z.x;
    const v0 = clamp(view.ta - view.xa * D, 0, media.duration - D);
    return { v0, D };
  };

  const timeAtX = (fx) => {
    const { v0, D } = windowNow();
    return clamp(v0 + fx * D, 0, media.duration);
  };

  const measure = () => {
    const r = n.canvas.getBoundingClientRect();
    geo.w = r.width;
    geo.h = r.height;
    geo.dpr = Math.min(2, window.devicePixelRatio || 1);
    n.canvas.width = Math.max(2, Math.round(r.width * geo.dpr));
    n.canvas.height = Math.max(2, Math.round(r.height * geo.dpr));
  };

  const peakAt = (t0, t1) => {
    const { peaks, rate } = wave;
    const a = t0 * rate;
    const b = t1 * rate;
    if (b - a < 1) {
      const i = Math.floor(a);
      const f = a - i;
      const p0 = peaks[Math.min(peaks.length - 1, Math.max(0, i))];
      const p1 = peaks[Math.min(peaks.length - 1, Math.max(0, i + 1))];
      return p0 + (p1 - p0) * f;
    }
    let m = 0;
    for (let i = Math.floor(a); i < Math.ceil(b) && i < peaks.length; i += 1) if (i >= 0 && peaks[i] > m) m = peaks[i];
    return m;
  };

  const draw = (t) => {
    const { w, h, dpr } = geo;
    if (!w) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { v0, D } = windowNow();
    const pitch = w > 640 ? 6 : 5;
    const bar = pitch - 2;
    const count = Math.floor(w / pitch);
    const pad = (w - count * pitch) / 2;
    const mid = h / 2;
    const headX = ((t - v0) / D) * w;
    const hoverX = pointer.on && !pointer.pressed ? pointer.x * w : headX;
    const lo = Math.min(headX, hoverX);
    const hi = Math.max(headX, hoverX);
    for (let i = 0; i < count; i += 1) {
      const x = i * pitch + pad;
      const t0 = v0 + (x / w) * D;
      const t1 = v0 + ((x + pitch) / w) * D;
      const peak = Math.min(1, peakAt(t0, t1));
      const half = Math.max(bar / 2, peak * (mid - 2));
      const centre = x + bar / 2;
      const isPlayed = centre <= headX;
      const inPreview = centre > lo && centre <= hi;
      g.fillStyle = inPreview ? n.preview : isPlayed ? n.ink : n.rest;
      g.beginPath();
      g.roundRect(x, mid - half, bar, half * 2, bar / 2);
      g.fill();
    }
    if (headX >= -2 && headX <= w + 2) {
      g.fillStyle = n.ink;
      g.fillRect(Math.round(headX) - 1, 0, 2, h);
    }
  };

  const placeChapters = (t) => {
    const { v0, D } = windowNow();
    const w = geo.w;
    track.sections.forEach((s, i) => {
      const el = n.chapters[i];
      if (!el) return;
      const end = i + 1 < track.sections.length ? track.sections[i + 1].start : media.duration;
      const x0 = ((s.start - v0) / D) * w;
      const x1 = ((end - v0) / D) * w;
      const left = Math.max(0, x0);
      const width = Math.min(w, x1) - left;
      if (width < 2) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "visible";
      el.style.transform = `translateX(${left.toFixed(1)}px)`;
      el.style.width = `${width.toFixed(1)}px`;
      el.toggleAttribute("data-clipped", x0 < 0);
      el.toggleAttribute("data-narrow", width < 88);
    });
    const si = sectionAt(t, track.sections);
    if (si !== section) {
      section = si;
      n.chapters.forEach((el, i) => el.toggleAttribute("data-current", i === si));
      onSection?.(si);
    }
  };

  const writeText = (t) => {
    const text = clock(t, true);
    if (text !== lastText) {
      lastText = text;
      n.readout.textContent = text;
      n.surface.setAttribute("aria-valuenow", String(Math.floor(t)));
      n.surface.setAttribute("aria-valuetext", `${clock(t)} of ${clock(media.duration)}, ${track.sections[sectionAt(t, track.sections)].name}`);
    }
    if (pointer.on || pointer.pressed) {
      const ht = pointer.pressed ? t : timeAtX(pointer.x);
      const name = track.sections[sectionAt(ht, track.sections)].name;
      n.bubbleTime.textContent = clock(ht, pointer.pressed);
      n.bubbleName.textContent = name;
      const bw = n.bubble.offsetWidth;
      const hx = pointer.pressed ? ((ht - windowNow().v0) / windowNow().D) : pointer.x;
      const px = clamp(hx * geo.w, bw / 2, geo.w - bw / 2);
      n.bubble.style.transform = `translateX(${(px - bw / 2).toFixed(1)}px)`;
    }
  };

  const tick = (now) => {
    raf = 0;
    if (!seen || document.hidden) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      Z.v += (-Z.k * (Z.x - Z.to) - Z.c * Z.v) * STEP;
      Z.x += Z.v * STEP;
      acc -= STEP;
    }
    Z.x = Math.max(1, Z.x);
    if (pointer.pressed) {
      const { D } = windowNow();
      const edge = 0.08;
      if (pointer.x < edge) view.ta -= ((edge - pointer.x) / edge) * D * dt * 1.2;
      if (pointer.x > 1 - edge) view.ta += ((pointer.x - (1 - edge)) / edge) * D * dt * 1.2;
      view.ta = clamp(view.ta, 0, media.duration);
      media.offset = timeAtX(pointer.x);
    }
    const t = position(now);
    draw(t);
    placeChapters(t);
    writeText(t);
    const moving = Math.abs(Z.v) > 0.001 || Math.abs(Z.x - Z.to) > 0.001;
    if (media.playing || pointer.on || pointer.pressed || moving) raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!raf && seen && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const fx = (e) => {
    const r = n.canvas.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width);
  };

  const onMove = (e) => {
    if (pointer.pressed && e.pointerId !== pointer.id) return;
    pointer.on = true;
    pointer.x = fx(e);
    n.root.setAttribute("data-hover", "");
    wake();
  };
  const onLeave = () => {
    if (pointer.pressed) return;
    pointer.on = false;
    n.root.removeAttribute("data-hover");
    wake();
  };
  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("[data-chapter]")) return;
    pointer.pressed = true;
    pointer.on = true;
    pointer.id = e.pointerId;
    pointer.x = fx(e);
    const at = timeAtX(pointer.x);
    view.ta = at;
    view.xa = pointer.x;
    clearTimeout(pointer.timer);
    pointer.timer = setTimeout(() => {
      if (pointer.pressed) {
        Z.to = Math.max(1, Math.min(6, media.duration / 12));
        wake();
      }
    }, 140);
    media.scrubbing = true;
    media.offset = at;
    n.surface.setPointerCapture(e.pointerId);
    n.root.setAttribute("data-pressed", "");
    n.root.setAttribute("data-hover", "");
    wake();
  };
  const onUp = (e) => {
    if (!pointer.pressed || e.pointerId !== pointer.id) return;
    pointer.pressed = false;
    clearTimeout(pointer.timer);
    media.offset = timeAtX(pointer.x);
    media.startedAt = performance.now();
    media.scrubbing = false;
    view.ta = media.offset;
    view.xa = pointer.x;
    Z.to = 1;
    n.root.removeAttribute("data-pressed");
    if (e.pointerType !== "mouse") {
      pointer.on = false;
      n.root.removeAttribute("data-hover");
    }
    wake();
  };

  n.surface.addEventListener("pointermove", onMove);
  n.surface.addEventListener("pointerleave", onLeave);
  n.surface.addEventListener("pointerdown", onDown);
  n.surface.addEventListener("pointerup", onUp);
  n.surface.addEventListener("pointercancel", onUp);

  const ro = new ResizeObserver(() => {
    measure();
    wake();
  });
  ro.observe(n.canvas);
  const io = new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    wake();
  });
  io.observe(n.root);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);
  measure();
  wake();

  const seekTo = (seconds) => {
    media.offset = clamp(seconds, 0, media.duration - 0.05);
    media.startedAt = performance.now();
    view.ta = media.offset;
    view.xa = media.offset / media.duration;
    wake();
  };

  return {
    setPlaying(next) {
      if (next === media.playing) return;
      media.offset = position();
      media.startedAt = performance.now();
      media.playing = next;
      onPlaying?.(next);
      wake();
    },
    elapsed: () => position(),
    seekTo,
    nudge(seconds) {
      seekTo(position() + seconds);
    },
    chapter(dir) {
      const t = position();
      const i = sectionAt(t, track.sections);
      const target = dir < 0 && t - track.sections[i].start > 2 ? i : i + dir;
      const s = track.sections[clamp(target, 0, track.sections.length - 1)];
      seekTo(s.start);
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(pointer.timer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      n.surface.removeEventListener("pointermove", onMove);
      n.surface.removeEventListener("pointerleave", onLeave);
      n.surface.removeEventListener("pointerdown", onDown);
      n.surface.removeEventListener("pointerup", onUp);
      n.surface.removeEventListener("pointercancel", onUp);
    },
  };
}
