import * as THREE from "three";

import { prepareStackedTexture } from "./rgbdMaterial";
import { RGBD, clamp } from "./splatVideoParams";

const PLAY_RETRY_MS = 1000;
const SEEK_SETTLED = 1e-3;

function createVideo(objectUrl) {
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.src = objectUrl;
  video.load();
  return video;
}

export function createVideoClock(blob, meta, { onMetadata, onReady } = {}) {
  const objectUrl = URL.createObjectURL(blob);
  const video = createVideo(objectUrl);
  const texture = prepareStackedTexture(new THREE.VideoTexture(video));

  const refreshFrame = () => {
    if (video.readyState >= video.HAVE_CURRENT_DATA) texture.needsUpdate = true;
  };
  const handleMetadata = () => {
    if (onMetadata) onMetadata(video);
  };
  const handleData = () => {
    if (onReady) onReady(video);
    refreshFrame();
  };
  const handleVisibility = () => {
    if (document.hidden) video.pause();
  };
  video.addEventListener("loadedmetadata", handleMetadata);
  video.addEventListener("loadeddata", handleData);
  video.addEventListener("seeked", refreshFrame);
  document.addEventListener("visibilitychange", handleVisibility);

  let lastPlayAttempt = -Infinity;
  let wasPlaying = false;
  const play = (now) => {
    if (now - lastPlayAttempt < PLAY_RETRY_MS) return;
    lastPlayAttempt = now;
    const attempt = video.play();
    if (attempt) attempt.catch(() => {});
  };

  const frame = 1 / meta.fps;
  const seek = (time, force = false) => {
    if (video.readyState < video.HAVE_METADATA || (video.seeking && !force)) return;
    const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : meta.duration;
    const nudge = RGBD.seekNudgeFrames * frame;
    const target = clamp(time + nudge, 0, Math.max(0, length - nudge));
    const drifted = Math.abs(video.currentTime - time) > RGBD.syncToleranceFrames * frame;
    if (drifted && Math.abs(video.currentTime - target) > SEEK_SETTLED) video.currentTime = target;
  };

  const audible = Boolean(meta.audio);
  const applyMuted = (engine) => {
    const muted = !audible || engine.muted !== false;
    if (video.muted !== muted) video.muted = muted;
  };

  return {
    video,
    texture,
    gesture(engine) {
      applyMuted(engine);
      if (engine.playing && video.paused) {
        const attempt = video.play();
        if (attempt) attempt.catch(() => {});
      }
    },
    sync(engine, now) {
      applyMuted(engine);
      if (video.playbackRate !== engine.speed) video.playbackRate = engine.speed;
      const wantPlaying = engine.playing && !engine.scrubbing && !document.hidden;
      if (wantPlaying) {
        if (!wasPlaying) seek(engine.time, true);
        wasPlaying = true;
        if (video.paused) play(now);
        else lastPlayAttempt = -Infinity;
        engine.time = clamp(video.currentTime, 0, meta.duration);
        return;
      }
      wasPlaying = false;
      if (!video.paused) video.pause();
      lastPlayAttempt = -Infinity;
      seek(engine.time);
    },
    dispose() {
      document.removeEventListener("visibilitychange", handleVisibility);
      video.removeEventListener("loadedmetadata", handleMetadata);
      video.removeEventListener("loadeddata", handleData);
      video.removeEventListener("seeked", refreshFrame);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      texture.dispose();
    },
  };
}
