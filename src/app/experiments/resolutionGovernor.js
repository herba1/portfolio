const SMOOTHING = 0.08;
const WARMUP_FRAMES = 40;
const SLOW_FACTOR = 1.3;
const SLOW_FLOOR_MS = 22;
const SMOOTH_FACTOR = 1.1;
const NO_GAIN_FACTOR = 0.9;
const RECOVER_FRAMES = 240;
const RETRY_AFTER_FRAMES = 900;
const IGNORE_GAP_MS = 120;
const STEP = 0.8;
const EPSILON = 1e-6;

export default function createResolutionGovernor({ max, min }) {
  let scale = max;
  let ceiling = max;
  let smoothedMs = 0;
  let bestMs = Infinity;
  let frame = 0;
  let framesAtLevel = 0;
  let smoothFrames = 0;
  let holdUntil = 0;
  let holdFrames = RETRY_AFTER_FRAMES;
  let trial = null;

  const moveTo = (next) => {
    scale = next;
    framesAtLevel = 0;
    smoothFrames = 0;
    smoothedMs = 0;
  };

  return {
    get scale() {
      return scale;
    },
    sample(frameMs) {
      if (!(frameMs > 0) || frameMs > IGNORE_GAP_MS) return false;
      frame += 1;
      smoothedMs = smoothedMs ? smoothedMs + (frameMs - smoothedMs) * SMOOTHING : frameMs;
      framesAtLevel += 1;
      if (framesAtLevel < WARMUP_FRAMES) return false;
      bestMs = Math.min(bestMs, smoothedMs);
      const slow = smoothedMs > bestMs * SLOW_FACTOR || smoothedMs > SLOW_FLOOR_MS;

      if (trial) {
        const { from, beforeMs, down } = trial;
        trial = null;
        const failed = down ? smoothedMs > beforeMs * NO_GAIN_FACTOR : slow;
        if (!failed && down) holdFrames = RETRY_AFTER_FRAMES;
        if (failed) {
          if (down) {
            holdUntil = frame + holdFrames;
            holdFrames *= 2;
          } else {
            ceiling = from;
          }
          moveTo(from);
          return true;
        }
      }

      if (slow && scale > min && frame >= holdUntil) {
        trial = { down: true, from: scale, beforeMs: smoothedMs };
        moveTo(Math.max(min, scale * STEP));
        return true;
      }

      smoothFrames = !slow && smoothedMs < bestMs * SMOOTH_FACTOR ? smoothFrames + 1 : 0;
      if (smoothFrames >= RECOVER_FRAMES && scale < ceiling - EPSILON) {
        trial = { down: false, from: scale, beforeMs: smoothedMs };
        moveTo(Math.min(ceiling, scale / STEP));
        return true;
      }
      return false;
    },
  };
}
