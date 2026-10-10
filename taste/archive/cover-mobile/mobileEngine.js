import { FOLD_ANGLE, buildMobile, mulberry32, pivotsFor, poseStructure } from "./mobileLayout";
import { createMobileSim } from "./mobileSim";
import { MAX_COUNT, isLocalScan } from "./mobileParams";

const ENTRANCE_MS = 1100;
const ENTRANCE_FOLD = 0.66;
const FLIGHT_MS = 720;
const REDUCED_FLIGHT_MS = 280;
const FLIGHT_STAGGER_MS = 120;
const LAND_KICK = 150;
const TAP_SLOP = 6;
const TAP_MS = 420;
const RELEASE_WINDOW_MS = 80;
const NUDGE = 300;
const GUST = 1200;
const ATTENTION_MS = 30000;
const DRAUGHT_MIN_MS = 8000;
const DRAUGHT_SPREAD_MS = 3000;
const DRAUGHT_GUST = 600;
const DRAUGHT_GUST_SPREAD = 120;
const DRAUGHT_TWIST = 0.2;
const HELD_LAYER = 50;
const PRESS_LIFT = 0.04;
const PRESS_KICK = 0.2;
const REMOUNT_GUST = 520;
const AMBIENT_TIME = 1.5;
const SLEEP_ENERGY = 0.5;
const SLEEP_HOLD = 1.5;
const YAW_SLEEP = 3e-3;
const POP_OMEGA = (Math.PI * 2) / 0.42;
const POP_STIFFNESS = POP_OMEGA * POP_OMEGA;
const POP_DAMPING = 2 * 0.82 * POP_OMEGA;
const POP_KICK = 2.15;
const CORNER = 5.2;
const DPR_CAP = 2;
const THREAD_WIDTH = 1;
const ARM_WIDTH = 2.5;
const PIVOT_KNOT = 3;
const END_KNOT = 1.75;
const HOOK_KNOT = 2.5;
const HUM_GAIN = 32;
const HUM_MAX = 5;
const HUM_ALPHA = 0.3;
const HUM_FALLOFF = 0.64;
const HUM_FLOOR = 0.25;
const HUM_PULSE = 0.6;
const HUM_PULSE_TIME = 0.18;
const BEAT_SLOW_TIME = 0.6;
const BEAT_ONSET = 0.02;
const BEAT_RELATIVE = 0.15;
const BEAT_REARM = 0.008;
const BEAT_GAP = 0.2;
const BEAT_LIFT = 900;
const BEAT_LIFT_CAP = 160;
const BEAT_TWIST = 5;
const BEAT_TWIST_CAP = 0.5;
const WIND_WAKE_SPEED = 80;

const ENTRANCE_CURVE = (() => {
  const samples = new Float64Array(65);
  const bezier = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  for (let index = 0; index <= 64; index += 1) {
    const target = index / 64;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 28; iteration += 1) {
      const middle = (low + high) / 2;
      if (bezier(middle, 0.16, 0.3) < target) low = middle;
      else high = middle;
    }
    samples[index] = bezier((low + high) / 2, 1, 1);
  }
  return samples;
})();

function easeEntrance(progress) {
  const position = Math.min(1, Math.max(0, progress)) * 64;
  const index = Math.floor(position);
  if (index >= 64) return 1;
  const fraction = position - index;
  return ENTRANCE_CURVE[index] + (ENTRANCE_CURVE[index + 1] - ENTRANCE_CURVE[index]) * fraction;
}

function easeFlight(progress) {
  return progress < 0.5 ? 4 * progress * progress * progress : 1 - (-2 * progress + 2) ** 3 / 2;
}

function wrapAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function insetsFor(width, height) {
  if (height < 500) return { top: 64, bottom: 72, side: 16 };
  return width < 640 ? { top: 96, bottom: 172, side: 16 } : { top: 104, bottom: 116, side: 32 };
}

export function mountMobile({
  stage,
  canvas,
  covers,
  count,
  seed,
  slotsRef,
  coverRefs,
  configRef,
  playerRef,
  entrance = true,
  onEntered,
}) {
  const context = canvas.getContext("2d");
  const total = Math.min(MAX_COUNT, covers.length);
  const effectiveCount = Math.max(2, Math.min(count, total));
  const slots = slotsRef.current.filter((index) => index < total).slice(0, effectiveCount);
  for (let index = 0; slots.length < effectiveCount && index < total; index += 1) {
    if (!slots.includes(index)) slots.push(index);
  }
  slotsRef.current = slots;

  const random = mulberry32(seed * 7919 + 13);
  const draughtRandom = mulberry32(seed * 104729 + 71);
  const pose = { x: 0, y: 0, angle: 0, yaw: 0, vx: 0, vy: 0 };
  const target = { x: 0, y: 0, angle: 0, yaw: 0, vx: 0, vy: 0 };
  const ends = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  const shape = new Float64Array(10);
  const pops = new Float64Array(total);
  const popVelocity = new Float64Array(total);
  const popTarget = new Float64Array(total);
  const sides = new Int8Array(total).fill(-1);
  const layers = new Int16Array(total).fill(-1);
  const flying = new Int8Array(total);
  const labels = new Array(total).fill("");
  let threadHops = new Int8Array(0);
  const state = {
    sim: null,
    mobile: null,
    width: 0,
    height: 0,
    dpr: 1,
    frame: 0,
    last: 0,
    visible: true,
    entrance: null,
    flights: [],
    maxSize: 1,
    ambient: configRef.current.reducedMotion ? 0 : 1,
    pendingEntrance: entrance,
    attentionAt: performance.now(),
    quietFor: 0,
    ink: "#1a1a1a",
    gustDirection: 1,
    draughtDirection: draughtRandom() < 0.5 ? -1 : 1,
    pendingAdvance: false,
    slowLevel: 0,
    beatArmed: true,
    beatAt: 0,
    beatSign: 1,
    humPulse: 0,
    humSlot: -1,
  };
  const pointer = {
    id: null,
    mode: null,
    slot: -1,
    coverIndex: -1,
    downX: 0,
    downY: 0,
    downAt: 0,
    moved: 0,
    lastX: 0,
    lastY: 0,
    lastAt: 0,
    vx: 0,
    vy: 0,
  };

  const elementFor = (coverIndex) => coverRefs.current[coverIndex] ?? null;
  const shelf = stage.querySelector(".cm-stage__covers");

  const orderTabs = () => {
    if (!shelf) return;
    const active = document.activeElement;
    let expected = shelf.firstElementChild;
    let inOrder = true;
    const sequence = slots.slice();
    for (let coverIndex = 0; coverIndex < total; coverIndex += 1) if (!slots.includes(coverIndex)) sequence.push(coverIndex);
    for (const coverIndex of sequence) {
      const element = elementFor(coverIndex);
      if (!element) continue;
      if (element !== expected) inOrder = false;
      expected = element.nextElementSibling;
    }
    if (inOrder) return;
    const canMove = typeof shelf.moveBefore === "function";
    for (const coverIndex of sequence) {
      const element = elementFor(coverIndex);
      if (!element || element.parentNode !== shelf) continue;
      try {
        if (canMove) shelf.moveBefore(element, null);
        else shelf.appendChild(element);
      } catch {
        shelf.appendChild(element);
      }
    }
    if (active && shelf.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
  };

  const markEntered = () => {
    state.pendingEntrance = false;
    onEntered?.();
  };

  const labelFor = (coverIndex, slot) => {
    const cover = covers[coverIndex];
    const audible = !configRef.current.embedded && !isLocalScan(cover);
    if (slot === 0) {
      if (!audible) return `${cover.title} by ${cover.artist}`;
      const player = playerRef?.current;
      const playing = Boolean(player?.isPlaying()) && player.currentId() === cover.id;
      return `${playing ? "Pause" : "Play"} ${cover.title} by ${cover.artist}`;
    }
    return audible ? `Hang ${cover.title} on top and play it` : `Hang ${cover.title} on top`;
  };

  const applyLabel = (coverIndex, slot) => {
    const element = elementFor(coverIndex);
    if (!element) return;
    const label = labelFor(coverIndex, slot);
    if (labels[coverIndex] === label) return;
    labels[coverIndex] = label;
    element.setAttribute("aria-label", label);
  };

  const syncLabels = () => {
    for (let slot = 0; slot < slots.length; slot += 1) applyLabel(slots[slot], slot);
  };

  const setSlotLook = (coverIndex, slot) => {
    const element = elementFor(coverIndex);
    if (!element || !state.mobile) return;
    const inverse = state.maxSize / state.mobile.covers[slot].size;
    element.style.setProperty("--cm-inverse", inverse.toFixed(4));
    element.style.setProperty("--cm-corner", `${CORNER}px`);
    applyLabel(coverIndex, slot);
  };

  const playingSlot = () => {
    const player = playerRef?.current;
    if (!player?.isPlaying()) return -1;
    const id = player.currentId();
    for (let slot = 0; slot < slots.length; slot += 1) {
      const coverIndex = slots[slot];
      if (!flying[coverIndex] && covers[coverIndex].id === id) return slot;
    }
    return -1;
  };

  const resizeCanvas = () => {
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    state.dpr = dpr;
    const width = Math.max(1, Math.round(state.width * dpr));
    const height = Math.max(1, Math.round(state.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };

  const build = (withEntrance) => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    state.width = width;
    state.height = height;
    resizeCanvas();
    if (width < 120 || height < 120) {
      state.sim = null;
      return;
    }
    state.ink = getComputedStyle(stage).color || state.ink;
    const ids = slots.map((coverIndex) => covers[coverIndex].id);
    const mobile = buildMobile({ count: slots.length, seed, width, height, ids, insets: insetsFor(width, height) });
    const sim = createMobileSim(mobile, random);
    threadHops = new Int8Array(sim.threadCount);
    state.humSlot = -1;
    state.mobile = mobile;
    state.sim = sim;
    state.maxSize = mobile.covers[0].size;
    state.flights.length = 0;
    flying.fill(0);
    layers.fill(-1);
    for (let coverIndex = 0; coverIndex < total; coverIndex += 1) {
      const element = elementFor(coverIndex);
      if (!element) continue;
      const hung = slots.includes(coverIndex);
      element.style.width = `${state.maxSize}px`;
      element.style.height = `${state.maxSize}px`;
      element.dataset.hung = hung ? "true" : "false";
      element.tabIndex = hung ? 0 : -1;
      element.setAttribute("aria-hidden", hung ? "false" : "true");
    }
    slots.forEach((coverIndex, slot) => setSlotLook(coverIndex, slot));
    orderTabs();
    if (withEntrance && !configRef.current.reducedMotion) {
      const folded = poseStructure(
        mobile.structure,
        mobile.pivots,
        mobile.arms.map((arm) => arm.direction * FOLD_ANGLE * ENTRANCE_FOLD),
        { x: mobile.anchor.x, y: mobile.arms[0].thread },
      );
      let lowest = 0;
      folded.covers.forEach((cover, slot) => {
        lowest = Math.max(lowest, cover.y + mobile.covers[slot].size * 0.5);
      });
      const drop = Math.min(height * 0.62, lowest * 0.7);
      state.entrance = { start: performance.now(), drop, folded };
      sim.anchor.y = -drop;
      sim.setPose(folded, -drop);
    } else {
      state.entrance = null;
      sim.setPose(mobile.rest);
      if (state.pendingEntrance) markEntered();
      else if (!configRef.current.reducedMotion) {
        state.gustDirection *= -1;
        sim.blow(state.gustDirection, REMOUNT_GUST);
      }
    }
  };

  const placeCover = (coverIndex, x, y, angle, yaw, size, layer) => {
    const element = elementFor(coverIndex);
    if (!element) return;
    const scale = (size / state.maxSize) * (1 + pops[coverIndex]);
    const facing = Math.cos(yaw);
    const side = facing < 0 ? 1 : 0;
    if (side !== sides[coverIndex]) {
      sides[coverIndex] = side;
      element.dataset.side = side ? "back" : "front";
    }
    if (layer !== layers[coverIndex]) {
      layers[coverIndex] = layer;
      element.style.zIndex = String(layer);
    }
    const half = state.maxSize * 0.5;
    const scaleX = Math.max(0.015, Math.abs(facing)) * scale;
    element.style.transform = `translate3d(${(x - half).toFixed(2)}px, ${(y - half).toFixed(2)}px, 0) rotate(${angle.toFixed(4)}rad) scale(${scaleX.toFixed(4)}, ${scale.toFixed(4)})`;
  };

  const retargetPivots = () => {
    const { sim, mobile } = state;
    if (!sim) return;
    const pivots = pivotsFor(
      mobile,
      slots.map((coverIndex) => covers[coverIndex].id),
    );
    pivots.forEach((along, armIndex) => sim.setPivotTarget(armIndex, along));
  };

  const stepFlights = (now, dt) => {
    const { sim, mobile } = state;
    for (let index = state.flights.length - 1; index >= 0; index -= 1) {
      const flight = state.flights[index];
      const fromSize = mobile.covers[flight.from].size;
      const toSize = mobile.covers[flight.to].size;
      if (now < flight.start) {
        sim.coverPose(flight.from, pose);
        placeCover(flight.coverIndex, pose.x, pose.y, pose.angle, pose.yaw, fromSize, 40 + flight.from);
        continue;
      }
      if (!flight.origin) {
        sim.coverPose(flight.from, pose);
        flight.origin = { x: pose.x, y: pose.y, angle: pose.angle, yaw: pose.yaw };
        flight.x = pose.x;
        flight.y = pose.y;
        sim.setHookEmpty(flight.from, true);
      }
      const progress = Math.min(1, (now - flight.start) / flight.duration);
      const eased = easeFlight(progress);
      const arc = Math.sin(Math.PI * progress) * flight.lift;
      sim.coverPose(flight.to, target);
      const origin = flight.origin;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const distance = Math.hypot(dx, dy) || 1;
      const bow = flight.bow * distance * 0.16 * arc;
      const x = origin.x + dx * eased + (-dy / distance) * bow;
      const y = origin.y + dy * eased + (dx / distance) * bow - arc * (24 + distance * 0.12);
      const angle = origin.angle + wrapAngle(target.angle - origin.angle) * eased;
      const yaw = origin.yaw + (target.yaw - origin.yaw) * eased;
      const size = (fromSize + (toSize - fromSize) * eased) * (1 + 0.07 * arc);
      if (dt > 0) {
        flight.vx = (x - flight.x) / dt;
        flight.vy = (y - flight.y) / dt;
      }
      flight.x = x;
      flight.y = y;
      placeCover(flight.coverIndex, x, y, angle, yaw, size, 60 + index);
      if (progress >= 1) {
        sim.setHookEmpty(flight.to, false);
        sim.kick(flight.to, (flight.vx || 0) * 0.3, Math.max(0, (flight.vy || 0) * 0.3) + LAND_KICK, 0);
        popVelocity[flight.coverIndex] += POP_KICK * 0.6;
        flying[flight.coverIndex] = 0;
        setSlotLook(flight.coverIndex, flight.to);
        state.flights.splice(index, 1);
        if (!state.flights.length) {
          retargetPivots();
          orderTabs();
        }
      }
    }
  };

  const stepPops = (dt) => {
    let moving = false;
    const half = dt / 2;
    for (let coverIndex = 0; coverIndex < total; coverIndex += 1) {
      const rest = popTarget[coverIndex];
      if (pops[coverIndex] === rest && popVelocity[coverIndex] === 0) continue;
      for (let pass = 0; pass < 2; pass += 1) {
        popVelocity[coverIndex] += (-POP_STIFFNESS * (pops[coverIndex] - rest) - POP_DAMPING * popVelocity[coverIndex]) * half;
        pops[coverIndex] += popVelocity[coverIndex] * half;
      }
      if (Math.abs(pops[coverIndex] - rest) < 1e-4 && Math.abs(popVelocity[coverIndex]) < 1e-3) {
        pops[coverIndex] = rest;
        popVelocity[coverIndex] = 0;
      } else {
        moving = true;
      }
    }
    return moving;
  };

  const traceHum = (thread, amplitude) => {
    state.sim.threadEnds(thread, ends.a, ends.b);
    const dx = ends.b.x - ends.a.x;
    const dy = ends.b.y - ends.a.y;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = (-dy / distance) * amplitude * 2;
    const ny = (dx / distance) * amplitude * 2;
    const middleX = (ends.a.x + ends.b.x) / 2;
    const middleY = (ends.a.y + ends.b.y) / 2;
    context.moveTo(ends.a.x, ends.a.y);
    context.quadraticCurveTo(middleX + nx, middleY + ny, ends.b.x, ends.b.y);
    context.quadraticCurveTo(middleX - nx, middleY - ny, ends.a.x, ends.a.y);
  };

  const drawWires = (now, level) => {
    const { sim, mobile } = state;
    const dpr = state.dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, state.width, state.height);
    context.strokeStyle = state.ink;
    context.fillStyle = state.ink;
    context.lineCap = "round";
    context.lineJoin = "round";

    const humSlot = level > 0.004 && !state.flights.length ? playingSlot() : -1;
    if (humSlot >= 0 && humSlot !== state.humSlot) {
      sim.threadHopsFrom(humSlot, threadHops);
      state.humSlot = humSlot;
    }
    context.lineWidth = THREAD_WIDTH;
    context.beginPath();
    for (let thread = 0; thread < sim.threadCount; thread += 1) {
      sim.threadEnds(thread, ends.a, ends.b);
      const ax = ends.a.x;
      const ay = ends.a.y;
      const bx = ends.b.x;
      const by = ends.b.y;
      const dx = bx - ax;
      const dy = by - ay;
      const distance = Math.hypot(dx, dy);
      const slack = sim.threadLength[thread] - distance;
      context.moveTo(ax, ay);
      if (slack > 0.75 && distance > 1) {
        const sag = Math.min(distance * 0.45, Math.sqrt((3 * distance * slack) / 8));
        let nx = -dy / distance;
        let ny = dx / distance;
        if (ny < 0 || (Math.abs(ny) < 0.05 && nx < 0)) {
          nx = -nx;
          ny = -ny;
        }
        context.quadraticCurveTo((ax + bx) / 2 + nx * sag * 2, (ay + by) / 2 + ny * sag * 2, bx, by);
      } else {
        context.lineTo(bx, by);
      }
    }
    context.stroke();

    if (humSlot >= 0) {
      const strength = Math.min(HUM_MAX, level * HUM_GAIN) * (1 + HUM_PULSE * state.humPulse);
      context.globalAlpha = HUM_ALPHA;
      context.beginPath();
      for (let thread = 0; thread < sim.threadCount; thread += 1) {
        const amplitude = strength * HUM_FALLOFF ** threadHops[thread] * (0.82 + 0.18 * Math.sin(now * 0.031 + thread * 1.9));
        if (amplitude >= HUM_FLOOR) traceHum(thread, amplitude);
      }
      context.fill();
      context.globalAlpha = 1;
    }

    context.lineWidth = ARM_WIDTH;
    context.beginPath();
    for (let armIndex = 0; armIndex < sim.armCount; armIndex += 1) {
      sim.armShape(armIndex, shape);
      context.moveTo(shape[0], shape[1]);
      context.quadraticCurveTo(shape[2], shape[3], shape[4], shape[5]);
      context.quadraticCurveTo(shape[6], shape[7], shape[8], shape[9]);
    }
    context.stroke();

    context.beginPath();
    for (let armIndex = 0; armIndex < sim.armCount; armIndex += 1) {
      sim.armShape(armIndex, shape);
      context.moveTo(shape[4] + PIVOT_KNOT, shape[5]);
      context.arc(shape[4], shape[5], PIVOT_KNOT, 0, Math.PI * 2);
      context.moveTo(shape[0] + END_KNOT, shape[1]);
      context.arc(shape[0], shape[1], END_KNOT, 0, Math.PI * 2);
      context.moveTo(shape[8] + END_KNOT, shape[9]);
      context.arc(shape[8], shape[9], END_KNOT, 0, Math.PI * 2);
    }
    for (let index = 0; index < state.flights.length; index += 1) {
      const hook = state.flights[index].to;
      sim.coverPose(hook, pose);
      const half = mobile.covers[hook].size * 0.5;
      const tieX = pose.x + half * Math.sin(pose.angle);
      const tieY = pose.y - half * Math.cos(pose.angle);
      context.moveTo(tieX + HOOK_KNOT, tieY);
      context.arc(tieX, tieY, HOOK_KNOT, 0, Math.PI * 2);
    }
    context.fill();
  };

  const render = (now, dt, level) => {
    const { sim, mobile } = state;
    const held = pointer.mode === "grab" ? pointer.coverIndex : -1;
    for (let slot = 0; slot < slots.length; slot += 1) {
      const coverIndex = slots[slot];
      if (flying[coverIndex]) continue;
      sim.coverPose(slot, pose);
      placeCover(coverIndex, pose.x, pose.y, pose.angle, pose.yaw, mobile.covers[slot].size, coverIndex === held ? HELD_LAYER : 1 + slot);
    }
    stepFlights(now, dt);
    drawWires(now, level);
  };

  const schedule = () => {
    if (state.frame || !state.visible || document.hidden || !state.sim) return;
    state.frame = requestAnimationFrame(frame);
  };

  const wake = () => {
    state.quietFor = 0;
    if (!state.frame) {
      state.last = 0;
      schedule();
    }
  };

  const touch = () => {
    state.attentionAt = performance.now();
    wake();
  };

  const listen = (now, dt, level, playing, reduced) => {
    const { sim } = state;
    state.slowLevel += (level - state.slowLevel) * (1 - Math.exp(-dt / BEAT_SLOW_TIME));
    state.humPulse *= Math.exp(-dt / HUM_PULSE_TIME);
    if (state.humPulse < 1e-3) state.humPulse = 0;
    const onset = level - state.slowLevel;
    if (onset < BEAT_REARM) state.beatArmed = true;
    const threshold = Math.max(BEAT_ONSET, state.slowLevel * BEAT_RELATIVE);
    if (!playing || !state.beatArmed || onset <= threshold || now - state.beatAt < BEAT_GAP * 1000) return;
    if (state.entrance || state.flights.length) return;
    const slot = playingSlot();
    if (slot < 0) return;
    state.beatArmed = false;
    state.beatAt = now;
    state.humPulse = 1;
    if (reduced || sim.grab.body === sim.armCount + slot) return;
    sim.kick(slot, 0, Math.min(BEAT_LIFT_CAP, onset * BEAT_LIFT), 0);
    sim.twist(slot, state.beatSign * Math.min(BEAT_TWIST_CAP, onset * BEAT_TWIST));
    state.beatSign = -state.beatSign;
  };

  function frame(now) {
    state.frame = 0;
    const { sim } = state;
    if (!sim) return;
    const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
    state.last = now;
    const config = configRef.current;
    const player = playerRef?.current;
    const playing = Boolean(player?.isPlaying());
    const attending = playing || now - state.attentionAt < ATTENTION_MS;
    const ambientTarget = !config.reducedMotion && attending ? 1 : 0;
    state.ambient += (ambientTarget - state.ambient) * (1 - Math.exp(-dt / AMBIENT_TIME));
    if (state.ambient < 0.002 && ambientTarget === 0) state.ambient = 0;

    if (state.entrance) {
      const progress = (now - state.entrance.start) / ENTRANCE_MS;
      const offset = -state.entrance.drop * (1 - easeEntrance(progress));
      sim.anchor.y = offset;
      sim.setPose(state.entrance.folded, offset);
      if (progress >= 1) {
        sim.anchor.y = 0;
        state.entrance = null;
        markEntered();
      }
    } else {
      sim.step(dt, config.physics, { ambient: state.ambient, reduced: config.reducedMotion });
    }
    const popping = stepPops(dt);
    const level = player ? player.level() : 0;
    listen(now, dt, level, playing, config.reducedMotion);
    render(now, dt, level);
    if (state.pendingAdvance && !state.entrance && !state.flights.length && pointer.mode !== "grab") {
      state.pendingAdvance = false;
      if (!player?.isActive()) promoteNext();
    }

    const busy =
      state.entrance ||
      state.flights.length ||
      sim.grab.body >= 0 ||
      popping ||
      state.ambient > 0.002 ||
      level > 0.002 ||
      state.humPulse > 0;
    if (!busy && sim.energy() < SLEEP_ENERGY && sim.yawEnergy() < YAW_SLEEP) state.quietFor += dt;
    else state.quietFor = 0;
    if (state.quietFor > SLEEP_HOLD) return;
    schedule();
  }

  const settleFlights = () => {
    if (!state.flights.length || !state.sim) return;
    for (const flight of state.flights) {
      state.sim.setHookEmpty(flight.from, false);
      state.sim.setHookEmpty(flight.to, false);
      flying[flight.coverIndex] = 0;
      setSlotLook(flight.coverIndex, flight.to);
    }
    state.flights.length = 0;
    retargetPivots();
    orderTabs();
  };

  const finishEntrance = () => {
    if (!state.entrance || !state.sim) return;
    state.sim.anchor.y = 0;
    state.sim.setPose(state.mobile.rest);
    state.entrance = null;
    markEntered();
  };

  const followHeld = () => {
    if (pointer.mode !== "grab" || pointer.slot < 0) return;
    const coverIndex = slots[pointer.slot];
    if (coverIndex === pointer.coverIndex) return;
    elementFor(pointer.coverIndex)?.removeAttribute("data-held");
    popTarget[pointer.coverIndex] = 0;
    pointer.coverIndex = coverIndex;
    popTarget[coverIndex] = PRESS_LIFT;
    elementFor(coverIndex)?.setAttribute("data-held", "true");
  };

  const promote = (slot) => {
    const { sim } = state;
    if (!sim || slot <= 0 || slot >= slots.length) return false;
    if (document.hidden) {
      finishEntrance();
      settleFlights();
    }
    if (state.entrance || state.flights.length) return false;
    state.pendingAdvance = false;
    const now = performance.now();
    const rising = slots[slot];
    const falling = slots[0];
    if (document.hidden) {
      slots[0] = rising;
      slots[slot] = falling;
      setSlotLook(rising, 0);
      setSlotLook(falling, slot);
      followHeld();
      retargetPivots();
      orderTabs();
      syncLabels();
      configRef.current.onPromote?.(covers[rising], rising);
      return true;
    }
    const bow = random() < 0.5 ? 1 : -1;
    const reduced = configRef.current.reducedMotion;
    const duration = reduced ? REDUCED_FLIGHT_MS : FLIGHT_MS;
    const lift = reduced ? 0 : 1;
    const flight = { origin: null, bow, duration, lift, x: 0, y: 0, vx: 0, vy: 0 };
    state.flights.push({ ...flight, coverIndex: rising, from: slot, to: 0, start: now });
    state.flights.push({ ...flight, coverIndex: falling, from: 0, to: slot, start: now + (reduced ? 0 : FLIGHT_STAGGER_MS) });
    flying[rising] = 1;
    flying[falling] = 1;
    slots[0] = rising;
    slots[slot] = falling;
    followHeld();
    sim.setHookEmpty(slot, true);
    syncLabels();
    configRef.current.onPromote?.(covers[rising], rising);
    touch();
    return true;
  };

  const promoteNext = () => {
    if (pointer.mode === "grab" || (!document.hidden && (state.entrance || state.flights.length))) {
      state.pendingAdvance = true;
      wake();
      return false;
    }
    const current = slots[0];
    for (let step = 1; step < total; step += 1) {
      const slot = slots.indexOf((current + step) % total);
      if (slot > 0) return promote(slot);
    }
    return false;
  };

  const tap = (slot) => {
    if (slot < 0 || slot >= slots.length) return;
    const coverIndex = slots[slot];
    if (flying[coverIndex]) return;
    popVelocity[coverIndex] += POP_KICK;
    if (slot === 0) configRef.current.onTopTap?.(covers[coverIndex], coverIndex);
    else promote(slot);
    touch();
  };

  const gust = (direction, strength) => {
    state.sim?.blow(direction, strength);
    touch();
  };

  const localPoint = (event) => {
    const rect = stage.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const coverFrom = (eventTarget) => {
    const element = eventTarget?.closest?.(".cm-cover");
    if (!element || !stage.contains(element)) return { coverIndex: -1, slot: -1 };
    const coverIndex = Number(element.dataset.index);
    return { coverIndex, slot: slots.indexOf(coverIndex) };
  };

  const trackVelocity = (event, x, y) => {
    const elapsed = Math.max(4, event.timeStamp - pointer.lastAt);
    if (pointer.lastAt && elapsed < 120) {
      const instantX = ((x - pointer.lastX) / elapsed) * 1000;
      const instantY = ((y - pointer.lastY) / elapsed) * 1000;
      pointer.vx += (instantX - pointer.vx) * 0.55;
      pointer.vy += (instantY - pointer.vy) * 0.55;
    } else {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.lastX = x;
    pointer.lastY = y;
    pointer.lastAt = event.timeStamp;
  };

  const onPointerDown = (event) => {
    if (event.button > 0 || !state.sim || pointer.id !== null) return;
    const [x, y] = localPoint(event);
    pointer.lastAt = 0;
    trackVelocity(event, x, y);
    const { coverIndex, slot } = coverFrom(event.target);
    pointer.id = event.pointerId;
    pointer.downX = x;
    pointer.downY = y;
    pointer.downAt = event.timeStamp;
    pointer.moved = 0;
    if (slot >= 0 && !flying[coverIndex] && !state.entrance) {
      pointer.mode = "grab";
      pointer.slot = slot;
      pointer.coverIndex = coverIndex;
      state.sim.startGrab(slot, x, y);
      popTarget[coverIndex] = PRESS_LIFT;
      popVelocity[coverIndex] += POP_KICK * PRESS_KICK;
      stage.dataset.grabbing = "true";
      elementFor(coverIndex)?.setAttribute("data-held", "true");
    } else {
      pointer.mode = slot >= 0 ? "tap" : "wind";
      pointer.slot = slot;
      pointer.coverIndex = coverIndex;
    }
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      pointer.id = event.pointerId;
    }
    touch();
  };

  const onPointerMove = (event) => {
    if (!state.sim) return;
    const own = pointer.id === event.pointerId;
    if (pointer.id !== null && !own) return;
    const [x, y] = localPoint(event);
    trackVelocity(event, x, y);
    if (own && pointer.mode === "grab") {
      pointer.moved = Math.max(pointer.moved, Math.hypot(x - pointer.downX, y - pointer.downY));
      state.sim.moveGrab(Math.min(state.width + 40, Math.max(-40, x)), Math.min(state.height + 40, Math.max(-40, y)));
      wake();
      return;
    }
    if (own) pointer.moved = Math.max(pointer.moved, Math.hypot(x - pointer.downX, y - pointer.downY));
    if (event.pointerType === "mouse" || own) {
      state.sim.feedWind(x, y, pointer.vx, pointer.vy);
      if (Math.hypot(pointer.vx, pointer.vy) > WIND_WAKE_SPEED) touch();
    }
  };

  const finishPointer = (event, cancelled) => {
    if (pointer.id === null || event.pointerId !== pointer.id) return;
    const quick = event.timeStamp - pointer.downAt < TAP_MS && pointer.moved < TAP_SLOP;
    if (pointer.mode === "grab") {
      const fresh = event.timeStamp - pointer.lastAt < RELEASE_WINDOW_MS;
      state.sim?.endGrab(cancelled || !fresh ? 0 : pointer.vx);
      if (pointer.coverIndex >= 0) popTarget[pointer.coverIndex] = 0;
      elementFor(pointer.coverIndex)?.removeAttribute("data-held");
    }
    delete stage.dataset.grabbing;
    const slot = pointer.coverIndex >= 0 ? slots.indexOf(pointer.coverIndex) : -1;
    const wasCover = pointer.mode === "grab" || pointer.mode === "tap";
    pointer.id = null;
    pointer.mode = null;
    try {
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    } catch {
      pointer.lastAt = 0;
    }
    if (!cancelled && wasCover && quick) tap(slot);
    touch();
  };

  const onPointerUp = (event) => finishPointer(event, false);
  const onPointerCancel = (event) => finishPointer(event, true);

  const onKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const { slot } = coverFrom(event.target);
    if (event.key === " ") {
      event.preventDefault();
      gust(1, GUST);
      return;
    }
    if (slot < 0) return;
    const nudges = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] };
    const push = nudges[event.key];
    if (!push) return;
    event.preventDefault();
    state.sim?.nudge(slot, push[0], push[1]);
    touch();
  };

  const onKeyUp = (event) => {
    if (event.key === " ") event.preventDefault();
  };

  const onClick = (event) => {
    if (event.detail !== 0) return;
    const { slot } = coverFrom(event.target);
    if (slot >= 0) tap(slot);
  };

  const onFocus = () => touch();

  build(state.pendingEntrance);
  if (state.sim) render(performance.now(), 0, 0);
  configRef.current.onControllerReady?.({
    promoteNext,
    syncLabels,
    wake: touch,
    gust: (direction = 1) => gust(direction, GUST),
    topCover: () => covers[slots[0]],
  });

  const resizeObserver = new ResizeObserver(() => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!state.sim || Math.abs(width - state.width) > 1 || Math.abs(height - state.height) > 120) {
      build(state.pendingEntrance);
      if (state.sim) render(performance.now(), 0, 0);
    } else {
      state.height = height;
      resizeCanvas();
    }
    wake();
  });
  resizeObserver.observe(stage);

  const intersection = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting;
    if (state.visible) wake();
    else if (state.frame) {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    }
  });
  intersection.observe(stage);

  const onVisibility = () => {
    if (document.hidden) {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    } else {
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  let draughtTimer = 0;
  const queueDraught = () => {
    draughtTimer = window.setTimeout(runDraught, DRAUGHT_MIN_MS + draughtRandom() * DRAUGHT_SPREAD_MS);
  };
  function runDraught() {
    queueDraught();
    const { sim } = state;
    if (!sim || configRef.current.reducedMotion || !state.visible || document.hidden) return;
    if (state.entrance || state.flights.length || pointer.id !== null) return;
    if (playerRef?.current?.isActive() || performance.now() - state.attentionAt < ATTENTION_MS) return;
    state.draughtDirection = -state.draughtDirection;
    sim.blow(state.draughtDirection, DRAUGHT_GUST + draughtRandom() * DRAUGHT_GUST_SPREAD);
    const turns = 2 + Math.floor(draughtRandom() * 2);
    for (let turn = 0; turn < turns; turn += 1) {
      const slot = Math.floor(draughtRandom() * sim.coverCount);
      sim.twist(slot, (draughtRandom() < 0.5 ? -1 : 1) * DRAUGHT_TWIST);
    }
    wake();
  }
  queueDraught();

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerCancel);
  stage.addEventListener("lostpointercapture", onPointerCancel);
  stage.addEventListener("keydown", onKeyDown);
  stage.addEventListener("keyup", onKeyUp);
  stage.addEventListener("click", onClick);
  stage.addEventListener("focusin", onFocus);
  wake();

  const destroy = () => {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.sim = null;
    window.clearTimeout(draughtTimer);
    resizeObserver.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    stage.removeEventListener("pointerdown", onPointerDown);
    stage.removeEventListener("pointermove", onPointerMove);
    stage.removeEventListener("pointerup", onPointerUp);
    stage.removeEventListener("pointercancel", onPointerCancel);
    stage.removeEventListener("lostpointercapture", onPointerCancel);
    stage.removeEventListener("keydown", onKeyDown);
    stage.removeEventListener("keyup", onKeyUp);
    stage.removeEventListener("click", onClick);
    stage.removeEventListener("focusin", onFocus);
    configRef.current.onControllerReady?.(null);
  };

  return { destroy };
}
