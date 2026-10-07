const MAX_VOICES = 16;
const PARTIALS = 6;
const MASTER_LEVEL = 0.6;
const STEAL_TIME_CONSTANT = 0.01;
const ATTACK = 0.003;
const PICK_SECONDS = 0.003;
const PENDING_LIMIT = 32;
const PENDING_MAX_LATE_MS = 250;
const CHIME_ROOT_HZ = 261.63;
const CHIME_LEVEL = 0.2;
const CHIME_GAP_SECONDS = 0.045;

export function audioSupported() {
  return typeof window !== "undefined" && Boolean(window.AudioContext || window.webkitAudioContext);
}

export default class StrumVoice {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noise = null;
    this.voices = [];
    this.muted = false;
    this.wanted = true;
    this.pending = [];
    this.flush = this.flush.bind(this);
  }

  unlock() {
    if (!audioSupported()) return false;
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : MASTER_LEVEL;
      compressor.connect(master);
      master.connect(context.destination);
      const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.02), context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
      context.addEventListener("statechange", this.flush);
      this.context = context;
      this.compressor = compressor;
      this.master = master;
      this.noise = noise;
    }
    if (this.wanted && this.context.state !== "running") this.context.resume().then(this.flush, () => {});
    return true;
  }

  get ready() {
    return Boolean(this.context) && this.context.state === "running";
  }

  get unlocked() {
    return Boolean(this.context);
  }

  flush() {
    if (!this.ready || !this.pending.length) return;
    const now = performance.now();
    const waiting = this.pending;
    this.pending = [];
    for (const item of waiting) {
      const late = now - item.at;
      const delay = item.args.delay ?? 0;
      if (late - delay * 1000 > PENDING_MAX_LATE_MS) continue;
      this.play({ ...item.args, delay: Math.max(0, delay - late / 1000) });
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, now, 0.02);
  }

  setActive(active) {
    this.wanted = active;
    if (!this.context) return;
    if (active && this.context.state === "suspended") this.context.resume().then(this.flush, () => {});
    if (!active) {
      this.pending = [];
      if (this.context.state === "running") this.context.suspend().catch(() => {});
    }
  }

  steal(now) {
    while (this.voices.length && this.voices[0].end <= now) this.voices.shift();
    while (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      oldest.gain.gain.cancelScheduledValues(now);
      oldest.gain.gain.setTargetAtTime(0, now, STEAL_TIME_CONSTANT);
      for (const source of oldest.sources) {
        try {
          source.stop(now + 0.06);
        } catch {
          source.disconnect();
        }
      }
    }
  }

  pluck(args) {
    if (!this.context || this.muted || !(args.amplitude > 0.01)) return;
    if (this.context.state === "running") {
      this.play(args);
      return;
    }
    if (!this.wanted) return;
    if (this.pending.length >= PENDING_LIMIT) this.pending.shift();
    this.pending.push({ args, at: performance.now() });
  }

  chime(ratio) {
    if (!this.context) return;
    this.pluck({ frequency: CHIME_ROOT_HZ, amplitude: CHIME_LEVEL, position: 0.3, pan: -0.25 });
    this.pluck({ frequency: CHIME_ROOT_HZ * ratio, amplitude: CHIME_LEVEL, position: 0.3, pan: 0.25, delay: CHIME_GAP_SECONDS });
  }

  play({ frequency, amplitude, position, pan = 0, delay = 0 }) {
    const context = this.context;
    const now = context.currentTime;
    this.steal(now);

    const start = now + 0.002 + Math.max(0, delay);
    const level = Math.min(1, amplitude);
    const pluckAt = Math.min(0.96, Math.max(0.04, position));
    const denominator = Math.PI * Math.PI * pluckAt * (1 - pluckAt);
    const sustain = Math.min(1.8, Math.max(0.7, (220 / frequency) ** 0.3));
    const glide = 0.014 * level * level;

    const voiceGain = context.createGain();
    voiceGain.gain.value = 1;
    let output = voiceGain;
    if (context.createStereoPanner) {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      voiceGain.connect(panner);
      panner.connect(this.compressor);
      output = panner;
    } else {
      voiceGain.connect(this.compressor);
    }

    const sources = [];
    let end = start;
    for (let harmonic = 1; harmonic <= PARTIALS; harmonic += 1) {
      const partialHz = harmonic * frequency * (1 + 0.0003 * harmonic * harmonic);
      if (partialHz > 15000) break;
      const coefficient = Math.abs((2 * Math.sin(harmonic * Math.PI * pluckAt)) / (harmonic * harmonic * denominator));
      const peak = level * 0.17 * coefficient * harmonic ** 0.45;
      if (peak < 0.0004) continue;
      const timeConstant = sustain / (1.1 * harmonic);
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(partialHz * (1 + glide), start);
      oscillator.frequency.setTargetAtTime(partialHz, start, 0.045);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + ATTACK);
      gain.gain.setTargetAtTime(0, start + ATTACK, timeConstant);
      oscillator.connect(gain);
      gain.connect(voiceGain);
      const stopAt = start + ATTACK + timeConstant * 6;
      oscillator.start(start);
      oscillator.stop(stopAt);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      sources.push(oscillator);
      end = Math.max(end, stopAt);
    }

    const pick = context.createBufferSource();
    pick.buffer = this.noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 0.9;
    const pickGain = context.createGain();
    pickGain.gain.setValueAtTime(0, start);
    pickGain.gain.linearRampToValueAtTime(0.32 * level, start + 0.0005);
    pickGain.gain.linearRampToValueAtTime(0, start + PICK_SECONDS);
    pick.connect(band);
    band.connect(pickGain);
    pickGain.connect(voiceGain);
    pick.start(start);
    pick.stop(start + 0.02);
    pick.onended = () => {
      pick.disconnect();
      band.disconnect();
      pickGain.disconnect();
    };
    sources.push(pick);

    const voice = { gain: voiceGain, sources, end };
    sources[0].addEventListener("ended", () => {
      voiceGain.disconnect();
      if (output !== voiceGain) output.disconnect();
    });
    this.voices.push(voice);
  }

  dispose() {
    for (const voice of this.voices) {
      for (const source of voice.sources) {
        try {
          source.stop();
        } catch {
          source.disconnect();
        }
      }
    }
    this.voices = [];
    this.pending = [];
    if (this.context) {
      this.context.removeEventListener("statechange", this.flush);
      this.context.close().catch(() => {});
    }
    this.context = null;
  }
}
