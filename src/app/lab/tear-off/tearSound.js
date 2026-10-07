const TICK_FREQUENCY = 2600;
const TICK_SPREAD = 0.3;
const TICK_Q = 1.2;
const TICK_DECAY = 0.014;
const PREVIEW_VOLUME = 0.6;
const PREVIEW_FADE_MS = 420;

export function createTearSound() {
  let context = null;
  let noise = null;
  let master = null;
  let enabled = true;
  let destroyed = false;
  const urls = new Map();
  const preview = { audio: null, key: null, pending: false, onEnd: null };
  const fades = new Map();

  function unlock() {
    if (destroyed) return;
    if (!context) {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (!AudioEngine) return;
      try {
        context = new AudioEngine();
      } catch {
        context = null;
        return;
      }
      const length = Math.floor(context.sampleRate * 0.06);
      noise = context.createBuffer(1, length, context.sampleRate);
      const channel = noise.getChannelData(0);
      let state = 0x2f6b1d3;
      for (let i = 0; i < length; i += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        channel[i] = ((state >>> 0) / 4294967296) * 2 - 1;
      }
      master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);
    }
    if (context.state === "suspended") context.resume().catch(() => {});
  }

  function tickAt(when, gain) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = TICK_FREQUENCY * (1 - TICK_SPREAD + Math.random() * TICK_SPREAD * 2);
    filter.Q.value = TICK_Q;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, when);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + TICK_DECAY);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(when, Math.random() * 0.03);
    source.stop(when + TICK_DECAY + 0.01);
  }

  function ready() {
    return enabled && context && context.state === "running" && !destroyed;
  }

  function tick(intensity) {
    if (!ready()) return;
    tickAt(context.currentTime, 0.12 + Math.min(1, intensity) * 0.5);
  }

  function snap() {
    if (!ready()) return;
    const now = context.currentTime;
    const offsets = [0, 0.009, 0.017, 0.028];
    offsets.forEach((offset, index) => tickAt(now + offset, 0.62 - index * 0.11));
  }

  function previewUrl(cover) {
    const key = `${cover.artist}::${cover.title}`;
    if (urls.has(key)) return urls.get(key);
    const request = fetch(`/api/spotify/preview?artist=${encodeURIComponent(cover.artist || "")}&title=${encodeURIComponent(cover.title || "")}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => json?.url ?? null)
      .catch(() => null);
    urls.set(key, request);
    return request;
  }

  function fadeTo(audio, target, done) {
    cancelAnimationFrame(fades.get(audio) ?? 0);
    const from = audio.volume;
    const begin = performance.now();
    const stepFade = (now) => {
      const t = Math.min(1, (now - begin) / PREVIEW_FADE_MS);
      audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
      if (t < 1) {
        fades.set(audio, requestAnimationFrame(stepFade));
      } else {
        fades.delete(audio);
        if (done) done();
      }
    };
    fades.set(audio, requestAnimationFrame(stepFade));
  }

  function stop() {
    const audio = preview.audio;
    preview.audio = null;
    preview.key = null;
    preview.pending = false;
    const onEnd = preview.onEnd;
    preview.onEnd = null;
    if (onEnd) onEnd();
    if (!audio) return;
    fadeTo(audio, 0, () => audio.pause());
  }

  function play(key, cover, onEnd) {
    if (destroyed || !enabled) return;
    stop();
    preview.key = key;
    preview.onEnd = onEnd;
    previewUrl(cover).then((url) => {
      if (destroyed || preview.key !== key) return;
      if (!url) {
        stop();
        return;
      }
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = 0;
      audio.addEventListener("ended", () => {
        if (preview.audio === audio) stop();
      });
      audio.addEventListener("error", () => {
        if (preview.audio === audio) stop();
      });
      preview.audio = audio;
      preview.pending = true;
      start(audio);
    });
  }

  function start(audio) {
    const attempt = audio.play();
    if (attempt && attempt.then) {
      attempt.then(
        () => {
          if (preview.audio !== audio) return;
          preview.pending = false;
          fadeTo(audio, PREVIEW_VOLUME);
        },
        () => {},
      );
    } else {
      preview.pending = false;
      fadeTo(audio, PREVIEW_VOLUME);
    }
  }

  function resumePending() {
    if (preview.audio && preview.pending) start(preview.audio);
  }

  function progress(key) {
    const audio = preview.audio;
    if (!audio || preview.key !== key || preview.pending) return -1;
    const duration = audio.duration;
    if (!duration || !Number.isFinite(duration)) return 0;
    return Math.min(1, audio.currentTime / duration);
  }

  function setEnabled(next) {
    enabled = next;
    if (!enabled) stop();
  }

  function destroy() {
    destroyed = true;
    fades.forEach((id, audio) => {
      cancelAnimationFrame(id);
      audio.pause();
    });
    fades.clear();
    if (preview.audio) preview.audio.pause();
    preview.audio = null;
    preview.onEnd = null;
    if (context) context.close().catch(() => {});
    context = null;
  }

  return {
    unlock,
    tick,
    snap,
    play,
    stop,
    progress,
    prefetch: previewUrl,
    resumePending,
    setEnabled,
    destroy,
    playing: () => preview.key,
  };
}
