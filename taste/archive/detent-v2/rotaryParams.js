export const MIN_VALUE = 0;
export const MAX_VALUE = 100;
export const STEP = 2;
export const DEFAULT_VALUE = 42;

export const START_ANGLE = -135;
export const END_ANGLE = 135;

export const FRICTION = 0.94;
export const VELOCITY_STOP = 0.02;

export const TICK_PROXIMITY_SPREAD = STEP * 6;
export const TICK_ACTIVE_RANGE = STEP * 1.5;
export const VELOCITY_TRAIL_NORMALIZER = 0.32;
export const MAX_BEND_DEG = 34;
export const MAX_BLUR_PX = 3.2;

export const TICKS = Array.from(
  { length: (MAX_VALUE - MIN_VALUE) / STEP + 1 },
  (_, index) => MIN_VALUE + index * STEP,
);

export function angleForValue(value) {
  const t = (value - MIN_VALUE) / (MAX_VALUE - MIN_VALUE);
  return START_ANGLE + t * (END_ANGLE - START_ANGLE);
}

export function valueForAngle(angle) {
  const clamped = Math.max(START_ANGLE, Math.min(END_ANGLE, angle));
  const t = (clamped - START_ANGLE) / (END_ANGLE - START_ANGLE);
  const raw = MIN_VALUE + t * (MAX_VALUE - MIN_VALUE);
  return raw;
}

export function clampValue(value) {
  return Math.min(MAX_VALUE, Math.max(MIN_VALUE, value));
}

export function snapValue(value) {
  return Math.round(clampValue(value) / STEP) * STEP;
}

export function tickProximity(tickValue, currentValue) {
  const distance = Math.abs(tickValue - currentValue);
  return Math.exp(-((distance / TICK_PROXIMITY_SPREAD) ** 2));
}
