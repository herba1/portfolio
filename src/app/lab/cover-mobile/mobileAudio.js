import { isLocalScan } from "./mobileParams";

const FFT_SIZE = 1024;
const LEVEL_RISE = 0.5;
const LEVEL_FALL = 0.12;
const FADE_SECONDS = 0.35;
const SILENCE =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

export function createPlaybackStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createPreviewPlayer(onChange) {
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  const urls = new Map();
  const resolved = new Map();
  let context = null;
  let analyser = null;
  let gain = null;
  let samples = null;
  let current = null;
  let token = 0;
  let attempt = 0;
  let streamed = false;
  let loading = false;
  let unavailable = false;
  let smoothed = 0;
  let lastSecond = -1;
  let ended = null;
  let alive = true;

  const snapshot = () => ({
    id: current?.id ?? null,
    playing: Boolean(current) && !audio.paused && !loading,
    loading,
    unavailable,
    elapsed: Math.floor(audio.currentTime || 0),
    duration: Math.round(Number.isFinite(audio.duration) ? audio.duration : 30),
  });

  const emit = () => onChange(snapshot());

  const queryFor = (cover) =>
    `artist=${encodeURIComponent(cover.artist ?? "")}&title=${encodeURIComponent(cover.title ?? "")}`;

  const resolveUrl = (cover) => {
    if (isLocalScan(cover)) return Promise.resolve(null);
    if (!urls.has(cover.id)) {
      const query = queryFor(cover);
      urls.set(
        cover.id,
        fetch(`/api/spotify/preview?${query}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => data?.url ?? null)
          .catch(() => null)
          .then((url) => {
            resolved.set(cover.id, url);
            return url;
          }),
      );
    }
    return urls.get(cover.id);
  };

  const ensureGraph = () => {
    if (context) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      context = new Context();
      const source = context.createMediaElementSource(audio);
      gain = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      samples = new Float32Array(analyser.fftSize);
      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(context.destination);
    } catch {
      context = null;
      analyser = null;
      gain = null;
    }
  };

  const fadeIn = () => {
    if (!gain || !context) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1, now + FADE_SECONDS);
  };

  const onTime = () => {
    const second = Math.floor(audio.currentTime || 0);
    if (second !== lastSecond) {
      lastSecond = second;
      emit();
    }
  };

  const onEnded = () => {
    if (audio.src === SILENCE) return;
    emit();
    ended?.();
  };

  audio.addEventListener("play", emit);
  audio.addEventListener("pause", emit);
  audio.addEventListener("playing", emit);
  audio.addEventListener("timeupdate", onTime);
  const start = (url, mine) => {
    attempt += 1;
    const tried = attempt;
    if (audio.src !== url) audio.src = url;
    try {
      audio.currentTime = 0;
    } catch {
      lastSecond = -1;
    }
    fadeIn();
    const settle = () => {
      if (mine !== token || tried !== attempt) return;
      loading = false;
      emit();
    };
    audio.play().then(settle, settle);
  };

  const onError = () => {
    if (!current || unavailable || audio.src === SILENCE || !audio.currentSrc) return;
    if (!streamed && !isLocalScan(current)) {
      streamed = true;
      loading = true;
      emit();
      start(`/api/spotify/preview?${queryFor(current)}&stream=1`, token);
      return;
    }
    attempt += 1;
    loading = false;
    unavailable = true;
    emit();
  };

  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);

  const unlock = () => {
    audio.src = SILENCE;
    audio.play().catch(() => {});
  };

  const play = (cover) => {
    token += 1;
    const mine = token;
    current = cover;
    unavailable = false;
    streamed = false;
    loading = true;
    lastSecond = -1;
    ensureGraph();
    context?.resume?.().catch(() => {});
    const known = isLocalScan(cover) ? null : resolved.get(cover.id);
    if (known) {
      start(known, mine);
      emit();
      return;
    }
    audio.pause();
    if (known === null) {
      loading = false;
      unavailable = true;
      emit();
      return;
    }
    unlock();
    emit();
    resolveUrl(cover).then((url) => {
      if (mine !== token) return;
      if (!url) {
        audio.pause();
        loading = false;
        unavailable = true;
        emit();
        return;
      }
      start(url, mine);
    });
  };

  const toggle = (cover) => {
    if (!current || current.id !== cover?.id) {
      play(cover);
      return;
    }
    if (unavailable) return;
    if (loading) {
      token += 1;
      loading = false;
      audio.pause();
      emit();
      return;
    }
    if (audio.paused) {
      context?.resume?.().catch(() => {});
      fadeIn();
      audio.play().catch(() => emit());
    } else {
      audio.pause();
    }
  };

  const level = () => {
    if (!analyser || audio.paused) {
      smoothed *= 1 - LEVEL_FALL;
      return smoothed;
    }
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
    const rms = Math.sqrt(sum / samples.length);
    smoothed += (rms - smoothed) * (rms > smoothed ? LEVEL_RISE : LEVEL_FALL);
    return smoothed;
  };

  const prefetch = (covers) => {
    let chain = Promise.resolve();
    covers.forEach((cover) => {
      chain = chain.then(() => (alive ? resolveUrl(cover) : null));
    });
  };

  const isPlaying = () => Boolean(current) && !audio.paused && !loading;

  const isActive = () => Boolean(current) && !unavailable && (loading || !audio.paused);

  const currentId = () => current?.id ?? null;

  const onEnd = (callback) => {
    ended = callback;
  };

  const destroy = () => {
    alive = false;
    token += 1;
    ended = null;
    audio.pause();
    audio.removeEventListener("play", emit);
    audio.removeEventListener("pause", emit);
    audio.removeEventListener("playing", emit);
    audio.removeEventListener("timeupdate", onTime);
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    audio.removeAttribute("src");
    audio.load();
    context?.close?.().catch(() => {});
    context = null;
  };

  return { play, toggle, level, prefetch, isPlaying, isActive, currentId, onEnd, destroy, snapshot };
}
