const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT_HZ = 130.81;
const DEGREES = 16;
const BUFFER_SECONDS = 1.2;
const DECAY = 0.996;
const MASTER_GAIN = 0.126;
const MAX_VOICES = 8;
const SAME_NOTE_GAP = 0.12;
const MIN_GAP = 0.016;
const FIFTH_DOWN = 2 / 3;
const WARP_KEY = 100;
const WARM_CHUNK = 4;
const WARM_TIMEOUT_MS = 400;

function degreeHz(degree) {
  const octave = Math.floor(degree / PENTATONIC.length);
  const step = PENTATONIC[degree % PENTATONIC.length];
  return ROOT_HZ * 2 ** (octave + step / 12);
}

function seededNoise(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967295) * 2 - 1;
  };
}

function pluckBuffer(context, hz, seed) {
  const rate = context.sampleRate;
  const length = Math.floor(rate * BUFFER_SECONDS);
  const buffer = context.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  const period = Math.max(2, Math.round(rate / hz - 0.5));
  const noise = seededNoise(seed);
  let soft = 0;
  for (let index = 0; index < period && index < length; index += 1) {
    soft = soft * 0.45 + noise() * 0.55;
    data[index] = soft;
  }
  for (let index = period; index < length; index += 1) {
    data[index] = DECAY * 0.5 * (data[index - period] + data[index - period - 1 < 0 ? 0 : index - period - 1]);
  }
  let peak = 0;
  for (let index = 0; index < length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  const scale = peak > 0 ? 0.9 / peak : 1;
  const attack = Math.floor(rate * 0.002);
  const release = Math.floor(rate * 0.08);
  for (let index = 0; index < length; index += 1) {
    let envelope = 1;
    if (index < attack) envelope = index / attack;
    else if (index > length - release) envelope = (length - index) / release;
    data[index] *= scale * envelope;
  }
  return buffer;
}

export function weftDegree(row, count) {
  return Math.min(DEGREES - 1, Math.floor((1 - (row + 0.5) / count) * DEGREES));
}

export function warpDegree(col, count) {
  return Math.min(DEGREES - 1, Math.floor(((col + 0.5) / count) * DEGREES));
}

export function createPluckBank() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass({ latencyHint: "interactive" });
  const master = context.createGain();
  master.gain.value = MASTER_GAIN;
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  tone.Q.value = 0.4;
  master.connect(tone);
  tone.connect(context.destination);

  const buffers = new Map();
  const lastNote = new Map();
  const voices = [];
  let lastAny = 0;
  let enabled = true;

  const bufferFor = (degree, warp) => {
    const key = warp ? degree + WARP_KEY : degree;
    let buffer = buffers.get(key);
    if (!buffer) {
      const hz = degreeHz(degree) * (warp ? FIFTH_DOWN : 1);
      buffer = pluckBuffer(context, hz, 7919 * (key + 1));
      buffers.set(key, buffer);
    }
    return buffer;
  };

  const warmQueue = [];
  for (let degree = 0; degree < DEGREES; degree += 1) {
    warmQueue.push([degree, false], [DEGREES - 1 - degree, true]);
  }
  let warmHandle = 0;
  let closed = false;
  const scheduleIdle = (task) =>
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(task, { timeout: WARM_TIMEOUT_MS })
      : window.setTimeout(task, 16);
  const cancelIdle = (handle) => {
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
  const warm = () => {
    warmHandle = 0;
    if (closed) return;
    for (let done = 0; done < WARM_CHUNK && warmQueue.length; done += 1) {
      const [degree, warp] = warmQueue.shift();
      bufferFor(degree, warp);
    }
    if (warmQueue.length) warmHandle = scheduleIdle(warm);
  };
  warmHandle = scheduleIdle(warm);

  const pluck = (degree, warp, strength, pan) => {
    if (!enabled || closed) return;
    if (context.state !== "running") {
      if (context.state === "suspended") context.resume().catch(() => {});
      return;
    }
    const now = context.currentTime;
    const key = warp ? degree + WARP_KEY : degree;
    if (now - (lastNote.get(key) ?? -1) < SAME_NOTE_GAP) return;
    if (now - lastAny < MIN_GAP) return;
    lastNote.set(key, now);
    lastAny = now;

    for (let index = voices.length - 1; index >= 0; index -= 1) {
      if (voices[index].end <= now) voices.splice(index, 1);
    }
    if (voices.length >= MAX_VOICES) {
      const oldest = voices.shift();
      oldest.gain.gain.setTargetAtTime(0, now, 0.012);
      oldest.source.stop(now + 0.06);
    }

    const source = context.createBufferSource();
    source.buffer = bufferFor(degree, warp);
    const gain = context.createGain();
    gain.gain.value = 0.2 + 0.8 * Math.min(1, Math.max(0, strength));
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain);
    gain.connect(panner);
    panner.connect(master);
    source.start(now);
    const end = now + BUFFER_SECONDS;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    voices.push({ source, gain, end });
  };

  return {
    pluck,
    resume() {
      if (context.state === "suspended") context.resume().catch(() => {});
    },
    suspend() {
      if (context.state === "running") context.suspend().catch(() => {});
    },
    setEnabled(next) {
      enabled = next;
      master.gain.setTargetAtTime(next ? MASTER_GAIN : 0, context.currentTime, 0.02);
    },
    close() {
      closed = true;
      if (warmHandle) cancelIdle(warmHandle);
      warmHandle = 0;
      voices.length = 0;
      context.close().catch(() => {});
    },
  };
}
