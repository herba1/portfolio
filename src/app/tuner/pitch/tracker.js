const CLARITY_ATTACK = 0.7;
const CLARITY_RELEASE = 0.6;
const SNR_REQUIRED = 2.6;
const ABSOLUTE_FLOOR = 0.00018;
const NOISE_FALL = 0.3;
const NOISE_RISE = 0.012;
const HOLD_MS = 400;
const JUMP_CENTS = 90;
const JUMP_FRAMES = 2;
const EMA_MIN = 0.09;
const EMA_MAX = 0.55;
const EMA_SPAN_CENTS = 40;
const MEDIAN_WINDOW = 7;
const TRUST_MIN = 0.15;
const TARGET_PEAK = 0.5;
const PEAK_ATTACK = 0.45;
const PEAK_RELEASE = 0.025;
const MIN_ENVELOPE = 0.0025;
const MAX_DISPLAY_GAIN = 64;
const LEVEL_SCALE = 2.3;
const GAIN_DECAY = 0.006;

export function createPitchTracker() {
  const recent = [];
  const sorted = [];

  let noiseFloor = ABSOLUTE_FLOOR;
  let peakEnvelope = MIN_ENVELOPE;
  let displayGain = 1;
  let smoothedCents = null;
  let jumpCount = 0;
  let voiced = false;
  let lastVoicedAt = 0;

  const state = {
    frequency: 0,
    confidence: 0,
    level: 0,
    voiced: false,
    holding: false,
    noiseFloor: ABSOLUTE_FLOOR,
  };

  function update(reading, now) {
    const { frequency, clarity, rms, peak } = reading;

    const gateFloor = Math.max(ABSOLUTE_FLOOR, noiseFloor * SNR_REQUIRED);
    const threshold = voiced ? CLARITY_RELEASE : CLARITY_ATTACK;
    const candidate =
      frequency > 0 && clarity >= threshold && rms >= gateFloor;

    if (!candidate) {
      const rate = rms < noiseFloor ? NOISE_FALL : NOISE_RISE;
      noiseFloor += (rms - noiseFloor) * rate;
      if (noiseFloor < ABSOLUTE_FLOOR * 0.25) noiseFloor = ABSOLUTE_FLOOR * 0.25;
      displayGain += (1 - displayGain) * GAIN_DECAY;
    }

    if (candidate) {
      peakEnvelope +=
        (peak - peakEnvelope) * (peak > peakEnvelope ? PEAK_ATTACK : PEAK_RELEASE);
      if (peakEnvelope < MIN_ENVELOPE) peakEnvelope = MIN_ENVELOPE;
      displayGain = clamp(TARGET_PEAK / peakEnvelope, 1, MAX_DISPLAY_GAIN);
    }

    state.level = clamp(rms * displayGain * LEVEL_SCALE, 0, 1);
    state.noiseFloor = noiseFloor;

    if (candidate) {
      voiced = true;
      lastVoicedAt = now;
      const cents = 1200 * Math.log2(frequency);

      if (smoothedCents != null && Math.abs(cents - smoothedCents) > JUMP_CENTS) {
        jumpCount++;
        if (jumpCount >= JUMP_FRAMES) {
          recent.length = 0;
          smoothedCents = cents;
          jumpCount = 0;
        }
      } else {
        jumpCount = 0;
        const stable = median(recent, sorted, cents);
        if (smoothedCents == null) {
          smoothedCents = stable;
        } else {
          const delta = stable - smoothedCents;
          const distance = Math.abs(delta);
          const trust = clamp(
            (clarity - CLARITY_RELEASE + 0.14) / 0.4,
            TRUST_MIN,
            1
          );
          smoothedCents +=
            delta *
            clamp(distance / EMA_SPAN_CENTS, EMA_MIN, EMA_MAX) *
            trust;
        }
      }

      state.frequency = Math.pow(2, smoothedCents / 1200);
      state.confidence = clarity;
      state.voiced = true;
      state.holding = false;
      return state;
    }

    voiced = false;

    if (smoothedCents != null && now - lastVoicedAt < HOLD_MS) {
      state.confidence = 0;
      state.voiced = false;
      state.holding = true;
      return state;
    }

    recent.length = 0;
    smoothedCents = null;
    jumpCount = 0;
    state.frequency = 0;
    state.confidence = 0;
    state.voiced = false;
    state.holding = false;
    return state;
  }

  function reset() {
    recent.length = 0;
    noiseFloor = ABSOLUTE_FLOOR;
    peakEnvelope = MIN_ENVELOPE;
    displayGain = 1;
    smoothedCents = null;
    jumpCount = 0;
    voiced = false;
    lastVoicedAt = 0;
    state.frequency = 0;
    state.confidence = 0;
    state.level = 0;
    state.voiced = false;
    state.holding = false;
  }

  return { update, reset, state };
}

function median(recent, sorted, value) {
  recent.push(value);
  if (recent.length > MEDIAN_WINDOW) recent.shift();
  sorted.length = 0;
  for (let i = 0; i < recent.length; i++) sorted.push(recent[i]);
  sorted.sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}
