const BANDS = [
  [30, 140],
  [140, 520],
  [520, 2200],
  [2200, 9000],
];
const TILT = [1, 1.18, 1.65, 2.4];
const ATTACK = 0.55;
const RELEASE = 0.13;
const WIN = 96;
const SPAN_MIN = 0.03;
const GAMMA = 1.2;
const SILENCE_RELEASE = 0.08;

export const FADE_IN = 0.16;
export const FADE_OUT = 0.22;
const FADE_TAIL = 0.8;

function clock(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export class BackdropAudio {
  constructor(element) {
    this.element = element;
    this.levels = new Float32Array(4);
    this.history = Array.from({ length: 4 }, () => new Float32Array(WIN));
    this.historyAt = 0;
    this.historyCount = 0;
    this.analyser = null;
    this.context = null;
    this.source = null;
    this.gain = null;
    this.frequencies = null;
    this.ranges = null;
    this.failed = false;
    this.frameHandle = 0;
    this.fadeTimer = 0;
    this.targets = null;
    this.lastElapsed = "";
    this.lastRemaining = "";
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.snapshot = { bands: [0, 0, 0, 0], level: 0 };

    this.frame = this.frame.bind(this);
    this.read = this.read.bind(this);
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  connect() {
    if (this.analyser || this.failed || !this.element) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      this.failed = true;
      return;
    }
    try {
      this.context = new AudioContextClass();
      this.source = this.context.createMediaElementSource(this.element);
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      analyser.minDecibels = -78;
      analyser.maxDecibels = -10;
      this.source.connect(this.gain);
      this.gain.connect(analyser);
      analyser.connect(this.context.destination);
      this.frequencies = new Uint8Array(analyser.frequencyBinCount);
      const nyquist = this.context.sampleRate / 2;
      this.ranges = BANDS.map(([lo, hi]) => [
        Math.max(1, Math.round((lo / nyquist) * analyser.frequencyBinCount)),
        Math.min(
          analyser.frequencyBinCount - 1,
          Math.round((hi / nyquist) * analyser.frequencyBinCount),
        ),
      ]);
      this.analyser = analyser;
    } catch {
      this.failed = true;
    }
  }

  setProgressTargets(targets) {
    this.targets = targets;
  }

  rampTo(value, seconds) {
    if (!this.gain || !this.context) return;
    const now = this.context.currentTime;
    const current = this.gain.gain.value;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(current, now);
    this.gain.gain.linearRampToValueAtTime(value, now + seconds);
  }

  envelope() {
    if (!this.gain || !this.context || !this.element) return;
    const now = this.context.currentTime;
    const duration = this.element.duration;
    const remain = Number.isFinite(duration) ? duration - this.element.currentTime : Infinity;
    const current = this.gain.gain.value;

    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(current, now);
    const rise = Math.min(FADE_IN, Math.max(0.01, remain * 0.3));
    this.gain.gain.linearRampToValueAtTime(1, now + rise);

    if (Number.isFinite(remain) && remain > rise + FADE_TAIL) {
      this.gain.gain.setValueAtTime(1, now + remain - FADE_TAIL);
      this.gain.gain.linearRampToValueAtTime(0, now + remain);
    }
  }

  async play() {
    this.connect();
    if (this.context?.state === "suspended") await this.context.resume();
    clearTimeout(this.fadeTimer);
    if (this.element.paused) await this.element.play();
    this.envelope();
  }

  pause() {
    clearTimeout(this.fadeTimer);
    if (!this.gain) {
      this.element.pause();
      return;
    }
    this.rampTo(0, FADE_OUT);
    this.fadeTimer = setTimeout(() => this.element.pause(), FADE_OUT * 1000);
  }

  reseat() {
    if (this.element.paused) return;
    this.envelope();
  }

  reset() {
    this.levels.fill(0);
    this.historyCount = 0;
    this.historyAt = 0;
    this.history.forEach((band) => band.fill(0));
    if (this.gain && this.context) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(0, this.context.currentTime);
    }
  }

  readLevels() {
    const analyser = this.analyser;
    analyser.getByteFrequencyData(this.frequencies);
    this.historyAt = (this.historyAt + 1) % WIN;
    if (this.historyCount < WIN) this.historyCount += 1;

    for (let b = 0; b < 4; b += 1) {
      const [lo, hi] = this.ranges[b];
      let sum = 0;
      for (let i = lo; i <= hi; i += 1) sum += this.frequencies[i];
      const raw = Math.min(1, (sum / ((hi - lo + 1) * 255)) * TILT[b]);

      const band = this.history[b];
      band[this.historyAt] = raw;
      let min = 1;
      let max = 0;
      for (let i = 0; i < this.historyCount; i += 1) {
        const value = band[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }

      const span = Math.max(SPAN_MIN, max - min);
      const target = Math.pow(Math.min(1, Math.max(0, (raw - min) / span)), GAMMA);
      const rate = target > this.levels[b] ? ATTACK : RELEASE;
      this.levels[b] += (target - this.levels[b]) * rate;
    }
  }

  decay() {
    for (let b = 0; b < 4; b += 1) {
      this.levels[b] -= this.levels[b] * SILENCE_RELEASE;
      if (this.levels[b] < 1e-4) this.levels[b] = 0;
    }
  }

  writeProgress() {
    const targets = this.targets;
    const element = this.element;
    if (!targets || !element) return;
    const duration = element.duration;
    const known = Number.isFinite(duration) && duration > 0;
    const ratio = known ? Math.min(1, element.currentTime / duration) : 0;
    targets.rail?.style.setProperty("--bd-progress", ratio.toFixed(4));

    const elapsed = clock(element.currentTime);
    if (elapsed !== this.lastElapsed && targets.elapsed) {
      targets.elapsed.textContent = elapsed;
      this.lastElapsed = elapsed;
    }
    const remaining = known ? `-${clock(duration - element.currentTime)}` : "-0:00";
    if (remaining !== this.lastRemaining && targets.remaining) {
      targets.remaining.textContent = remaining;
      this.lastRemaining = remaining;
    }
  }

  frame() {
    this.frameHandle = requestAnimationFrame(this.frame);
    const element = this.element;
    const live = this.analyser && element && !element.paused && !this.reduced;
    if (live) this.readLevels();
    else this.decay();

    const bands = this.snapshot.bands;
    let total = 0;
    for (let b = 0; b < 4; b += 1) {
      bands[b] = this.levels[b];
      total += this.levels[b];
    }
    this.snapshot.level = total / 4;
    this.writeProgress();
  }

  read() {
    return this.snapshot;
  }

  destroy() {
    cancelAnimationFrame(this.frameHandle);
    clearTimeout(this.fadeTimer);
    try {
      this.source?.disconnect();
      this.gain?.disconnect();
      this.analyser?.disconnect();
      this.context?.close();
    } catch {
      this.failed = true;
    }
    this.analyser = null;
    this.context = null;
    this.source = null;
    this.gain = null;
  }
}
