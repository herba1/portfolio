import { createScreenLight } from "./screenLight";

export function createScreenGlow({ root, screen, video, room, canvas, poster, onTime, onPlaying, onReady }) {
  const light = createScreenLight({
    canvas,
    onGlow: (r, g, b) => {
      screen.style.setProperty("--sg-glow", `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`);
    },
  });

  let destroyed = false;
  let raf = 0;
  let last = performance.now();
  let inView = true;
  let pageVisible = document.visibilityState !== "hidden";
  let wantPlay = true;
  let wasPlaying = false;
  let scrubbing = false;
  let seeking = false;
  let pendingSeek = null;
  let shownTime = 0;
  let lastSampled = -1;
  let announced = false;
  let frameCallback = 0;

  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 55);

  const announce = () => {
    if (announced) return;
    announced = true;
    onReady?.();
  };

  const measure = () => {
    const r = room.getBoundingClientRect();
    const s = video.getBoundingClientRect();
    light.layout({
      roomWidth: r.width,
      roomHeight: r.height,
      screen: { left: s.left - r.left, width: s.width, height: s.height, bottom: s.bottom - r.top },
    });
    light.paint();
    wake();
  };

  const posterImage = new Image();
  posterImage.src = poster;
  posterImage
    .decode()
    .then(() => {
      if (destroyed) return;
      if (lastSampled < 0) light.sample(posterImage, true);
      light.paint();
      announce();
      wake();
    })
    .catch(() => announce());

  const sampleVideo = () => {
    if (video.readyState < 2) return;
    if (light.sample(video)) {
      lastSampled = video.currentTime;
      announce();
    }
  };

  const watchFrames = () => {
    if (!("requestVideoFrameCallback" in video)) return;
    const onFrame = () => {
      if (destroyed) return;
      sampleVideo();
      wake();
      frameCallback = video.requestVideoFrameCallback(onFrame);
    };
    frameCallback = video.requestVideoFrameCallback(onFrame);
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (!("requestVideoFrameCallback" in video) && video.currentTime !== lastSampled) sampleVideo();
    const changed = light.update(dt);
    light.paint();
    if (!scrubbing) shownTime = video.currentTime;
    onTime?.(shownTime, duration());
    const active = !video.paused || changed || seeking;
    if (active && inView && pageVisible) raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !inView || !pageVisible) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const tryPlay = () => {
    if (!wantPlay || scrubbing || !inView || !pageVisible) return;
    const attempt = video.play();
    if (attempt?.catch) attempt.catch(() => {});
  };

  const seekTo = (time) => {
    const t = Math.min(duration() - 0.05, Math.max(0, time));
    shownTime = t;
    if (seeking) {
      pendingSeek = t;
      return;
    }
    seeking = true;
    if (typeof video.fastSeek === "function" && scrubbing) video.fastSeek(t);
    else video.currentTime = t;
    wake();
  };

  const onSeeked = () => {
    seeking = false;
    sampleVideo();
    if (pendingSeek != null) {
      const next = pendingSeek;
      pendingSeek = null;
      if (Math.abs(next - video.currentTime) > 0.02) seekTo(next);
    }
    wake();
  };

  const onPlay = () => {
    onPlaying?.(true);
    wake();
  };
  const onPause = () => {
    onPlaying?.(false);
    wake();
  };
  const onLoaded = () => {
    sampleVideo();
    tryPlay();
    wake();
  };

  video.addEventListener("seeked", onSeeked);
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("loadeddata", onLoaded);
  video.addEventListener("loadedmetadata", wake);
  watchFrames();

  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) {
      tryPlay();
      wake();
    } else {
      video.pause();
    }
  });
  io.observe(root);

  const onVisibility = () => {
    pageVisible = document.visibilityState !== "hidden";
    if (pageVisible) {
      tryPlay();
      wake();
    } else {
      video.pause();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const ro = new ResizeObserver(measure);
  ro.observe(room);
  ro.observe(screen);
  measure();
  if (video.readyState >= 2) onLoaded();

  return {
    toggle() {
      if (video.paused) {
        wantPlay = true;
        tryPlay();
      } else {
        wantPlay = false;
        video.pause();
      }
    },
    scrubStart() {
      scrubbing = true;
      wasPlaying = !video.paused;
      video.pause();
      wake();
    },
    scrubTo(p) {
      seekTo(p * duration());
    },
    scrubEnd() {
      scrubbing = false;
      if (wasPlaying) {
        wantPlay = true;
        tryPlay();
      }
      wake();
    },
    nudge(seconds) {
      seekTo((seeking && pendingSeek != null ? pendingSeek : shownTime) + seconds);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      if (frameCallback && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(frameCallback);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("loadedmetadata", wake);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      ro.disconnect();
      video.pause();
    },
  };
}
