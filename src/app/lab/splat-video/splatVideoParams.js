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
  interpolated: "Interpolated",
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

export function steppedByFps(meta) {
  return isFlipbook(meta) || isRgbd(meta);
}

export function clipKind(meta) {
  if (meta?.version === 2 && (meta.kind === "rgbd" || meta.kind === "flipbook")) return meta.kind;
  if (meta?.version === 1) return "interpolated";
  return null;
}

export function sortCapacity(meta) {
  if (!isFlipbook(meta)) return meta.count;
  let largest = 0;
  for (let f = 0; f < meta.frames; f += 1) {
    largest = Math.max(largest, meta.frameOffsets[f + 1] - meta.frameOffsets[f]);
  }
  return meta.staticCount + largest;
}

export function frameCursor(time, meta) {
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

export function advanceTime(engine, step, duration) {
  if (!PLAYBACK.bounce) {
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
