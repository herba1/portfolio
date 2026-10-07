export const CARRIAGE_EASE_MS = 120;
export const RETURN_MS = 400;
export const QUICK_RETURN_MS = 240;
export const MOTOR_RAMP_MS = 200;
export const FRESH_ROWS = 40;
export const INERTIA_TAU_MS = 240;
export const RELEASE_WINDOW_MS = 90;
export const SWAY_HZ = 0.9;
export const SWAY_ROWS = 66;
export const SWAY_TURN = 0.05;
export const PREFILL = 0.56;
export const APPEAR_MS = 420;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function smooth01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

export function easeOutBack(t) {
  const x = clamp(t, 0, 1);
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}

export function createPoseTrail(capacity = 512) {
  const stride = 5;
  const data = new Float64Array(capacity * stride);
  let head = 0;
  let count = 0;

  function at(back) {
    return ((head - 1 - back + capacity) % capacity) * stride;
  }

  return {
    push(time, x, y, angle, scale) {
      let t = time;
      if (count > 0) {
        const last = data[at(0)];
        if (t < last) t = last;
      }
      const i = head * stride;
      data[i] = t;
      data[i + 1] = x;
      data[i + 2] = y;
      data[i + 3] = angle;
      data[i + 4] = scale;
      head = (head + 1) % capacity;
      if (count < capacity) count += 1;
    },
    sample(time, out) {
      if (count === 0) return false;
      let newer = at(0);
      if (time >= data[newer]) {
        for (let k = 0; k < 4; k += 1) out[k] = data[newer + 1 + k];
        return true;
      }
      for (let back = 1; back < count; back += 1) {
        const older = at(back);
        if (data[older] <= time) {
          const span = data[newer] - data[older];
          const f = span > 0 ? (time - data[older]) / span : 1;
          for (let k = 0; k < 4; k += 1) out[k] = data[older + 1 + k] + (data[newer + 1 + k] - data[older + 1 + k]) * f;
          return true;
        }
        newer = older;
      }
      for (let k = 0; k < 4; k += 1) out[k] = data[newer + 1 + k];
      return true;
    },
    clear() {
      count = 0;
      head = 0;
    },
  };
}

export function springProgress(durationMs, bounce, samples) {
  const zeta = 1 - bounce;
  const omega = (2 * Math.PI) / (durationMs / 1000);
  const damped = omega * Math.sqrt(Math.max(1 - zeta * zeta, 1e-6));
  const settle = -Math.log(0.002) / (zeta * omega);
  const values = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (settle * i) / samples;
    const envelope = Math.exp(-zeta * omega * t);
    values.push(1 - envelope * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t)));
  }
  values[samples] = 1;
  return { values, durationMs: settle * 1000 };
}

export function seededJitter(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
