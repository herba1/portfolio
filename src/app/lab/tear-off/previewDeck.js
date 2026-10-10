const VOLUME = 0.6;
const FADE_IN_MS = 420;
const FADE_OUT_MS = 240;
const PAUSE_FADE_MS = 160;
const FADE_SLACK_MS = 80;
const NOMINAL_SECONDS = 30;
const SILENT_SAMPLES = 400;

function silentClip() {
  const bytes = new Uint8Array(44 + SILENT_SAMPLES);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + SILENT_SAMPLES, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  write(36, "data");
  view.setUint32(40, SILENT_SAMPLES, true);
  bytes.fill(128, 44);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function queryOf(cover) {
  return `artist=${encodeURIComponent(cover.artist || "")}&title=${encodeURIComponent(cover.title || "")}`;
}

export function createPreviewDeck(onStatus) {
  const media = new Audio();
  media.preload = "auto";
  media.setAttribute("playsinline", "");
  const urls = new Map();
  let track = null;
  let token = 0;
  let status = "empty";
  let notified = { key: undefined, status: undefined };
  let primed = false;
  let priming = false;
  let muted = false;
  let destroyed = false;
  let fadeFrame = 0;
  let fadeTimer = 0;
  let fadeId = 0;

  function set(next) {
    status = next;
    const key = track ? track.key : null;
    if (notified.key === key && notified.status === next) return;
    notified = { key, status: next };
    onStatus({ key, status: next });
  }

  function resolve(cover) {
    const query = queryOf(cover);
    if (urls.has(query)) return urls.get(query);
    const request = fetch(`/api/spotify/preview?${query}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => json?.url ?? null)
      .catch(() => {
        urls.delete(query);
        return null;
      });
    urls.set(query, request);
    return request;
  }

  function stopFade() {
    cancelAnimationFrame(fadeFrame);
    clearTimeout(fadeTimer);
    fadeFrame = 0;
    fadeTimer = 0;
    fadeId += 1;
  }

  function fade(target, ms, done) {
    stopFade();
    const id = fadeId;
    const from = media.volume;
    const finish = () => {
      if (id !== fadeId) return;
      stopFade();
      media.volume = target;
      if (done) done();
    };
    if (ms <= 0 || Math.abs(target - from) < 0.002) {
      finish();
      return;
    }
    const begin = performance.now();
    const stepFade = (now) => {
      if (id !== fadeId) return;
      const t = Math.min(1, (now - begin) / ms);
      media.volume = Math.max(0, Math.min(1, from + (target - from) * t));
      if (t < 1) fadeFrame = requestAnimationFrame(stepFade);
      else finish();
    };
    fadeFrame = requestAnimationFrame(stepFade);
    fadeTimer = setTimeout(finish, ms + FADE_SLACK_MS);
  }

  function clearSource() {
    media.removeAttribute("src");
    try {
      media.load();
    } catch {
      media.pause();
    }
  }

  function prime() {
    if (primed || priming || destroyed || track) return;
    priming = true;
    media.src = silentClip();
    media.volume = 0;
    let attempt;
    try {
      attempt = media.play();
    } catch {
      priming = false;
      return;
    }
    Promise.resolve(attempt).then(
      () => {
        priming = false;
        primed = true;
        if (!track) media.pause();
      },
      () => {
        priming = false;
      },
    );
  }

  function play() {
    if (!track || !track.ready || destroyed) return;
    const mine = token;
    media.muted = muted;
    if (media.ended) media.currentTime = 0;
    set(media.readyState >= 3 ? "playing" : "loading");
    let attempt;
    try {
      attempt = media.play();
    } catch {
      set("paused");
      return;
    }
    Promise.resolve(attempt).then(
      () => {
        if (mine !== token || !track) return;
        primed = true;
        if (!track.intent) {
          media.pause();
          return;
        }
        set("playing");
        fade(VOLUME, FADE_IN_MS);
      },
      (error) => {
        if (mine !== token || !track) return;
        if (error && error.name === "NotAllowedError") {
          track.intent = false;
          set("paused");
        }
      },
    );
  }

  function maybePlay() {
    if (track && track.intent && track.inserted && track.ready) play();
  }

  function load(key, cover) {
    if (destroyed) return;
    token += 1;
    const mine = token;
    const query = queryOf(cover);
    track = { key, url: null, stream: `/api/spotify/preview?${query}&stream=1`, fellBack: false, intent: true, inserted: false, ready: false };
    set("loading");
    const quiet = new Promise((done) => {
      if (media.paused) {
        stopFade();
        done();
        return;
      }
      fade(0, FADE_OUT_MS, () => {
        media.pause();
        done();
      });
    });
    Promise.all([resolve(cover), quiet]).then(([url]) => {
      if (destroyed || mine !== token || !track) return;
      if (!url) {
        set("none");
        return;
      }
      track.url = url;
      track.ready = true;
      media.volume = 0;
      media.src = url;
      maybePlay();
    });
  }

  function start(key) {
    if (!track || track.key !== key) return;
    track.inserted = true;
    if (status === "none") return;
    maybePlay();
  }

  function pause() {
    if (!track || status === "none") return;
    track.intent = false;
    set("paused");
    if (!track.ready) return;
    const mine = token;
    fade(0, PAUSE_FADE_MS, () => {
      if (mine === token && track && !track.intent) media.pause();
    });
  }

  function resume() {
    if (!track || status === "none") return;
    track.intent = true;
    if (status === "ended" || media.ended) media.currentTime = 0;
    if (track.inserted && track.ready) play();
    else set("loading");
  }

  function toggle() {
    if (!track) return;
    if (track.intent && status !== "ended") pause();
    else resume();
  }

  function eject() {
    token += 1;
    const wasPlaying = !media.paused;
    track = null;
    set("empty");
    if (!wasPlaying) {
      stopFade();
      clearSource();
      return;
    }
    fade(0, FADE_OUT_MS, () => {
      if (track) return;
      media.pause();
      clearSource();
    });
  }

  function time() {
    if (!track || !track.ready) return { current: 0, duration: NOMINAL_SECONDS };
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : NOMINAL_SECONDS;
    if (status === "ended") return { current: duration, duration };
    return { current: Math.min(duration, media.currentTime || 0), duration };
  }

  function onPlaying() {
    if (track && track.intent && track.ready) set("playing");
  }

  function onWaiting() {
    if (track && track.intent && status === "playing") set("loading");
  }

  function onEnded() {
    if (!track || !track.ready) return;
    track.intent = false;
    set("ended");
  }

  function onError() {
    if (!track || !track.ready) return;
    if (!track.fellBack) {
      track.fellBack = true;
      media.src = track.stream;
      maybePlay();
      return;
    }
    track.intent = false;
    set("none");
  }

  media.addEventListener("playing", onPlaying);
  media.addEventListener("waiting", onWaiting);
  media.addEventListener("ended", onEnded);
  media.addEventListener("error", onError);

  return {
    prime,
    prefetch: (cover) => (cover ? resolve(cover) : Promise.resolve(null)),
    load,
    start,
    pause,
    resume,
    toggle,
    eject,
    time,
    status: () => status,
    setMuted(next) {
      muted = next;
      media.muted = next;
    },
    destroy() {
      destroyed = true;
      token += 1;
      stopFade();
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("waiting", onWaiting);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
      media.pause();
      clearSource();
      track = null;
    },
  };
}
