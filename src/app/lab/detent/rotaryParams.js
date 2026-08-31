export const MIN_VALUE = 0;
export const MAX_VALUE = 100;
export const STEP = 5;
export const DEFAULT_VALUE = 65;

export const START_ANGLE = -135;
export const END_ANGLE = 135;

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
  return Math.round(raw / STEP) * STEP;
}

export function clampValue(value) {
  return Math.min(MAX_VALUE, Math.max(MIN_VALUE, value));
}
