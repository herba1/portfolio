const TICK_FREQUENCY = 2600;
const TICK_SPREAD = 0.3;
const TICK_Q = 1.2;
const TICK_DECAY = 0.014;
const HISS_SECONDS = 1.2;
const ROLLER_FREQUENCY = 1500;
const ROLLER_Q = 0.7;
const ROLLER_GAIN = 0.05;
const ROLLER_ATTACK = 0.05;
const ROLLER_RELEASE = 0.12;

function fillNoise(channel, seed) {
  let state = seed;
  for (let i = 0; i < channel.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    channel[i] = ((state >>> 0) / 4294967296) * 2 - 1;
  }
}

export function createTearSound() {
  let context = null;
  let noise = null;
  let hiss = null;
  let master = null;
  let enabled = true;
  let destroyed = false;

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
      noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.06), context.sampleRate);
      fillNoise(noise.getChannelData(0), 0x2f6b1d3);
      hiss = context.createBuffer(1, Math.floor(context.sampleRate * HISS_SECONDS), context.sampleRate);
      fillNoise(hiss.getChannelData(0), 0x5bd1e99);
      master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);
    }
    if (context.state === "suspended") context.resume().catch(() => {});
  }

  function tickAt(when, gain, frequency = TICK_FREQUENCY, decay = TICK_DECAY) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency * (1 - TICK_SPREAD + Math.random() * TICK_SPREAD * 2);
    filter.Q.value = TICK_Q;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, when);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(when, Math.random() * 0.03);
    source.stop(when + decay + 0.01);
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

  function detent() {
    if (!ready()) return;
    tickAt(context.currentTime, 0.14, 3400, 0.01);
  }

  function clunk() {
    if (!ready()) return;
    const now = context.currentTime;
    tickAt(now, 0.42, 820, 0.03);
    tickAt(now + 0.014, 0.2, 1900, 0.018);
  }

  function seat() {
    if (!ready()) return;
    tickAt(context.currentTime, 0.22, 1100, 0.022);
  }

  function rollers(durationMs, delayMs = 0) {
    if (!ready() || durationMs <= 0) return;
    const begin = context.currentTime + delayMs / 1000;
    const end = begin + durationMs / 1000;
    const source = context.createBufferSource();
    source.buffer = hiss;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(ROLLER_FREQUENCY * 0.8, begin);
    filter.frequency.linearRampToValueAtTime(ROLLER_FREQUENCY * 1.15, end);
    filter.Q.value = ROLLER_Q;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.linearRampToValueAtTime(ROLLER_GAIN, begin + ROLLER_ATTACK);
    envelope.gain.setValueAtTime(ROLLER_GAIN, Math.max(begin + ROLLER_ATTACK, end - ROLLER_RELEASE));
    envelope.gain.linearRampToValueAtTime(0.0001, end);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(begin, Math.random() * HISS_SECONDS);
    source.stop(end + 0.02);
  }

  function setEnabled(next) {
    enabled = next;
  }

  function destroy() {
    destroyed = true;
    if (context) context.close().catch(() => {});
    context = null;
  }

  return { unlock, tick, snap, detent, clunk, seat, rollers, setEnabled, destroy };
}
