const ROOT_HZ = 196;
const PENTATONIC = [0, 2, 4, 7, 9];
const REST_LENGTH = 588;
const RING_SECONDS = 1.6;
const STRING_LOSS = 0.9965;

function noteFor(length) {
  const raw = ROOT_HZ * (REST_LENGTH / Math.max(60, length));
  const semitones = Math.round(12 * Math.log2(raw / ROOT_HZ));
  const octave = Math.floor(semitones / 12);
  const within = semitones - octave * 12;
  let nearest = PENTATONIC[0];
  for (const step of PENTATONIC) if (Math.abs(step - within) < Math.abs(nearest - within)) nearest = step;
  return Math.min(880, ROOT_HZ * 2 ** ((octave * 12 + nearest) / 12));
}

export function createPluckSound() {
  let context = null;

  function unlock() {
    if (typeof window === "undefined") return;
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      context = new AudioContextClass();
    }
    if (context.state === "suspended") context.resume().catch(() => {});
  }

  function pluck(amplitude, length) {
    if (!context || context.state === "closed") return;
    const strength = Math.min(1, Math.max(0.12, amplitude / 48));
    const frequency = noteFor(length);
    const sampleRate = context.sampleRate;
    const frames = Math.floor(sampleRate * RING_SECONDS);
    const buffer = context.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(sampleRate / frequency));
    const ring = new Float32Array(period);
    const brightness = 0.28 + strength * 0.5;
    let smoothed = 0;
    let mean = 0;
    for (let index = 0; index < period; index += 1) {
      smoothed += (Math.random() * 2 - 1 - smoothed) * brightness;
      ring[index] = smoothed;
      mean += smoothed;
    }
    mean /= period;
    for (let index = 0; index < period; index += 1) ring[index] -= mean;
    let cursor = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const next = cursor + 1 === period ? 0 : cursor + 1;
      const sample = ring[cursor];
      ring[cursor] = (sample + ring[next]) * 0.5 * STRING_LOSS;
      data[frame] = sample;
      cursor = next;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1800 + strength * 2600;
    tone.Q.value = 0.4;
    const gain = context.createGain();
    const start = context.currentTime + 0.005;
    const peak = 0.05 + strength * 0.13;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + RING_SECONDS);
    source.connect(tone);
    tone.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    source.stop(start + RING_SECONDS + 0.02);
    source.onended = () => {
      source.disconnect();
      tone.disconnect();
      gain.disconnect();
    };
  }

  function destroy() {
    if (context) context.close().catch(() => {});
    context = null;
  }

  return { unlock, pluck, destroy };
}
