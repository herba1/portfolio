import { SOUND, clamp } from "./splatVideoParams";

export function createSoundClock(src, duration) {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.loop = true;
  audio.muted = true;
  audio.defaultMuted = true;
  audio.preservesPitch = true;
  audio.src = src;

  let failed = false;
  let blocked = false;
  let pending = false;
  let waitingSince = -1;

  const fail = () => {
    failed = true;
  };
  const onVisibility = () => {
    if (document.hidden) audio.pause();
  };
  audio.addEventListener("error", fail);
  document.addEventListener("visibilitychange", onVisibility);

  const hasMetadata = () => audio.readyState >= audio.HAVE_METADATA;

  const align = (time) => {
    if (!hasMetadata() || audio.seeking) return;
    if (Math.abs(audio.currentTime - time) > SOUND.seekTolerance) audio.currentTime = time;
  };

  const start = (time, now) => {
    if (pending) return;
    if (!hasMetadata()) {
      if (waitingSince < 0) waitingSince = now;
      else if (now - waitingSince > SOUND.metadataTimeoutMs) failed = true;
      return;
    }
    waitingSince = -1;
    align(time);
    pending = true;
    const attempt = audio.play();
    if (!attempt) {
      pending = false;
      return;
    }
    attempt.then(
      () => {
        pending = false;
      },
      (error) => {
        pending = false;
        if (error?.name === "NotAllowedError") blocked = true;
        else if (error?.name !== "AbortError") failed = true;
      },
    );
  };

  return {
    sync(engine, gesture = false) {
      if (gesture) blocked = false;
      const want = engine.playing && !engine.scrubbing && !engine.buffering && !document.hidden;
      if (failed || (blocked && want)) {
        if (!audio.paused) audio.pause();
        engine.soundWaiting = false;
        return false;
      }
      if (audio.muted !== engine.muted) audio.muted = engine.muted;
      if (audio.playbackRate !== engine.speed) audio.playbackRate = engine.speed;
      if (!want) {
        if (!audio.paused) audio.pause();
        align(engine.time);
        waitingSince = -1;
        engine.soundWaiting = false;
        return true;
      }
      if (audio.paused) {
        start(engine.time, performance.now());
        engine.soundWaiting = !failed;
        return !failed;
      }
      engine.soundWaiting = pending || audio.seeking || audio.readyState < audio.HAVE_FUTURE_DATA;
      engine.time = clamp(audio.currentTime, 0, duration);
      return true;
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibility);
      audio.removeEventListener("error", fail);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}
