import { createTapeAudio } from "./tapeAudio";
import { CLIP_OFFSET_SECONDS, LOOP_SECONDS } from "./tapeConstants";
import { loadTape } from "./tapeLoader";
import { TAPE_PX_PER_SECOND, createTapeMachine } from "./tapeMachine";
import { MACHINE } from "./tapeMachineArt";
import { createTapePlate } from "./tapePlate";
import { TapeTransport } from "./tapeTransport";

const HEAD_FRACTION = 0.38;
const WARP_RADIUS = 110;
const WARP_AMOUNT = 0.3;
const BEND_PX = 10;
const STRAIN_TAU = 0.11;
const HELD_STRAIN_TAU = 0.04;
const WEAR_RATE = 5;
const REVEAL_MS = 900;
const SPIN_DELAY_MS = 160;
const AXIS_SLOP = 8;
const LINE_PX = 100 / 6;
const NOTCH_TAU = 0.24;
const SEEK_JUMP = 5;
const MAX_SCALE = 2;
const MIN_QUALITY = 0.6;
const COMPACT_WIDTH = 640;
const HEAD_OVERHANG = 12;
const NEAR_RADIUS = 96;
const HOLD_GRAB_MS = 160;
const SLOW_RATIO = 1.5;
const FLOOR_CREEP = 0.03;
const SMEAR_GAIN = 2;
const SMEAR_REST = 1.1;
const SMEAR_CAP = 48;
const STEP_LIMIT = 0.25;
const REEL_DEAD_ZONE = 14;
const DECK_PEEK = 128;
const SHORT_STRIP_DECK_PEEK = 80;
const DECK_OVERHANG = 24;
const SHORT_STRIP_DECK_OVERHANG = 16;
const HEAD_CLEARANCE = 64;
const START_LEAD = 0.08;

const wrap = (value, period) => ((value % period) + period) % period;
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

function formatTime(seconds) {
  const tenths = Math.floor(seconds * 10 + 1e-6);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

function formatRate(speed) {
  return Math.min(9.95, Math.round(speed * 20) / 20).toFixed(2);
}

function inkedStart(print, period) {
  if (!print?.data || !print.columns) return 0;
  const { data, width: bandWidth, bins, columns } = print;
  const perSecond = columns / period;
  const energy = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    const band = Math.floor(c / bandWidth);
    const x = c - band * bandWidth;
    let sum = 0;
    for (let b = 0; b < bins; b += 2) sum += data[(band * bins + b) * bandWidth + x];
    energy[c] = sum;
  }
  const span = Math.max(1, Math.round(perSecond * 0.25));
  const smooth = new Float32Array(columns);
  let running = 0;
  for (let c = 0; c < columns; c++) {
    running += energy[c];
    if (c >= span) running -= energy[c - span];
    smooth[c] = running / Math.min(c + 1, span);
  }
  const sorted = Float32Array.from(smooth).sort();
  const threshold = sorted[Math.floor(sorted.length * 0.6)];
  for (let c = span; c < columns; c++) {
    if (smooth[c] >= threshold) return wrap((c - span) / perSecond - START_LEAD, period);
  }
  return 0;
}

export function mountTape(parts, onChange) {
  const { deck, strip, plateHost, headSvg, headPath, timeSlot, rateSlot, sign, cast, machine } = parts;
  const transport = new TapeTransport();
  const machineArt = createTapeMachine(machine);
  const grips = Array.from(machine.querySelectorAll("[data-grip]"));
  const audio = createTapeAudio(() => syncAudible());
  const canvas = document.createElement("canvas");
  canvas.className = "tape__plate";
  plateHost.appendChild(canvas);
  let plate = null;
  try {
    plate = createTapePlate(canvas, () => measure());
  } catch {
    plate = null;
  }
  if (!plate) canvas.remove();

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motionQuery.matches;
  let destroyed = false;
  let period = LOOP_SECONDS;
  let width = 0;
  let height = 0;
  let headX = 0;
  let pxps = 160;
  let quality = 1;
  let slowFrames = 0;
  let floorInterval = 0;
  let frameInterval = 1 / 60;
  let revealStart = -1;
  let reveal = 0;
  let spinAt = -1;
  let intent = false;
  let audible = false;
  let audioStatus = "loading";
  let strain = 0;
  let wear = 0;
  let smear = 0;
  let machineScale = 1;
  let drawn = false;
  let shownT = 0;
  let shownWarp = 0;
  let bendShown = NaN;
  let pathHeight = 0;
  let words = [];
  let singersKey = "";
  let timeText = "0:00.0";
  let rateText = "0.00";
  let signOn = false;
  let direction = "up";
  let ariaSecond = -1;
  let onscreen = true;
  let frame = 0;
  let last = 0;
  let ticking = false;
  let stripLeft = 0;
  let near = 0;

  const emit = (patch) => {
    if (!destroyed) onChange(patch);
  };

  const castNodes = Array.from(cast.querySelectorAll("[data-cast]"));

  const measure = () => {
    width = strip.clientWidth;
    height = strip.clientHeight;
    stripLeft = strip.getBoundingClientRect().left;
    const compact = width < COMPACT_WIDTH;
    pxps = compact ? 120 : 160;
    transport.pixelsPerSecond = pxps;
    const shortStrip = height < MACHINE.height;
    const peek = shortStrip ? SHORT_STRIP_DECK_PEEK : DECK_PEEK;
    const overhang = shortStrip ? SHORT_STRIP_DECK_OVERHANG : DECK_OVERHANG;
    machineScale = Math.max(0.3, (height + overhang * 2) / MACHINE.height);
    headX = Math.round(Math.max(width * HEAD_FRACTION, peek + HEAD_CLEARANCE) * 2) / 2;
    deck.style.setProperty("--tape-machine-scale", String(Math.round(machineScale * 10000) / 10000));
    deck.style.setProperty("--tape-machine-left", `${Math.round((peek - MACHINE.width * machineScale) * 10) / 10}px`);
    deck.style.setProperty("--tape-head-x", `${headX}px`);
    const scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE) * quality;
    plate?.resize(width, height, scale, { headX, pxPerSecond: pxps, warpRadius: WARP_RADIUS, period });
    if (drawn) {
      plate?.draw(shownT, shownWarp, reveal, wear, smear);
      drawHead();
    }
    wake();
  };

  const drawHead = () => {
    const bend = reduced ? 0 : Math.round(-BEND_PX * clamp(strain, 1) * 10) / 10;
    const total = height + HEAD_OVERHANG * 2;
    if (bend === bendShown && total === pathHeight) return;
    bendShown = bend;
    if (total !== pathHeight) {
      pathHeight = total;
      headSvg.setAttribute("height", String(total));
      headSvg.setAttribute("viewBox", `0 0 40 ${total}`);
    }
    const middle = HEAD_OVERHANG + height / 2;
    headPath.setAttribute("d", `M20 4 Q${20 + bend * 2} ${middle} 20 ${total - 4}`);
  };

  const showReadouts = (t) => {
    const nextTime = formatTime(t);
    if (nextTime !== timeText) {
      timeText = nextTime;
      timeSlot.current?.setValue(nextTime);
    }
    const v = transport.velocity;
    const nextRate = formatRate(Math.abs(v));
    if (nextRate !== rateText) {
      rateText = nextRate;
      rateSlot.current?.setValue(nextRate);
    }
    const negative = v < -0.025;
    if (negative !== signOn) {
      signOn = negative;
      sign.toggleAttribute("data-on", negative);
    }
    const nextDirection = v < -0.02 ? "down" : v > 0.02 ? "up" : direction;
    if (nextDirection !== direction) {
      direction = nextDirection;
      emit({ direction });
    }
    const second = Math.floor(t);
    if (second !== ariaSecond) {
      ariaSecond = second;
      strip.setAttribute("aria-valuenow", String(second));
      strip.setAttribute("aria-valuetext", `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`);
    }
  };

  const markSingers = (t) => {
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const source = found >= 0 ? words[found] : words[words.length - 1];
    const singers = source ? source.singers : "john";
    if (singers !== singersKey) {
      singersKey = singers;
      const present = singers.split(" ");
      for (const node of castNodes) node.toggleAttribute("data-on", present.includes(node.dataset.cast));
    }
  };

  const govern = (interval) => {
    if (interval <= 0 || interval > 0.25) return;
    frameInterval += (Math.min(interval, 1 / 30) - frameInterval) * 0.2;
    floorInterval = floorInterval ? Math.min(interval, floorInterval + (interval - floorInterval) * FLOOR_CREEP) : interval;
    slowFrames = interval > floorInterval * SLOW_RATIO ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality * 0.8);
      slowFrames = 0;
      measure();
    }
  };

  const tick = (now) => {
    frame = 0;
    ticking = true;
    const interval = last ? (now - last) / 1000 : 0;
    const dt = Math.min(1 / 30, interval);
    const travelDt = Math.min(STEP_LIMIT, interval);
    last = now;
    govern(interval);

    if (pendingTouch && now - downAt >= HOLD_GRAB_MS) engage(downX, now / 1000);
    if (reelGrab && !reelGrab.claimed && now - reelGrab.downAt >= HOLD_GRAB_MS) claimReel(now / 1000);

    if (spinAt >= 0 && now >= spinAt) {
      spinAt = -1;
      if (!intent) {
        transport.playing = true;
        transport.shuttle = 1;
        if (reduced) transport.velocity = 1;
        emit({ playing: true, shuttle: 1 });
      }
    }

    transport.step(travelDt, now / 1000);
    if (revealStart >= 0) {
      const progress = reduced ? 1 : Math.min(1, (now - revealStart) / REVEAL_MS);
      reveal = 1 - (1 - progress) ** 3;
    }
    const wearGoal = transport.worn ? 1 : 0;
    wear += (wearGoal - wear) * (1 - Math.exp(-WEAR_RATE * dt));
    if (Math.abs(wearGoal - wear) < 1e-3) wear = wearGoal;

    const reference = transport.held || transport.seeking ? transport.motor : transport.target;
    const strainGoal = reduced ? 0 : clamp(transport.velocity - reference, 4);
    const strainTau = transport.held ? HELD_STRAIN_TAU : STRAIN_TAU;
    strain += (strainGoal - strain) * (1 - Math.exp(-dt / strainTau));
    if (Math.abs(strainGoal - strain) < 1e-4) strain = strainGoal;
    const pull = WARP_AMOUNT * Math.tanh(strain * 0.9);
    const warp = pull / (1 + pull);

    const velocity = transport.velocity;
    const excess = Math.max(0, Math.abs(velocity) - SMEAR_REST);
    smear = reduced ? 0 : Math.min(SMEAR_CAP, excess * frameInterval * pxps * SMEAR_GAIN);

    shownT = wrap(transport.position, period);
    shownWarp = warp;
    drawn = true;
    plate?.draw(shownT, warp, reveal, wear, smear);
    drawHead();
    showReadouts(shownT);
    markSingers(shownT);
    const machineBusy = machineArt.update(transport.position, strain, dt);
    if (audible) {
      audio.steer(
        wrap(transport.voicePosition, period),
        transport.voiceVelocity,
        transport.voiceTime * 1000,
        transport.mode,
        transport.worn,
        transport.voiceReach,
      );
    }

    const busy =
      !transport.settled ||
      transport.held ||
      pendingTouch ||
      (reelGrab !== null && !reelGrab.claimed) ||
      machineBusy ||
      smear > 0 ||
      spinAt >= 0 ||
      (revealStart >= 0 && reveal < 1) ||
      strain !== strainGoal ||
      Math.abs(strain) > 1e-3 ||
      wear !== wearGoal;
    ticking = false;
    if (busy && !document.hidden && !destroyed) {
      frame = requestAnimationFrame(tick);
    } else if (transport.away) {
      audio.suspend();
    }
  };

  function wake() {
    if (destroyed || frame || ticking || document.hidden) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  const beginReveal = () => {
    strip.setAttribute("data-inked", "");
    revealStart = performance.now();
    spinAt = revealStart + (reduced ? 0 : SPIN_DELAY_MS);
    wake();
  };

  function syncAudible() {
    if (destroyed) return;
    const running = audio.running;
    if (running === audible) return;
    audible = running;
    emit({ audible: running });
    wake();
  }

  const enableAudio = () => {
    if (audioStatus === "none") return false;
    if (!audio.ensure()) {
      audioStatus = "none";
      emit({ audio: "none" });
      return false;
    }
    syncAudible();
    return true;
  };

  const setPlaying = (playing, shuttle) => {
    intent = true;
    spinAt = -1;
    transport.playing = playing;
    transport.shuttle = shuttle;
    emit({ playing, shuttle });
    wake();
  };

  const togglePlay = () => {
    const wasAudible = audible;
    const unmuted = enableAudio();
    if (!wasAudible && unmuted && transport.playing) {
      intent = true;
      wake();
      return;
    }
    if (transport.playing) setPlaying(false, transport.shuttle);
    else setPlaying(true, 1);
  };

  const shuttleTo = (value) => {
    enableAudio();
    setPlaying(true, value);
  };

  const shuttleStep = (directionSign) => {
    const current = transport.playing ? transport.shuttle : 0;
    const next =
      current * directionSign >= 2 ? directionSign * Math.min(8, Math.abs(current) * 2) : directionSign * 2;
    shuttleTo(next);
  };

  const seekBase = () => (transport.seeking ? transport.seekTarget : transport.position);

  const seekBy = (seconds) => {
    if (transport.held) return;
    transport.seek(seekBase() + seconds);
    wake();
  };

  let pointerId = null;
  let reelGrab = null;
  let touch = false;
  let pendingTouch = false;
  let axis = 0;
  let downX = 0;
  let downY = 0;
  let downAt = 0;

  function engage(x, time) {
    pendingTouch = false;
    transport.grab(x, time);
    strip.setAttribute("data-held", "");
  }

  const finish = (event, tapAllowed) => {
    if (pointerId === null) return;
    pendingTouch = false;
    transport.release(event.timeStamp / 1000);
    if (!touch && strip.hasPointerCapture(pointerId)) strip.releasePointerCapture(pointerId);
    pointerId = null;
    strip.removeAttribute("data-held");
    if (tapAllowed) enableAudio();
    wake();
  };

  const onDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (pointerId !== null || reelGrab) return;
    enableAudio();
    pointerId = event.pointerId;
    touch = event.pointerType === "touch";
    axis = touch ? 0 : 1;
    downX = event.clientX;
    downY = event.clientY;
    downAt = performance.now();
    if (touch) {
      pendingTouch = true;
    } else {
      engage(event.clientX, event.timeStamp / 1000);
      strip.setPointerCapture(pointerId);
    }
    wake();
  };

  const sense = (clientX) => {
    const distance = Math.abs(clientX - stripLeft - headX);
    const next = Math.round(Math.max(0, 1 - distance / NEAR_RADIUS) * 100) / 100;
    if (next === near) return;
    near = next;
    headSvg.style.setProperty("--tape-near", String(next));
  };

  const onLeave = () => sense(Infinity);

  const onMove = (event) => {
    if (pointerId === null && event.pointerType === "mouse") sense(event.clientX);
    if (event.pointerId !== pointerId) return;
    if (axis === 0) {
      const tx = event.clientX - downX;
      const ty = event.clientY - downY;
      if (tx * tx + ty * ty < AXIS_SLOP * AXIS_SLOP) return;
      axis = Math.abs(tx) > Math.abs(ty) ? 1 : -1;
      if (axis === -1) {
        finish(event, false);
        return;
      }
      if (!transport.held) engage(downX, event.timeStamp / 1000);
    }
    const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    if (samples.length) for (const sample of samples) transport.drag(sample.clientX, sample.timeStamp / 1000);
    else transport.drag(event.clientX, event.timeStamp / 1000);
    wake();
  };

  const reelAngle = (grab, x, y) => Math.atan2(y - grab.cy, x - grab.cx);

  const turnReel = (x, y, time) => {
    const distance = Math.hypot(x - reelGrab.cx, y - reelGrab.cy);
    const angle = reelAngle(reelGrab, x, y);
    let turn = angle - reelGrab.angle;
    if (turn > Math.PI) turn -= Math.PI * 2;
    else if (turn < -Math.PI) turn += Math.PI * 2;
    reelGrab.angle = angle;
    if (distance < REEL_DEAD_ZONE * machineScale) return;
    reelGrab.turned += (turn * machineArt.radiusOf(reelGrab.name)) / TAPE_PX_PER_SECOND;
    transport.drag(-reelGrab.turned * pxps, time);
  };

  const claimReel = (time) => {
    reelGrab.claimed = true;
    reelGrab.angle = reelAngle(reelGrab, reelGrab.lastX, reelGrab.lastY);
    if (!reelGrab.touch) reelGrab.grip.setPointerCapture(reelGrab.pointerId);
    transport.grab(0, time);
    strip.setAttribute("data-held", "");
    machine.setAttribute("data-held", reelGrab.name);
  };

  const onReelDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (pointerId !== null || reelGrab) return;
    const touching = event.pointerType === "touch";
    if (!touching) event.preventDefault();
    enableAudio();
    const grip = event.currentTarget;
    const rect = grip.getBoundingClientRect();
    reelGrab = {
      pointerId: event.pointerId,
      grip,
      name: grip.dataset.grip,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      angle: 0,
      turned: 0,
      touch: touching,
      claimed: false,
      downX: event.clientX,
      downY: event.clientY,
      downAt: performance.now(),
      lastX: event.clientX,
      lastY: event.clientY,
    };
    if (!touching) claimReel(event.timeStamp / 1000);
    wake();
  };

  const onReelMove = (event) => {
    if (!reelGrab || event.pointerId !== reelGrab.pointerId) return;
    if (!reelGrab.claimed) {
      const tx = event.clientX - reelGrab.downX;
      const ty = event.clientY - reelGrab.downY;
      if (tx * tx + ty * ty < AXIS_SLOP * AXIS_SLOP) {
        reelGrab.lastX = event.clientX;
        reelGrab.lastY = event.clientY;
        return;
      }
      if (Math.abs(ty) >= Math.abs(tx)) {
        reelGrab = null;
        return;
      }
      claimReel(event.timeStamp / 1000);
    }
    const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    if (samples.length) for (const sample of samples) turnReel(sample.clientX, sample.clientY, sample.timeStamp / 1000);
    else turnReel(event.clientX, event.clientY, event.timeStamp / 1000);
    reelGrab.lastX = event.clientX;
    reelGrab.lastY = event.clientY;
    wake();
  };

  const onReelEnd = (event) => {
    if (!reelGrab || event.pointerId !== reelGrab.pointerId) return;
    const { grip, claimed } = reelGrab;
    reelGrab = null;
    if (!claimed) return;
    transport.release(event.timeStamp / 1000);
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    strip.removeAttribute("data-held");
    machine.removeAttribute("data-held");
    wake();
  };

  const onReelTouchMove = (event) => {
    if (reelGrab?.claimed && event.cancelable) event.preventDefault();
  };

  const onUp = (event) => {
    if (event.pointerId === pointerId) finish(event, true);
  };

  const onCancel = (event) => {
    if (event.pointerId === pointerId) finish(event, false);
  };

  const onWheel = (event) => {
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const raw = horizontal ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!raw) return;
    event.preventDefault();
    if (pointerId !== null || reelGrab) return;
    const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? width : 1;
    const distance = raw * unit;
    const notched = event.deltaMode !== 0 || (Number.isInteger(raw) && Math.abs(raw) >= 50);
    if (notched) transport.impulse(distance / pxps / NOTCH_TAU);
    else transport.wheel(distance, event.timeStamp / 1000);
    wake();
  };

  const onKey = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const onControl = Boolean(target?.closest("button, a, [role='switch']"));
    switch (event.code) {
      case "Space":
        if (onControl) return;
        event.preventDefault();
        if (!event.repeat) togglePlay();
        return;
      case "KeyK":
        event.preventDefault();
        enableAudio();
        setPlaying(false, transport.shuttle);
        return;
      case "KeyL":
        event.preventDefault();
        if (!event.repeat) shuttleStep(1);
        return;
      case "KeyJ":
        event.preventDefault();
        if (!event.repeat) shuttleStep(-1);
        return;
      case "ArrowLeft":
      case "ArrowRight":
        event.preventDefault();
        enableAudio();
        seekBy(event.code === "ArrowLeft" ? -SEEK_JUMP : SEEK_JUMP);
        return;
      default:
        return;
    }
  };

  const applyPresence = () => {
    if (document.hidden) {
      transport.away = true;
      transport.velocity = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      audio.suspend();
      return;
    }
    transport.away = !onscreen;
    if (onscreen) audio.resume();
    wake();
  };

  const onMotion = () => {
    reduced = motionQuery.matches;
    wake();
  };

  const intersection = new IntersectionObserver((entries) => {
    onscreen = entries[entries.length - 1].isIntersecting;
    applyPresence();
  });
  intersection.observe(deck);
  const resize = new ResizeObserver(measure);
  resize.observe(strip);
  strip.addEventListener("pointerdown", onDown);
  strip.addEventListener("pointermove", onMove);
  strip.addEventListener("pointerup", onUp);
  strip.addEventListener("pointercancel", onCancel);
  strip.addEventListener("pointerleave", onLeave);
  strip.addEventListener("lostpointercapture", onCancel);
  strip.addEventListener("wheel", onWheel, { passive: false });
  for (const grip of grips) {
    grip.addEventListener("pointerdown", onReelDown);
    grip.addEventListener("pointermove", onReelMove);
    grip.addEventListener("pointerup", onReelEnd);
    grip.addEventListener("pointercancel", onReelEnd);
    grip.addEventListener("lostpointercapture", onReelEnd);
    grip.addEventListener("touchmove", onReelTouchMove, { passive: false });
  }
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", applyPresence);
  motionQuery.addEventListener("change", onMotion);

  const loader = loadTape();
  loader.promise
    .then((result) => {
      if (destroyed) return;
      period = result.period;
      transport.position = inkedStart(result.print, period);
      shownT = transport.position;
      plate?.setPrint(result.print);
      audio.load(result.levels, result.sampleRate);
      audioStatus = "ready";
      emit({ audio: "ready", offset: result.offset });
      measure();
      beginReveal();
    })
    .catch(() => {
      if (destroyed) return;
      audioStatus = "none";
      emit({ audio: "none", offset: CLIP_OFFSET_SECONDS });
      strip.setAttribute("data-bare", "");
      measure();
      beginReveal();
    });

  measure();

  return {
    togglePlay,
    shuttleTo,
    setWorn(on) {
      transport.worn = on;
      emit({ worn: on });
      wake();
    },
    setWords(list) {
      words = list.map((word) => ({ start: word.start, singers: word.singers || "john" }));
      singersKey = "";
      wake();
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      loader.cancel();
      intersection.disconnect();
      resize.disconnect();
      strip.removeEventListener("pointerdown", onDown);
      strip.removeEventListener("pointermove", onMove);
      strip.removeEventListener("pointerup", onUp);
      strip.removeEventListener("pointercancel", onCancel);
      strip.removeEventListener("pointerleave", onLeave);
      strip.removeEventListener("lostpointercapture", onCancel);
      strip.removeEventListener("wheel", onWheel);
      for (const grip of grips) {
        grip.removeEventListener("pointerdown", onReelDown);
        grip.removeEventListener("pointermove", onReelMove);
        grip.removeEventListener("pointerup", onReelEnd);
        grip.removeEventListener("pointercancel", onReelEnd);
        grip.removeEventListener("lostpointercapture", onReelEnd);
        grip.removeEventListener("touchmove", onReelTouchMove);
      }
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", applyPresence);
      motionQuery.removeEventListener("change", onMotion);
      audio.destroy();
      plate?.destroy();
      canvas.remove();
    },
  };
}
