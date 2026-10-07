"use client";

import { useEffect, useRef } from "react";

import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { createDevelopEngine, MAX_LEAN, REST_LEAN_Y } from "./developEngine";
import { loadSource } from "./developSources";

const PRESIM_SECONDS = 0.95;
const PRESIM_STEP = 1 / 60;
const INTRO_STEPS = [
  { until: 0.1, x: 0, y: REST_LEAN_Y },
  { until: 0.7, x: -0.11, y: 0.12 },
  { until: 2.2, x: -0.03, y: -0.03 },
];
const ROCK_LEAN_Y = 0.13;
const POINTER_REACH = 1.15;
const KEY_LEAN = 0.12;
const HOVER_LEAN = 0.03;
const TAP_SLOP_PX = 6;
const TAP_MS = 260;
const TAP_HOLD_SECONDS = 0.45;
const FLICK_WINDOW_MS = 90;
const FLICK_GAIN = 0.32;
const ROCK_LEAN = 0.11;
const DRIFT_PX = 6;
const ENERGY_TAU = 1.6;
const SLOW_FRAME_MS = 83;
const MAX_SLOW_SECONDS = 0.25;
const IDLE_STOP_MS = 8000;
const STATS_EVERY_SECONDS = 0.4;
const FOG_SECONDS = 8;
const SAMPLE_CAPACITY = 16;
const GYRO_GAIN = 0.8;
const MAX_FRAME_SECONDS = 1 / 30;
const THUMB_WIDTH = 112;
const THUMB_HEIGHT = 140;

function settingsFrom(params) {
  return {
    depth: params.depth,
    slosh: params.slosh,
    speed: params.speed,
    contrast: params.contrast,
    grain: params.grain,
    fog: params.fog,
    lith: params.lith,
    paper: params.paper,
    silver: params.silver,
  };
}

function introTarget(elapsed) {
  for (let index = 0; index < INTRO_STEPS.length; index += 1) {
    if (elapsed < INTRO_STEPS[index].until) return INTRO_STEPS[index];
  }
  return null;
}

function restartAttribute(element, name, value) {
  delete element.dataset[name];
  void element.offsetWidth;
  element.dataset[name] = value;
}

export default function DevelopStage({ source, params, embedded = false, onApi, onStats, onFailure, onNext, onReady, label }) {
  const plateRef = useRef(null);
  const paperRef = useRef(null);
  const departingRef = useRef(null);
  const runtimeRef = useRef(null);
  const callbacksRef = useRef({ onApi, onStats, onFailure, onNext, onReady });
  const initialParamsRef = useRef(params);

  useEffect(() => {
    callbacksRef.current = { onApi, onStats, onFailure, onNext, onReady };
  }, [onApi, onStats, onFailure, onNext, onReady]);

  useEffect(() => {
    const plate = plateRef.current;
    const paper = paperRef.current;
    const departing = departingRef.current;
    if (!plate || !paper || !departing) return undefined;

    const canvas = document.createElement("canvas");
    canvas.className = "develop-canvas";
    canvas.setAttribute("aria-hidden", "true");
    paper.appendChild(canvas);

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;

    let engine = null;
    try {
      engine = createDevelopEngine(canvas, { gridWidth: coarse ? 112 : 144 });
    } catch (error) {
      if (typeof console !== "undefined") console.error("develop", error);
      engine = null;
    }
    if (!engine) {
      canvas.remove();
      callbacksRef.current.onFailure?.("engine");
      return undefined;
    }

    engine.setSettings(settingsFrom(initialParamsRef.current));
    engine.resetSheet(Math.random());

    const governor = createResolutionGovernor({ max: 1, min: 0.55 });
    const pixelCap = embedded || coarse ? 1.5 : 2;
    const target = [0, REST_LEAN_Y];
    const samples = new Float64Array(SAMPLE_CAPACITY * 3);
    const pointer = { active: false, id: -1, x: 0.5, y: 0.5, vx: 0, vy: 0, pressAt: 0, startX: 0, startY: 0, moved: false, rect: null, sampleCount: 0, sampleHead: 0, lastAt: 0 };
    const keys = { x: 0, y: 0 };
    const gyro = { on: false, x: 0, y: 0, baseBeta: null, baseGamma: null };
    const hover = { on: false, x: 0.5, y: 0.5 };

    let cssWidth = 1;
    let cssHeight = 1;
    let raf = 0;
    let timer = 0;
    let last = 0;
    let lastInput = performance.now();
    let energy = 1;
    let statsClock = 0;
    let statsSettled = false;
    let peakSeconds = 0;
    let shownImage = null;
    let shownSeconds = -1;
    let shownFog = false;
    let ready = false;
    let visible = !document.hidden;
    let onscreen = true;
    let script = null;
    let rockSign = 1;
    let driftX = 0;
    let driftY = 0;
    let disposed = false;

    const water = () => (reduced ? 0 : 1);
    const runnable = () => ready && visible && onscreen && !disposed;

    const emitStats = (seconds, fogging) => {
      if (seconds === shownSeconds && fogging === shownFog) return;
      shownSeconds = seconds;
      shownFog = fogging;
      callbacksRef.current.onStats?.({ seconds, fogging });
    };

    const takeStats = () => {
      if (!engine.pollStats()) return;
      peakSeconds = Math.max(peakSeconds, engine.stats.seconds);
      emitStats(Math.floor(peakSeconds), peakSeconds >= FOG_SECONDS);
    };

    const advance = (dt, targetX, targetY) => {
      if (reduced) engine.settle(dt, targetX, targetY);
      else engine.simulate(dt, targetX, targetY);
    };

    const applySize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, pixelCap) * governor.scale;
      engine.resize(cssWidth, cssHeight, ratio);
      if (ready) engine.render(water());
    };

    const leanToward = (x, y, reach) => {
      let lx = (x - 0.5) * 2 * MAX_LEAN * reach;
      let ly = (y - 0.5) * 2 * MAX_LEAN * reach;
      const size = Math.hypot(lx, ly);
      if (size > MAX_LEAN) {
        lx *= MAX_LEAN / size;
        ly *= MAX_LEAN / size;
      }
      target[0] = lx;
      target[1] = ly;
    };

    const resolveTarget = (now) => {
      if (pointer.active) {
        leanToward(pointer.x, pointer.y, POINTER_REACH);
        return;
      }
      if (keys.x || keys.y) {
        const size = Math.hypot(keys.x, keys.y);
        target[0] = (keys.x / size) * KEY_LEAN;
        target[1] = (keys.y / size) * KEY_LEAN;
        return;
      }
      if (script) {
        const elapsed = (now - script.start) / 1000;
        if (script.intro) {
          const step = introTarget(elapsed);
          if (step) {
            target[0] = step.x;
            target[1] = step.y;
            return;
          }
        }
        for (let index = 0; index < script.steps.length; index += 1) {
          const step = script.steps[index];
          if (elapsed < step.until) {
            target[0] = step.x;
            target[1] = step.y;
            return;
          }
        }
        script = null;
      }
      if (gyro.on) {
        target[0] = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, gyro.x));
        target[1] = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, REST_LEAN_Y + gyro.y));
        return;
      }
      if (hover.on && !reduced) {
        target[0] = (hover.x - 0.5) * 2 * HOVER_LEAN;
        target[1] = REST_LEAN_Y + (hover.y - 0.5) * 2 * HOVER_LEAN;
        return;
      }
      target[0] = 0;
      target[1] = REST_LEAN_Y;
    };

    const writeDrift = () => {
      if (reduced) return;
      const x = (engine.lean[0] / MAX_LEAN) * DRIFT_PX;
      const y = (-(engine.lean[1] - REST_LEAN_Y) / MAX_LEAN) * DRIFT_PX;
      if (Math.abs(x - driftX) < 0.05 && Math.abs(y - driftY) < 0.05) return;
      driftX = x;
      driftY = y;
      paper.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    };

    const later = () => {
      timer = setTimeout(tick, SLOW_FRAME_MS);
    };

    const frame = (now) => {
      raf = 0;
      timer = 0;
      if (!runnable()) return;
      const frameMs = last ? now - last : 16.7;
      last = now;
      const elapsed = Math.min(frameMs / 1000, MAX_SLOW_SECONDS);
      const dt = Math.min(elapsed, MAX_FRAME_SECONDS);

      takeStats();
      resolveTarget(now);
      if (!pointer.active || now - pointer.lastAt > 40) {
        const fade = Math.exp(-dt * 12);
        pointer.vx *= fade;
        pointer.vy *= fade;
      }
      engine.setPaddle(pointer.active && !reduced ? 1 : 0, pointer.x, pointer.y, pointer.vx, pointer.vy);

      const offTarget = Math.abs(engine.lean[0] - target[0]) + Math.abs(engine.lean[1] - target[1]);
      energy = Math.max(energy * Math.exp(-dt / ENERGY_TAU), engine.motion() * 2, pointer.active ? 1 : 0);
      const moving = pointer.active || script !== null || gyro.on || keys.x !== 0 || keys.y !== 0 || offTarget > 0.002 || energy > 0.01;

      if (!moving && now - lastInput > IDLE_STOP_MS) {
        if (engine.statsPending) {
          later();
          return;
        }
        if (!statsSettled) {
          statsSettled = true;
          engine.requestStats();
          later();
        }
        return;
      }
      statsSettled = false;

      if (moving) {
        advance(dt, target[0], target[1]);
        engine.develop(dt);
        engine.render(water());
        if (governor.sample(frameMs)) applySize();
      } else {
        engine.develop(elapsed);
        engine.render(water());
      }

      statsClock += elapsed;
      if (statsClock >= STATS_EVERY_SECONDS) {
        statsClock = 0;
        engine.requestStats();
      }
      writeDrift();

      if (moving) raf = requestAnimationFrame(frame);
      else later();
    };

    const tick = () => {
      timer = 0;
      frame(performance.now());
    };

    const start = () => {
      if (raf || !runnable()) return;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      } else {
        last = 0;
      }
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = 0;
      timer = 0;
    };

    const wake = () => {
      lastInput = performance.now();
      energy = 1;
      start();
    };

    const reveal = () => {
      engine.resetSheet(Math.random());
      for (let elapsed = 0; elapsed < PRESIM_SECONDS; elapsed += PRESIM_STEP) {
        const step = introTarget(elapsed);
        advance(PRESIM_STEP, step ? step.x : 0, step ? step.y : REST_LEAN_Y);
        engine.develop(PRESIM_STEP);
      }
      ready = true;
      applySize();
      engine.requestStats();
      if (!reduced) script = { start: performance.now() - PRESIM_SECONDS * 1000, intro: true, steps: [] };
      paper.dataset.ready = "true";
      wake();
      callbacksRef.current.onReady?.();
    };

    const showImage = (loaded) => {
      if (!loaded || loaded === shownImage) return false;
      shownImage = loaded;
      engine.setImage(loaded.image, loaded.crop, loaded.levels);
      return true;
    };

    const setImage = (loaded) => {
      if (disposed || !showImage(loaded)) return;
      if (!ready) {
        reveal();
        return;
      }
      engine.render(water());
      wake();
    };

    const freshSheet = (loaded) => {
      if (showImage(loaded) && !ready) {
        reveal();
        return;
      }
      engine.resetSheet(Math.random());
      script = null;
      peakSeconds = 0;
      emitStats(0, false);
      if (!reduced) restartAttribute(paper, "enter", "true");
      if (ready) {
        engine.render(water());
        callbacksRef.current.onReady?.();
      }
      wake();
    };

    const encode = (sheet, type, quality) =>
      new Promise((resolve) => {
        sheet.toBlob((file) => resolve(file ? URL.createObjectURL(file) : null), type, quality);
      });

    const retire = (loaded) => {
      if (!ready) {
        if (loaded) setImage(loaded);
        return Promise.resolve(null);
      }
      departing.width = canvas.width;
      departing.height = canvas.height;
      const context = departing.getContext("2d");
      if (!context) {
        freshSheet(loaded);
        return Promise.resolve(null);
      }
      engine.capture(context, canvas.width, canvas.height);
      departing.style.translate = paper.style.translate;
      restartAttribute(departing, "state", reduced ? "fading" : "leaving");
      const thumb = document.createElement("canvas");
      thumb.width = THUMB_WIDTH;
      thumb.height = THUMB_HEIGHT;
      const thumbContext = thumb.getContext("2d");
      thumbContext?.drawImage(departing, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      const files = Promise.all([encode(departing, "image/jpeg", 0.9), thumbContext ? encode(thumb, "image/jpeg", 0.86) : Promise.resolve(null)]);
      freshSheet(loaded);
      return files.then(([full, small]) => (full ? { full, thumb: small ?? full } : null));
    };

    const save = (name) => {
      if (!ready) return;
      const sheet = document.createElement("canvas");
      sheet.width = canvas.width;
      sheet.height = canvas.height;
      const context = sheet.getContext("2d");
      if (!context) return;
      engine.capture(context, canvas.width, canvas.height);
      sheet.toBlob((file) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }, "image/png");
    };

    const rock = () => {
      rockSign = -rockSign;
      script = {
        start: performance.now(),
        steps: [
          { until: 0.5, x: ROCK_LEAN * rockSign, y: ROCK_LEAN_Y },
          { until: 1.0, x: -ROCK_LEAN * rockSign, y: ROCK_LEAN_Y * 0.9 },
        ],
      };
      wake();
    };

    const handleOrientation = (event) => {
      if (event.beta === null || event.gamma === null) return;
      if (gyro.baseBeta === null) {
        gyro.baseBeta = event.beta;
        gyro.baseGamma = event.gamma;
      }
      gyro.x = ((event.gamma - gyro.baseGamma) * Math.PI * GYRO_GAIN) / 180;
      gyro.y = ((gyro.baseBeta - event.beta) * Math.PI * GYRO_GAIN) / 180;
      lastInput = performance.now();
    };

    const setGyro = (on) => {
      gyro.on = on;
      gyro.baseBeta = null;
      gyro.baseGamma = null;
      gyro.x = 0;
      gyro.y = 0;
      if (on) window.addEventListener("deviceorientation", handleOrientation);
      else window.removeEventListener("deviceorientation", handleOrientation);
      wake();
    };

    const pushSample = (time, x, y) => {
      const at = pointer.sampleHead * 3;
      samples[at] = time;
      samples[at + 1] = x;
      samples[at + 2] = y;
      pointer.sampleHead = (pointer.sampleHead + 1) % SAMPLE_CAPACITY;
      pointer.sampleCount = Math.min(pointer.sampleCount + 1, SAMPLE_CAPACITY);
    };

    const locate = (event) => {
      const rect = pointer.rect;
      const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
      return [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
    };

    const handleDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (pointer.active) return;
      pointer.rect = plate.getBoundingClientRect();
      const [x, y] = locate(event);
      const now = performance.now();
      try {
        plate.setPointerCapture(event.pointerId);
      } catch {
        pointer.id = event.pointerId;
      }
      pointer.active = true;
      pointer.id = event.pointerId;
      pointer.x = x;
      pointer.y = y;
      pointer.vx = 0;
      pointer.vy = 0;
      pointer.pressAt = now;
      pointer.lastAt = now;
      pointer.startX = event.clientX;
      pointer.startY = event.clientY;
      pointer.moved = false;
      pointer.sampleCount = 0;
      pointer.sampleHead = 0;
      pushSample(now, x, y);
      script = null;
      plate.dataset.pressed = "true";
      wake();
    };

    const handleHover = (event) => {
      if (event.pointerType !== "mouse") return;
      const rect = plate.getBoundingClientRect();
      hover.x = Math.min(Math.max((event.clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
      hover.y = Math.min(Math.max(1 - (event.clientY - rect.top) / Math.max(rect.height, 1), 0), 1);
      hover.on = true;
      lastInput = performance.now();
      energy = Math.max(energy, 0.3);
      start();
    };

    const handleLeave = () => {
      hover.on = false;
      start();
    };

    const handleMove = (event) => {
      if (!pointer.active) {
        handleHover(event);
        return;
      }
      if (event.pointerId !== pointer.id) return;
      const [x, y] = locate(event);
      const now = performance.now();
      const elapsed = Math.max((now - pointer.lastAt) / 1000, 0.004);
      const blend = 1 - Math.exp(-elapsed * 40);
      pointer.vx += ((x - pointer.x) / elapsed - pointer.vx) * blend;
      pointer.vy += ((y - pointer.y) / elapsed - pointer.vy) * blend;
      pointer.x = x;
      pointer.y = y;
      pointer.lastAt = now;
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > TAP_SLOP_PX) pointer.moved = true;
      pushSample(now, x, y);
      lastInput = now;
    };

    const releaseVelocity = (now) => {
      let oldest = -1;
      let newest = -1;
      for (let index = 0; index < pointer.sampleCount; index += 1) {
        const slot = ((pointer.sampleHead - 1 - index + SAMPLE_CAPACITY) % SAMPLE_CAPACITY) * 3;
        if (now - samples[slot] > FLICK_WINDOW_MS) break;
        if (newest < 0) newest = slot;
        oldest = slot;
      }
      if (oldest < 0 || newest === oldest) return [0, 0];
      const span = Math.max((samples[newest] - samples[oldest]) / 1000, 0.016);
      return [(samples[newest + 1] - samples[oldest + 1]) / span, (samples[newest + 2] - samples[oldest + 2]) / span];
    };

    const handleUp = (event) => {
      if (!pointer.active || event.pointerId !== pointer.id) return;
      const now = performance.now();
      pointer.active = false;
      delete plate.dataset.pressed;
      if (plate.hasPointerCapture?.(event.pointerId)) plate.releasePointerCapture(event.pointerId);
      if (!pointer.moved && now - pointer.pressAt < TAP_MS) {
        leanToward(pointer.x, pointer.y, POINTER_REACH);
        script = { start: now, steps: [{ until: TAP_HOLD_SECONDS, x: target[0], y: target[1] }] };
      } else if (event.type === "pointerup") {
        const [vx, vy] = releaseVelocity(now);
        engine.kick(vx * FLICK_GAIN, vy * FLICK_GAIN);
      }
      wake();
    };

    const arrowAxis = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

    const handleKeyDown = (event) => {
      const axis = arrowAxis[event.key];
      if (axis) {
        event.preventDefault();
        if (axis[0]) keys.x = axis[0];
        if (axis[1]) keys.y = axis[1];
        script = null;
        wake();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        callbacksRef.current.onNext?.();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        rock();
      }
    };

    const handleKeyUp = (event) => {
      const axis = arrowAxis[event.key];
      if (!axis) return;
      if (axis[0] && keys.x === axis[0]) keys.x = 0;
      if (axis[1] && keys.y === axis[1]) keys.y = 0;
      wake();
    };

    const handleBlur = () => {
      keys.x = 0;
      keys.y = 0;
    };

    const handleDepartingEnd = () => {
      departing.dataset.state = "gone";
    };

    const handleVisibility = () => {
      visible = !document.hidden;
      if (visible) start();
      else stop();
    };

    const handleMotionChange = () => {
      reduced = motionQuery.matches;
      if (reduced) paper.style.translate = "";
      if (ready) engine.render(water());
    };

    const handleContextLost = (event) => {
      event.preventDefault();
      stop();
      disposed = true;
      callbacksRef.current.onFailure?.("lost");
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      cssWidth = entry.contentRect.width;
      cssHeight = entry.contentRect.height;
      applySize();
    });
    resizeObserver.observe(paper);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      if (onscreen) start();
      else stop();
    });
    intersectionObserver.observe(plate);

    plate.addEventListener("pointerdown", handleDown);
    plate.addEventListener("pointermove", handleMove);
    plate.addEventListener("pointerup", handleUp);
    plate.addEventListener("pointercancel", handleUp);
    plate.addEventListener("pointerleave", handleLeave);
    plate.addEventListener("lostpointercapture", handleUp);
    plate.addEventListener("keydown", handleKeyDown);
    plate.addEventListener("keyup", handleKeyUp);
    plate.addEventListener("blur", handleBlur);
    departing.addEventListener("animationend", handleDepartingEnd);
    document.addEventListener("visibilitychange", handleVisibility);
    motionQuery.addEventListener("change", handleMotionChange);
    canvas.addEventListener("webglcontextlost", handleContextLost);

    runtimeRef.current = {
      setImage,
      applyParams: (next) => {
        engine.setSettings(settingsFrom(next));
        if (ready) engine.render(water());
        wake();
      },
    };

    callbacksRef.current.onApi?.({ retire, save, rock, fresh: freshSheet, setGyro });

    return () => {
      disposed = true;
      stop();
      runtimeRef.current = null;
      callbacksRef.current.onApi?.(null);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      plate.removeEventListener("pointerdown", handleDown);
      plate.removeEventListener("pointermove", handleMove);
      plate.removeEventListener("pointerup", handleUp);
      plate.removeEventListener("pointercancel", handleUp);
      plate.removeEventListener("pointerleave", handleLeave);
      plate.removeEventListener("lostpointercapture", handleUp);
      plate.removeEventListener("keydown", handleKeyDown);
      plate.removeEventListener("keyup", handleKeyUp);
      plate.removeEventListener("blur", handleBlur);
      departing.removeEventListener("animationend", handleDepartingEnd);
      document.removeEventListener("visibilitychange", handleVisibility);
      motionQuery.removeEventListener("change", handleMotionChange);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      window.removeEventListener("deviceorientation", handleOrientation);
      delete paper.dataset.ready;
      paper.style.translate = "";
      engine.destroy();
      canvas.remove();
    };
  }, [embedded]);

  useEffect(() => {
    let cancelled = false;
    loadSource(source).then(
      (loaded) => {
        if (!cancelled) runtimeRef.current?.setImage(loaded);
      },
      () => {
        if (!cancelled) callbacksRef.current.onFailure?.("source", source.id);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    runtimeRef.current?.applyParams(params);
  }, [params]);

  return (
    <div
      ref={plateRef}
      className="develop-plate"
      tabIndex={0}
      role="application"
      aria-roledescription="developing tray"
      aria-label={`${label}. Hold the sheet where the developer should run. Arrow keys tip the tray, space rocks it, enter starts the next sheet.`}
    >
      <div ref={paperRef} className="develop-paper" />
      <canvas ref={departingRef} className="develop-departing" aria-hidden="true" />
    </div>
  );
}
