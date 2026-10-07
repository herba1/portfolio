import { createCopierGL } from "./CopierGL";
import { createCopier2D } from "./Copier2D";
import { PLATEN_COLOUR, SHEET_HEIGHT as H, SHEET_WIDTH as W, hexToRgb } from "./copierParams";
import {
  APPEAR_MS,
  CARRIAGE_EASE_MS,
  FRESH_ROWS,
  INERTIA_TAU_MS,
  MOTOR_RAMP_MS,
  PREFILL,
  QUICK_RETURN_MS,
  RELEASE_WINDOW_MS,
  RETURN_MS,
  SWAY_HZ,
  SWAY_ROWS,
  SWAY_TURN,
  clamp,
  createPoseTrail,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  smooth01,
} from "./copierMotion";
import { createCopierSound } from "./copierSound";

const BAR_GRAB_CSS = 18;
const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;
const MOVE_SLOTS = 12;
const RECENTRE_MS = 560;
const NUDGE_CAP = 1.2;
const TAU = Math.PI * 2;

function baseSizeFor(width, height, kind) {
  if (kind === "copy") return [W, H];
  const fit = Math.min((W * 0.8) / width, (H * 0.84) / height);
  return [width * fit, height * fit];
}

function capToCanvas(image) {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = longest > 1280 ? 1280 / longest : longest < 768 ? 768 / longest : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createCopierEngine({ host, canvasHost, handle, getProps, reducedMotion }) {
  const canvas = document.createElement("canvas");
  canvas.className = "copier-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvasHost.appendChild(canvas);

  let renderer = createCopierGL(canvas);
  if (!renderer) renderer = createCopier2D(canvas);
  host.dataset.renderer = renderer ? renderer.kind : "none";

  const sound = createCopierSound();
  const ledger = new Float32Array(H * 4);
  const trail = createPoseTrail(512);
  const sampled = new Float64Array(4);
  const moves = new Float64Array(MOVE_SLOTS * 3);
  const colourCache = new Map();
  const platen = hexToRgb(PLATEN_COLOUR);
  const pointers = new Map();

  const pose = { x: W / 2, y: H / 2, angle: 0, scale: 1 };
  const target = { angle: 0, scale: 1 };
  const velocity = { x: 0, y: 0 };
  const sway = { amp: 0, ampTarget: 0, clock: 0, offsetX: 0, offsetA: 0 };
  const settle = { active: false, clock: 0, fromX: 0, fromY: 0, fromA: 0, fromS: 1 };
  const frame = {
    sourceWidth: 1,
    sourceHeight: 1,
    baseWidth: W,
    baseHeight: H,
    poseX: W / 2,
    poseY: H / 2,
    poseAngle: 0,
    poseScale: 1,
    printed: 0,
    lamp: 0,
    lampGlow: 0.3,
    pxPerCss: 2,
    appear: 0,
    fresh: FRESH_ROWS,
    lid: 1,
    threshold: 0.5,
    contrast: 0.7,
    grain: 0.5,
    streaks: 0.4,
    generation: 0,
    preset: 0,
    seed: 0,
    drum: Math.random() * 97,
    paper: [1, 1, 1],
    ink: [0, 0, 0],
    inkB: [0, 0, 0],
    platen,
    grab: 0,
    ring: hexToRgb("#1a1a1a"),
  };

  let moveHead = 0;
  let moveCount = 0;
  let inertia = false;
  let gesture = null;
  let carriage = null;
  let phase = "idle";
  let scan = 0;
  let lamp = 0;
  let lampGlow = 0;
  let passClock = 0;
  let motorClock = MOTOR_RAMP_MS;
  let returnClock = 0;
  let returnMs = RETURN_MS;
  let returnFrom = H;
  let queued = false;
  let appearClock = APPEAR_MS;
  let source = null;
  let loadToken = 0;
  let autoplayed = false;
  let heldTaken = false;
  let raf = 0;
  let ticking = false;
  let last = null;
  let wanted = false;
  let visible = typeof document === "undefined" ? true : !document.hidden;
  let onscreen = true;
  let cssWidth = host.clientWidth || 1;
  let cssHeight = host.clientHeight || 1;
  let rect = host.getBoundingClientRect();
  let near = 0;
  let grab = 0;
  let hovering = false;
  let painted = false;
  let resolution = 1;
  let frameAverage = 16.7;
  let slowFrames = 0;
  let disposed = false;

  function pxPerCss() {
    return H / Math.max(cssHeight, 1);
  }

  function scanMs() {
    const params = getProps().params;
    return clamp((params && params.scanSeconds) || 2.8, 1.6, 5) * 1000;
  }

  function motorSpeed() {
    return H / Math.max(scanMs() - CARRIAGE_EASE_MS, 200);
  }

  function colours(preset) {
    let entry = colourCache.get(preset.name);
    if (!entry) {
      entry = { paper: hexToRgb(preset.paper), ink: hexToRgb(preset.ink), inkB: hexToRgb(preset.inkB) };
      colourCache.set(preset.name, entry);
    }
    return entry;
  }

  function appearProgress() {
    return reducedMotion ? 1 : clamp(appearClock / APPEAR_MS, 0, 1);
  }

  function effectiveScale() {
    return pose.scale * (0.92 + 0.08 * easeOutBack(appearProgress()));
  }

  function setPhase(next) {
    phase = next;
    host.dataset.phase = next;
    const { onPhase } = getProps();
    if (onPhase) onPhase(next);
  }

  function fillFrame() {
    const { params, preset } = getProps();
    const palette = colours(preset);
    frame.sourceWidth = source ? source.width : 1;
    frame.sourceHeight = source ? source.height : 1;
    frame.baseWidth = source ? source.baseWidth : W;
    frame.baseHeight = source ? source.baseHeight : H;
    frame.poseX = pose.x;
    frame.poseY = pose.y;
    frame.poseAngle = pose.angle;
    frame.poseScale = effectiveScale();
    frame.printed = scan;
    frame.lamp = lamp;
    frame.lampGlow = lampGlow;
    frame.pxPerCss = pxPerCss();
    frame.appear = source ? smooth01(appearProgress() * 1.4) : 0;
    frame.grab = grab;
    frame.lid = source && source.kind === "copy" ? 0.6 : 1;
    frame.threshold = params.threshold;
    frame.contrast = params.contrast;
    frame.grain = params.grain;
    frame.streaks = params.streaks;
    frame.generation = source ? source.gen : 0;
    frame.preset = preset.index;
    frame.paper = palette.paper;
    frame.ink = palette.ink;
    frame.inkB = palette.inkB;
    return frame;
  }

  function placeHandle() {
    const y = lamp / pxPerCss();
    handle.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
  }

  function render() {
    if (!renderer || disposed) return;
    renderer.render(fillFrame());
    placeHandle();
    if (!painted && source) {
      painted = true;
      host.dataset.painted = "true";
    }
  }

  function schedule() {
    wanted = true;
    if (raf || disposed || !visible || !onscreen) return;
    if (!ticking) last = null;
    raf = requestAnimationFrame(tick);
  }

  function writeRows(fromScan, toScan, fromTime, toTime) {
    const firstRow = Math.floor(fromScan);
    const endRow = Math.min(Math.floor(toScan), H);
    if (endRow <= firstRow) return;
    const span = Math.max(toScan - fromScan, 1e-6);
    for (let row = firstRow; row < endRow; row += 1) {
      const f = clamp((row + 0.5 - fromScan) / span, 0, 1);
      trail.sample(fromTime + (toTime - fromTime) * f, sampled);
      const i = row * 4;
      ledger[i] = sampled[0];
      ledger[i + 1] = sampled[1];
      ledger[i + 2] = sampled[2];
      ledger[i + 3] = sampled[3];
    }
    renderer.writeRows(ledger, firstRow, endRow, fillFrame());
  }

  function stopSway() {
    if (sway.amp === 0 && sway.ampTarget === 0) return;
    sway.amp = 0;
    sway.ampTarget = 0;
    sway.offsetX = 0;
    sway.offsetA = 0;
  }

  function keepOnSheet() {
    if (pose.x < -W * 0.05 || pose.x > W * 1.05) {
      pose.x = clamp(pose.x, -W * 0.05, W * 1.05);
      velocity.x = 0;
    }
    if (pose.y < -H * 0.05 || pose.y > H * 1.05) {
      pose.y = clamp(pose.y, -H * 0.05, H * 1.05);
      velocity.y = 0;
    }
  }

  function swayStep(dt) {
    if (sway.ampTarget === 0 && sway.amp < 0.05) {
      if (sway.offsetX !== 0 || sway.offsetA !== 0) {
        pose.x -= sway.offsetX;
        pose.angle -= sway.offsetA;
        target.angle -= sway.offsetA;
        sway.offsetX = 0;
        sway.offsetA = 0;
      }
      sway.amp = 0;
      return false;
    }
    sway.clock += dt;
    sway.amp += (sway.ampTarget - sway.amp) * (1 - Math.exp(-dt / 260));
    const angle = (TAU * SWAY_HZ * sway.clock) / 1000;
    const offsetX = sway.amp * Math.sin(angle);
    const offsetA = (sway.amp / SWAY_ROWS) * SWAY_TURN * Math.sin(angle + 0.9);
    pose.x += offsetX - sway.offsetX;
    pose.angle += offsetA - sway.offsetA;
    target.angle += offsetA - sway.offsetA;
    sway.offsetX = offsetX;
    sway.offsetA = offsetA;
    return true;
  }

  function settleStep(dt) {
    if (!settle.active) return false;
    settle.clock += dt;
    const t = reducedMotion ? 1 : easeOutCubic(settle.clock / RECENTRE_MS);
    pose.x = settle.fromX + (W / 2 - settle.fromX) * t;
    pose.y = settle.fromY + (H / 2 - settle.fromY) * t;
    pose.angle = settle.fromA + (0 - settle.fromA) * t;
    pose.scale = settle.fromS + (1 - settle.fromS) * t;
    target.angle = pose.angle;
    target.scale = pose.scale;
    if (t >= 1) settle.active = false;
    return settle.active;
  }

  function tick(now) {
    raf = 0;
    ticking = true;
    if (disposed) return;
    const elapsed = last === null ? 0 : now - last;
    const dt = clamp(elapsed, 0, 48);
    if (elapsed > 0 && elapsed < 120) {
      frameAverage += (elapsed - frameAverage) * 0.08;
      slowFrames = frameAverage > 24 ? slowFrames + 1 : 0;
      if (slowFrames > 40 && resolution > 0.6) {
        resolution *= 0.8;
        slowFrames = 0;
        frameAverage = 16.7;
        resize();
      }
    }
    const fromTime = last === null ? now : last;
    last = now;
    let active = false;

    if (swayStep(dt)) active = true;
    if (settleStep(dt)) active = true;

    if (inertia && pointers.size === 0) {
      pose.x += velocity.x * dt;
      pose.y += velocity.y * dt;
      const decay = Math.exp(-dt / INERTIA_TAU_MS);
      velocity.x *= decay;
      velocity.y *= decay;
      keepOnSheet();
      if (Math.hypot(velocity.x, velocity.y) < 0.01) inertia = false;
      else active = true;
    }

    const angleGap = target.angle - pose.angle;
    const scaleGap = target.scale - pose.scale;
    if (Math.abs(angleGap) > 1e-4 || Math.abs(scaleGap) > 1e-4) {
      const k = 1 - Math.exp(-dt / 70);
      pose.angle += angleGap * k;
      pose.scale += scaleGap * k;
      active = true;
    } else {
      pose.angle = target.angle;
      pose.scale = target.scale;
    }

    if (appearClock < APPEAR_MS) {
      appearClock += dt;
      active = true;
    }

    trail.push(now, pose.x, pose.y, pose.angle, effectiveScale());

    let glowTarget = 0.34;
    if (phase === "pass") {
      const before = scan;
      passClock += dt;
      const speed = motorSpeed();
      if (carriage) {
        scan = Math.min(H, Math.max(scan, carriage.targetRow));
      } else {
        motorClock += dt;
        const startRamp = reducedMotion ? 1 : smooth01(passClock / CARRIAGE_EASE_MS);
        const motorRamp = smooth01(motorClock / MOTOR_RAMP_MS);
        const endRamp = reducedMotion ? 1 : Math.sqrt(clamp((H - scan) / ((speed * CARRIAGE_EASE_MS) / 2), 0, 1));
        const rate = speed * Math.max(Math.min(startRamp, motorRamp, endRamp), 0.03);
        scan = Math.min(H, scan + rate * dt);
      }
      if (scan > before) writeRows(before, scan, fromTime, now);
      lamp = scan;
      glowTarget = 1;
      sound.drive(dt > 0 ? clamp((scan - before) / dt / speed, 0, 1.6) / 1.6 + 0.35 : 0.35);
      if (scan >= H) finishPass();
      active = true;
    } else if (phase === "hold") {
      glowTarget = 0.5;
    } else if (phase === "return") {
      returnClock += dt;
      const duration = reducedMotion ? 200 : returnMs;
      const t = clamp(returnClock / duration, 0, 1);
      lamp = returnFrom * (1 - (reducedMotion ? t : easeInOutCubic(t)));
      glowTarget = 0.8;
      if (t >= 1) {
        lamp = 0;
        if (queued) {
          queued = false;
          phase = "idle";
          if (!startPass()) setPhase("idle");
        } else {
          setPhase("idle");
          sound.sleep();
        }
      }
      active = true;
    }

    if (phase === "pass") {
      frame.fresh = FRESH_ROWS;
    } else if (frame.fresh > 0.002) {
      frame.fresh = Math.max(0.001, frame.fresh * Math.exp(-dt / 60));
      active = true;
    }
    const grabTarget = pointers.size > 0 ? 1 : hovering && phase !== "hold" ? 0.42 : 0;
    const grabGap = grabTarget - grab;
    if (Math.abs(grabGap) > 0.004) {
      grab += grabGap * (1 - Math.exp(-dt / (grabTarget > grab ? 70 : 160)));
      active = true;
    } else {
      grab = grabTarget;
    }

    const glowGap = glowTarget - lampGlow;
    if (Math.abs(glowGap) > 0.004) {
      lampGlow += glowGap * (1 - Math.exp(-dt / 140));
      active = true;
    } else {
      lampGlow = glowTarget;
    }

    render();
    wanted = active || pointers.size > 0 || carriage !== null;
    if (wanted) schedule();
    ticking = raf !== 0;
  }

  function finishPass() {
    scan = H;
    lamp = H;
    if (sway.ampTarget > 0) sway.ampTarget = 0;
    sound.drive(0);
    sound.sleep();
    setPhase("hold");
  }

  function heldSheet() {
    if (phase !== "hold" || !renderer) return null;
    const sheet = renderer.bake(fillFrame());
    return sheet ? { sheet, gen: (source ? source.gen : 0) + 1 } : null;
  }

  function clearHold(quick) {
    scan = 0;
    renderer.resetRows();
    returnFrom = lamp;
    returnClock = 0;
    returnMs = quick ? QUICK_RETURN_MS : RETURN_MS;
    setPhase("return");
    schedule();
  }

  function eject(quick) {
    if (phase !== "hold") return;
    const held = heldSheet();
    const { onCopied } = getProps();
    if (held && onCopied) onCopied({ ...held, rect: host.getBoundingClientRect() });
    sound.thunk();
    clearHold(quick);
  }

  function takeHeld() {
    const held = heldSheet();
    if (held) heldTaken = true;
    return held;
  }

  function startPass() {
    if (!source || !renderer) return false;
    if (phase === "pass") return false;
    if (phase === "hold") {
      queued = true;
      eject(true);
      return true;
    }
    if (phase === "return") {
      queued = true;
      return true;
    }
    sound.rouse();
    scan = 0;
    lamp = 0;
    passClock = 0;
    motorClock = MOTOR_RAMP_MS;
    frame.fresh = FRESH_ROWS;
    frame.seed = Math.random() * 97;
    renderer.resetRows();
    setPhase("pass");
    schedule();
    return true;
  }

  function autoplay() {
    if (reducedMotion) {
      startPass();
      return;
    }
    const speed = motorSpeed();
    const rows = Math.floor(H * PREFILL);
    const baseX = pose.x;
    const baseA = pose.angle;
    const scale = effectiveScale();
    for (let row = 0; row < rows; row += 1) {
      const clock = (row + 0.5) / speed;
      const angle = (TAU * SWAY_HZ * clock) / 1000;
      const i = row * 4;
      ledger[i] = baseX + SWAY_ROWS * Math.sin(angle);
      ledger[i + 1] = pose.y;
      ledger[i + 2] = baseA + SWAY_TURN * Math.sin(angle + 0.9);
      ledger[i + 3] = scale;
    }
    frame.seed = Math.random() * 97;
    renderer.resetRows();
    renderer.writeRows(ledger, 0, rows, fillFrame());
    sway.clock = rows / speed;
    sway.amp = SWAY_ROWS;
    sway.ampTarget = SWAY_ROWS;
    const angle = (TAU * SWAY_HZ * sway.clock) / 1000;
    sway.offsetX = SWAY_ROWS * Math.sin(angle);
    sway.offsetA = SWAY_TURN * Math.sin(angle + 0.9);
    pose.x = baseX + sway.offsetX;
    pose.angle = baseA + sway.offsetA;
    target.angle = pose.angle;
    trail.clear();
    scan = rows;
    lamp = rows;
    lampGlow = 1;
    passClock = CARRIAGE_EASE_MS * 4;
    motorClock = MOTOR_RAMP_MS;
    frame.fresh = FRESH_ROWS;
    setPhase("pass");
    last = null;
    schedule();
  }

  async function loadSource(next) {
    if (!next || !renderer) return;
    const token = ++loadToken;
    let image = null;
    try {
      if (next.kind === "copy") {
        image = next.canvas;
      } else {
        const element = new Image();
        element.crossOrigin = "anonymous";
        element.decoding = "async";
        element.src = next.url;
        await element.decode();
        if (token !== loadToken || disposed) return;
        image = capToCanvas(element);
      }
    } catch {
      const { onError } = getProps();
      if (onError && token === loadToken) onError(next);
      return;
    }
    if (!image || disposed) return;
    if (phase === "hold") {
      if (next.fromHeld && heldTaken) clearHold(true);
      else eject(false);
    }
    heldTaken = false;
    if (phase === "pass") {
      carriage = null;
      scan = 0;
      renderer.resetRows();
      returnFrom = lamp;
      returnClock = 0;
      setPhase("return");
    }
    renderer.uploadSource(image, image.width, image.height);
    const [baseWidth, baseHeight] = baseSizeFor(image.width, image.height, next.kind);
    source = { id: next.id, gen: next.gen || 0, kind: next.kind, width: image.width, height: image.height, baseWidth, baseHeight };
    stopSway();
    settle.active = false;
    inertia = false;
    velocity.x = 0;
    velocity.y = 0;
    pose.x = W / 2;
    pose.y = H / 2;
    pose.angle = 0;
    pose.scale = 1;
    target.angle = 0;
    target.scale = 1;
    trail.clear();
    appearClock = next.landed ? APPEAR_MS : 0;
    const { onReady } = getProps();
    if (onReady) onReady(next);
    if (!autoplayed && next.autoplay) {
      autoplayed = true;
      appearClock = APPEAR_MS;
      autoplay();
      return;
    }
    autoplayed = true;
    if (next.autoStart) startPass();
    schedule();
  }

  function recentre() {
    stopSway();
    inertia = false;
    settle.active = true;
    settle.clock = 0;
    settle.fromX = pose.x;
    settle.fromY = pose.y;
    settle.fromA = pose.angle;
    settle.fromS = pose.scale;
    schedule();
  }

  function cancelMotion() {
    stopSway();
    settle.active = false;
    inertia = false;
    velocity.x = 0;
    velocity.y = 0;
  }

  function resetMoves() {
    moveHead = 0;
    moveCount = 0;
  }

  function recordMove(time, dx, dy) {
    const i = moveHead * 3;
    moves[i] = time;
    moves[i + 1] = dx;
    moves[i + 2] = dy;
    moveHead = (moveHead + 1) % MOVE_SLOTS;
    if (moveCount < MOVE_SLOTS) moveCount += 1;
  }

  function releaseVelocity(time) {
    let sumX = 0;
    let sumY = 0;
    let oldest = time;
    let newest = -Infinity;
    for (let k = 0; k < moveCount; k += 1) {
      const i = ((moveHead - 1 - k + MOVE_SLOTS) % MOVE_SLOTS) * 3;
      if (time - moves[i] > RELEASE_WINDOW_MS) break;
      sumX += moves[i + 1];
      sumY += moves[i + 2];
      oldest = Math.min(oldest, moves[i]);
      newest = Math.max(newest, moves[i]);
    }
    if (newest === -Infinity) return;
    const span = Math.max(16, newest - oldest);
    velocity.x = sumX / span;
    velocity.y = sumY / span;
    const threshold = 0.06 * pxPerCss();
    inertia = Math.hypot(velocity.x, velocity.y) > threshold;
  }

  function pairState() {
    const [a, b] = pointers.values();
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      distance: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
    };
  }

  function applyGesture(time) {
    const next = pairState();
    if (!gesture) {
      gesture = next;
      return;
    }
    const k = pxPerCss();
    let turn = next.angle - gesture.angle;
    if (turn > Math.PI) turn -= TAU;
    if (turn < -Math.PI) turn += TAU;
    const nextScale = clamp(pose.scale * (next.distance / gesture.distance), SCALE_MIN, SCALE_MAX);
    const ratio = nextScale / pose.scale;
    const pivotX = (gesture.cx - rect.left) * k;
    const pivotY = (gesture.cy - rect.top) * k;
    const dx = pose.x - pivotX;
    const dy = pose.y - pivotY;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    pose.x = pivotX + (c * dx - s * dy) * ratio + (next.cx - gesture.cx) * k;
    pose.y = pivotY + (s * dx + c * dy) * ratio + (next.cy - gesture.cy) * k;
    pose.angle += turn;
    pose.scale = nextScale;
    target.angle = pose.angle;
    target.scale = pose.scale;
    keepOnSheet();
    trail.push(time, pose.x, pose.y, pose.angle, effectiveScale());
    gesture = next;
  }

  function setNear(value) {
    if (value === near) return;
    if (Math.abs(value - near) < 0.02 && value !== 0 && value !== 1) return;
    near = value;
    host.style.setProperty("--copier-near", value.toFixed(3));
    host.dataset.near = value > 0.72 ? "true" : "false";
  }

  function insideOriginal(clientX, clientY) {
    if (!source) return false;
    const k = pxPerCss();
    const dx = (clientX - rect.left) * k - pose.x;
    const dy = (clientY - rect.top) * k - pose.y;
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    const scale = effectiveScale();
    const lx = (c * dx + s * dy) / scale;
    const ly = (-s * dx + c * dy) / scale;
    return Math.abs(lx) <= source.baseWidth / 2 && Math.abs(ly) <= source.baseHeight / 2;
  }

  function hover(event) {
    rect = host.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const lampCss = lamp / pxPerCss();
    const onHandle = handle.contains(event.target);
    const distance = onHandle ? 0 : Math.abs(y - lampCss);
    const carryable = phase === "idle" || phase === "pass";
    const nextNear = carryable ? clamp(1 - Math.max(distance - BAR_GRAB_CSS * 0.5, 0) / 72, 0, 1) : 0;
    setNear(nextNear);
    const nextHover = nextNear < 0.72 && insideOriginal(event.clientX, event.clientY);
    if (nextHover !== hovering) {
      hovering = nextHover;
      schedule();
    }
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    sound.wake();
    rect = host.getBoundingClientRect();
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      rect = host.getBoundingClientRect();
    }
    const y = event.clientY - rect.top;
    const lampCss = lamp / pxPerCss();
    const onHandle = handle.contains(event.target);
    const canCarry = phase === "idle" || phase === "pass";
    if (!carriage && canCarry && (onHandle || Math.abs(y - lampCss) <= BAR_GRAB_CSS)) {
      if (phase === "idle") startPass();
      carriage = { id: event.pointerId, offset: lampCss - y, targetRow: scan };
      host.dataset.carrying = "true";
      setNear(1);
      stopSway();
      schedule();
      return;
    }
    if (pointers.size === 0) {
      if (phase === "hold" || phase === "return") startPass();
      else if (phase === "idle" && insideOriginal(event.clientX, event.clientY)) startPass();
    }
    setNear(0);
    cancelMotion();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture = null;
    if (pointers.size >= 2) applyGesture(event.timeStamp);
    resetMoves();
    host.dataset.dragging = "true";
    schedule();
  }

  function onPointerMove(event) {
    const isCarriage = carriage !== null && carriage.id === event.pointerId;
    if (!isCarriage && !pointers.has(event.pointerId)) {
      if (event.buttons === 0) hover(event);
      return;
    }
    const list = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : null;
    const events = list && list.length ? list : [event];
    const k = pxPerCss();
    for (const item of events) {
      if (isCarriage) {
        carriage.targetRow = clamp((item.clientY - rect.top + carriage.offset) * k, 0, H);
        continue;
      }
      const point = pointers.get(event.pointerId);
      if (pointers.size === 1) {
        const dx = (item.clientX - point.x) * k;
        const dy = (item.clientY - point.y) * k;
        point.x = item.clientX;
        point.y = item.clientY;
        pose.x += dx;
        pose.y += dy;
        keepOnSheet();
        recordMove(item.timeStamp, dx, dy);
        trail.push(item.timeStamp, pose.x, pose.y, pose.angle, effectiveScale());
      } else {
        point.x = item.clientX;
        point.y = item.clientY;
        applyGesture(item.timeStamp);
      }
    }
    schedule();
  }

  function onPointerEnd(event) {
    if (carriage && carriage.id === event.pointerId) {
      carriage = null;
      motorClock = 0;
      delete host.dataset.carrying;
      hover(event);
      schedule();
      return;
    }
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    gesture = null;
    resetMoves();
    if (pointers.size >= 2) applyGesture(event.timeStamp);
    if (pointers.size === 0) {
      delete host.dataset.dragging;
      if (event.type === "pointerup") releaseVelocity(event.timeStamp);
    }
    schedule();
  }

  function onPointerEnter() {
    rect = host.getBoundingClientRect();
  }

  function onPointerLeave() {
    if (!carriage && pointers.size === 0) setNear(0);
    if (hovering) {
      hovering = false;
      schedule();
    }
  }

  function onWheel(event) {
    rect = host.getBoundingClientRect();
    const zooming = event.ctrlKey || event.metaKey;
    if (!zooming && (phase === "hold" || !insideOriginal(event.clientX, event.clientY))) return;
    event.preventDefault();
    cancelMotion();
    const unit = event.deltaMode === 1 ? 100 / 6 : event.deltaMode === 2 ? cssHeight : 1;
    const dy = event.deltaY * unit;
    const dx = event.deltaX * unit;
    if (zooming) {
      target.scale = clamp(target.scale * Math.exp(-dy * 0.01), SCALE_MIN, SCALE_MAX);
    } else {
      target.angle += (Math.abs(dy) >= Math.abs(dx) ? dy : dx) * 0.0022;
    }
    schedule();
  }

  function onKeyDown(event) {
    const k = pxPerCss();
    const push = (event.shiftKey ? 0.24 : 0.08) * k;
    let handled = true;
    if (event.key === "ArrowLeft") velocity.x -= push;
    else if (event.key === "ArrowRight") velocity.x += push;
    else if (event.key === "ArrowUp") velocity.y -= push;
    else if (event.key === "ArrowDown") velocity.y += push;
    else if (event.key === "[") target.angle -= Math.PI / 36;
    else if (event.key === "]") target.angle += Math.PI / 36;
    else if (event.key === "-" || event.key === "_") target.scale = clamp(target.scale / 1.08, SCALE_MIN, SCALE_MAX);
    else if (event.key === "=" || event.key === "+") target.scale = clamp(target.scale * 1.08, SCALE_MIN, SCALE_MAX);
    else if (event.key === "0") recentre();
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    stopSway();
    settle.active = event.key === "0" ? settle.active : false;
    if (event.key.startsWith("Arrow")) {
      velocity.x = clamp(velocity.x, -NUDGE_CAP * k, NUDGE_CAP * k);
      velocity.y = clamp(velocity.y, -NUDGE_CAP * k, NUDGE_CAP * k);
      inertia = true;
    }
    schedule();
  }

  function onDoubleClick() {
    recentre();
  }

  function resize() {
    cssWidth = host.clientWidth || 1;
    cssHeight = host.clientHeight || 1;
    rect = host.getBoundingClientRect();
    const cap = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640 ? 1.5 : 2;
    const dpr = Math.max(Math.min(window.devicePixelRatio || 1, cap) * resolution, 0.75);
    if (renderer) renderer.resize(Math.max(1, Math.round(cssWidth * dpr)), Math.max(1, Math.round(cssHeight * dpr)));
    render();
  }

  function resume() {
    if (!visible || !onscreen) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ticking = false;
      sound.drive(0);
      sound.sleep();
      return;
    }
    if (phase === "pass") sound.rouse();
    last = null;
    if (wanted) schedule();
  }

  function onVisibility() {
    visible = !document.hidden;
    resume();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    onscreen = entry.isIntersecting;
    resume();
  });
  intersection.observe(host);

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerEnd);
  host.addEventListener("pointercancel", onPointerEnd);
  host.addEventListener("lostpointercapture", onPointerEnd);
  host.addEventListener("pointerenter", onPointerEnter);
  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("dblclick", onDoubleClick);
  document.addEventListener("visibilitychange", onVisibility);
  if (renderer) {
    renderer.onRestored = () => {
      render();
    };
  }
  resize();

  return {
    kind: renderer ? renderer.kind : "none",
    loadSource,
    startPass,
    takeHeld,
    snapshot: heldSheet,
    recentre,
    wake() {
      sound.wake();
    },
    setSound(enabled) {
      sound.setEnabled(enabled);
    },
    requestRender() {
      if (!raf) render();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerEnd);
      host.removeEventListener("pointercancel", onPointerEnd);
      host.removeEventListener("lostpointercapture", onPointerEnd);
      host.removeEventListener("pointerenter", onPointerEnter);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("dblclick", onDoubleClick);
      document.removeEventListener("visibilitychange", onVisibility);
      if (renderer) renderer.dispose();
      renderer = null;
      sound.dispose();
      canvas.remove();
      delete host.dataset.painted;
    },
  };
}
