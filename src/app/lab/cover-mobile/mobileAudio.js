import { isLocalScan } from "./mobileParams";

const FFT_SIZE = 1024;
const LEVEL_RISE = 0.5;
const LEVEL_FALL = 0.12;
const FADE_SECONDS = 0.35;

export function createPreviewPlayer(onChange) {
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  const urls = new Map();
  let context = null;
  let analyser = null;
  let gain = null;
  let samples = null;
  let current = null;
  let token = 0;
  let loading = false;
  let unavailable = false;
  let smoothed = 0;
  let lastSecond = -1;
  let ended = null;

  const snapshot = () => ({
    id: current?.id ?? null,
    playing: Boolean(current) && !audio.paused && !loading,
    loading,
    unavailable,
    elapsed: Math.floor(audio.currentTime || 0),
    duration: Math.round(Number.isFinite(audio.duration) ? audio.duration : 30),
  });

  const emit = () => onChange(snapshot());

  const resolveUrl = (cover) => {
    if (isLocalScan(cover)) return Promise.resolve(null);
    if (!urls.has(cover.id)) {
      const query = `artist=${encodeURIComponent(cover.artist ?? "")}&title=${encodeURIComponent(cover.title ?? "")}`;
      urls.set(
        cover.id,
        fetch(`/api/spotify/preview?${query}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => data?.url ?? null)
          .catch(() => null),
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
    emit();
    ended?.();
  };

  audio.addEventListener("play", emit);
  audio.addEventListener("pause", emit);
  audio.addEventListener("playing", emit);
  audio.addEventListener("timeupdate", onTime);
  audio.addEventListener("ended", onEnded);

  const play = async (cover) => {
    token += 1;
    const mine = token;
    current = cover;
    unavailable = false;
    loading = true;
    lastSecond = -1;
    ensureGraph();
    context?.resume?.().catch(() => {});
    audio.pause();
    emit();
    const url = await resolveUrl(cover);
    if (mine !== token) return;
    if (!url) {
      loading = false;
      unavailable = true;
      emit();
      return;
    }
    if (audio.src !== url) audio.src = url;
    try {
      audio.currentTime = 0;
    } catch {
      lastSecond = -1;
    }
    fadeIn();
    try {
      await audio.play();
    } catch {
      loading = false;
      emit();
      return;
    }
    if (mine !== token) return;
    loading = false;
    emit();
  };

  const toggle = (cover) => {
    if (!current || current.id !== cover?.id) {
      play(cover);
      return;
    }
    if (unavailable) return;
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
      chain = chain.then(() => resolveUrl(cover));
    });
  };

  const isPlaying = () => Boolean(current) && !audio.paused;

  const onEnd = (callback) => {
    ended = callback;
  };

  const destroy = () => {
    token += 1;
    ended = null;
    audio.pause();
    audio.removeEventListener("play", emit);
    audio.removeEventListener("pause", emit);
    audio.removeEventListener("playing", emit);
    audio.removeEventListener("timeupdate", onTime);
    audio.removeEventListener("ended", onEnded);
    audio.removeAttribute("src");
    audio.load();
    context?.close?.().catch(() => {});
    context = null;
  };

  return { play, toggle, level, prefetch, isPlaying, onEnd, destroy, snapshot };
}
