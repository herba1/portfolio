import * as THREE from "three";

export const EXPORTS_ROOT = "/splats/4d";
export const FALLBACK_CLIP = "fake";
export const CLIP_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export const TEXTURE_WIDTH = 2048;

export const PLAYBACK = {
  bounce: true,
};

export const SPEEDS = [0.25, 0.5, 1];
export const DEFAULT_SPEED = 1;

export const ORBIT = {
  yawLimitDeg: 12,
  pitchLimitDeg: 6,
  dollyMin: 0.92,
  dollyMax: 1.08,
  dragDegPerPixel: 0.18,
  wheelDollyPerPixel: 0.0012,
  damping: 7,
  resetSnapEpsilon: 1e-4,
};

export const PARALLAX = {
  yawDeg: 2.5,
  pitchDeg: 2,
  idleAfterMs: 1400,
  damping: 2.4,
};

export const RENDER = {
  desktopDpr: 2,
  mobileDpr: 1.5,
  mobileBreakpoint: 900,
  near: 0.01,
  far: 200,
  maxDelta: 0.1,
  lowPass: 0.3,
  coverageFloor: 0.02,
  coverageSolid: 0.35,
};

export const RGBD = {
  tearRelative: 0.08,
  plateTearRelative: 0,
  tearMinLevels: 4,
  platePushLevels: 2,
  seekNudgeFrames: 0.25,
  syncToleranceFrames: 0.5,
};

export const KIND_LABELS = {
  rgbd: "Depth video",
  flipbook: "Flipbook",
  stream: "Stream",
  interpolated: "Interpolated",
};

export const STREAM = {
  ahead: 2,
  behind: 1,
  parallelFetches: 1,
  retryMs: 2000,
  bufferingShowMs: 250,
};

export const SOUND = {
  seekTolerance: 0.08,
  metadataTimeoutMs: 4000,
};

export const SORT = {
  depthEpsilon: 1e-5,
  blendEpsilon: 1e-3,
};

export function exportCommand(clip) {
  if (clip === FALLBACK_CLIP) return "node scripts/splat4d-fake.mjs";
  return `tools/splat4d/export.sh --video <clip.mov> --out public/splats/4d/${clip}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

export function formatSeconds(seconds) {
  const safe = Math.max(0, seconds);
  return `${safe.toFixed(2)} s`;
}

export function formatDuration(seconds) {
  return `${Math.max(0, seconds).toFixed(1)} s`;
}

export function formatCount(count) {
  if (count >= 1e6) return `${(count / 1e6).toFixed(2)}M`;
  if (count >= 1e3) return `${Math.round(count / 1e3)}k`;
  return String(count);
}

export function createEngine() {
  return {
    time: 0,
    direction: 1,
    playing: false,
    speed: DEFAULT_SPEED,
    scrubbing: false,
    reducedMotion: false,
    buffering: false,
    soundWaiting: false,
    muted: true,
    sound: null,
    orbit: {
      yaw: 0,
      pitch: 0,
      dolly: 1,
      targetYaw: 0,
      targetPitch: 0,
      targetDolly: 1,
      parallaxYaw: 0,
      parallaxPitch: 0,
      pointerX: 0,
      pointerY: 0,
      hovering: false,
      dragging: false,
      lastDragAt: -Infinity,
    },
  };
}

export function resetOrbit(engine) {
  const { orbit } = engine;
  orbit.targetYaw = 0;
  orbit.targetPitch = 0;
  orbit.targetDolly = 1;
  orbit.lastDragAt = -Infinity;
  if (engine.reducedMotion) {
    orbit.yaw = 0;
    orbit.pitch = 0;
    orbit.dolly = 1;
    orbit.parallaxYaw = 0;
    orbit.parallaxPitch = 0;
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isFlipbook(meta) {
  return meta.kind === "flipbook";
}

export function isRgbd(meta) {
  return meta.kind === "rgbd";
}

export function isStream(meta) {
  return meta.kind === "stream";
}

export function steppedByFps(meta) {
  return isFlipbook(meta) || isRgbd(meta) || isStream(meta);
}

export function clipKind(meta) {
  if (meta?.version === 3 && meta.kind === "stream") return meta.kind;
  if (meta?.version === 2 && (meta.kind === "rgbd" || meta.kind === "flipbook")) return meta.kind;
  if (meta?.version === 1) return "interpolated";
  return null;
}

function largestMoment(offsets) {
  let largest = 0;
  for (let m = 0; m + 1 < offsets.length; m += 1) largest = Math.max(largest, offsets[m + 1] - offsets[m]);
  return largest;
}

export function sortCapacity(meta) {
  if (isStream(meta)) return meta.static.count + meta.chunks.reduce((most, chunk) => Math.max(most, largestMoment(chunk.frameOffsets)), 0);
  if (!isFlipbook(meta)) return meta.count;
  return meta.staticCount + largestMoment(meta.frameOffsets);
}

function bracketTime(times, time) {
  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  return low;
}

function nearestTime(times, time) {
  const low = bracketTime(times, time);
  const high = Math.min(low + 1, times.length - 1);
  return time - times[low] <= times[high] - time ? low : high;
}

export function frameCursor(time, meta) {
  if (Array.isArray(meta.times) && meta.times.length === meta.frames && meta.frames > 1) {
    const frame = nearestTime(meta.times, time);
    return { frame0: frame, frame1: frame, blend: 0 };
  }
  if (steppedByFps(meta)) {
    const frame = clamp(Math.floor(time * meta.fps + 1e-4), 0, meta.frames - 1);
    return { frame0: frame, frame1: frame, blend: 0 };
  }
  if (meta.frames < 2 || meta.dynamicCount === 0) return { frame0: 0, frame1: 0, blend: 0 };
  const position = clamp(time / meta.duration, 0, 1) * (meta.frames - 1);
  const frame0 = Math.min(meta.frames - 1, Math.floor(position));
  const frame1 = Math.min(meta.frames - 1, frame0 + 1);
  return { frame0, frame1, blend: position - frame0 };
}

export function advanceTime(engine, step, duration, bounce = PLAYBACK.bounce) {
  if (!bounce) {
    engine.time = (engine.time + step) % duration;
    return;
  }
  let time = engine.time + step * engine.direction;
  if (time > duration) {
    time = 2 * duration - time;
    engine.direction = -1;
  } else if (time < 0) {
    time = -time;
    engine.direction = 1;
  }
  engine.time = clamp(time, 0, duration);
}

export function lowPassFor(meta, viewportHeight) {
  const captureHeight = meta.source?.height;
  if (!(captureHeight > 0) || !(viewportHeight > 0)) return RENDER.lowPass;
  const magnification = Math.max(1, viewportHeight / captureHeight);
  return RENDER.lowPass * magnification * magnification;
}

export function frameDuration(meta) {
  if (steppedByFps(meta)) return 1 / meta.fps;
  return meta.frames > 1 ? meta.duration / (meta.frames - 1) : meta.duration;
}

const OPENCV_TO_THREE = new THREE.Matrix4().makeScale(1, -1, -1);
const lensScratch = {
  a: new THREE.Matrix4(),
  b: new THREE.Matrix4(),
  positionA: new THREE.Vector3(),
  positionB: new THREE.Vector3(),
  rotationA: new THREE.Quaternion(),
  rotationB: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  unit: new THREE.Vector3(1, 1, 1),
};

function lensAt(meta, index, target) {
  target.fromArray(meta.cameras[index]).transpose();
  return target.premultiply(OPENCV_TO_THREE).multiply(OPENCV_TO_THREE);
}

export function hasLensPath(meta) {
  return Array.isArray(meta.cameras) && meta.cameras.length > 1 && meta.cameras.every((m) => Array.isArray(m) && m.length === 16);
}

function lensPosition(meta, time) {
  const last = meta.cameras.length - 1;
  const { times } = meta;
  if (!Array.isArray(times) || times.length !== meta.cameras.length) return clamp(time / meta.duration, 0, 1) * last;
  if (time <= times[0]) return 0;
  if (time >= times[last]) return last;
  const low = bracketTime(times, time);
  const span = times[low + 1] - times[low];
  return low + (span > 0 ? (time - times[low]) / span : 0);
}

export function lensMatrix(meta, time, target) {
  const last = meta.cameras.length - 1;
  const position = lensPosition(meta, time);
  const index = Math.min(last - 1, Math.floor(position));
  const blend = position - index;
  const s = lensScratch;
  lensAt(meta, index, s.a).decompose(s.positionA, s.rotationA, s.scale);
  lensAt(meta, index + 1, s.b).decompose(s.positionB, s.rotationB, s.scale);
  s.positionA.lerp(s.positionB, blend);
  s.rotationA.slerp(s.rotationB, blend);
  return target.compose(s.positionA, s.rotationA, s.unit);
}

