import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { MAX_MAGNETS, filingCount, hexToRgb } from "./filingsParams";
import { createCanvasRenderer, createGlRenderer } from "./filingsRenderer";
import { FilingsSim, gridColumns } from "./filingsSim";

const REGULAR_MAGNET = { width: 72, height: 28 };
const COMPACT_MAGNET = { width: 88, height: 34 };
const SPRING_DURATION = 0.38;
const SPRING_BOUNCE = 0.18;
const ROTATE_STEP = Math.PI / 12;
const MOVE_STEP = 8;
const MOVE_STEP_LARGE = 32;
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 28;
const SHAKE_WINDOW_MS = 450;
const SHAKE_REVERSALS = 3;
const SHAKE_STROKE_PX = 24;
const SHAKE_STRAIGHTNESS = 0.75;
const SHAKE_COOLDOWN_MS = 600;
const REMOVE_MS = 260;
const IDLE_OMEGA = 0.02;
const IDLE_OMEGA_QUIET = 0.35;
const QUIET_AFTER_S = 3.5;
const IDLE_CREEP_PX = 0.01;
const PRESENCE_RATE = 9;
const PAPER_RATE = 7;
const LAYOUT_SEED = 1931;
const WHEEL_NOTCH = 50;
const GRAIN = 0.035;
const LANE_REACH_PX = 60;
const PARTNER_AT_MS = 1800;
const PARTNER_FLIP_AT_MS = 3400;
const PARTNER_SPACING = 0.22;
const PARTNER_MIN_GAP_PX = 56;
const PARTNER_MARGIN = 0.07;
const RELAYOUT_DEBOUNCE_MS = 220;
const MAGNET_CAPACITY = MAX_MAGNETS * 3;

export const DEFAULT_MAGNETS = [{ id: 1, x: 0.71, y: 0.73, angle: -0.42 }];

export function magnetTransform(x, y, angle, size) {
  return `translate3d(${(x * size).toFixed(2)}px, ${(y * size).toFixed(2)}px, 0) translate(-50%, -50%) rotate(${angle.toFixed(4)}rad)`;
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function typingInto(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function createFilingsEngine({ plate, host, magnetEls, embedded, callbacks, initial }) {
  const compactQuery = window.matchMedia("(max-width: 899px), (pointer: coarse)");
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let compact = compactQuery.matches;
  let reduced = reducedQuery.matches;

  let canvas = document.createElement("canvas");
  canvas.className = "filings-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  let renderer = null;
  try {
    renderer = createGlRenderer(canvas);
  } catch {
    renderer = null;
  }
  if (!renderer) {
    const replacement = document.createElement("canvas");
    replacement.className = canvas.className;
    replacement.setAttribute("aria-hidden", "true");
    canvas.replaceWith(replacement);
    canvas = replacement;
    renderer = createCanvasRenderer(canvas);
  }

  const sim = new FilingsSim();
  const governor = createResolutionGovernor({ max: 1, min: 0.6 });
  const startedAt = performance.now();
  const clock = (now) => (now - startedAt) / 1000;

  let size = 0;
  let pixelRatio = 1;
  let raf = 0;
  let last = 0;
  let wokenAt = 0;
  let alive = true;
  let lost = false;
  let visible = !document.hidden;
  let onscreen = true;
  let spawned = false;
  let sample = initial.sample ?? null;
  let params = initial.params;
  let look = null;
  let lookSource = initial.look ?? null;
  const paperShown = [0.961, 0.949, 0.918];
  const paperTarget = [0.961, 0.949, 0.918];
  let nextId = 1;
  let wheelAccumulated = 0;
  let lastTap = null;
  let twist = null;
  let shakeCooldownUntil = 0;
  let touched = false;
  let openingTimers = [];
  let relayoutTimer = 0;
  let painted = false;
  let ghostShown = false;
  let hoverRect = null;
  const pointers = new Map();

  const ghost = document.createElement("div");
  ghost.className = "filings-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const ghostPole = document.createElement("span");
  ghostPole.className = "filings-ghost__pole";
  ghost.appendChild(ghostPole);
  host.appendChild(ghost);

  const field = {
    poleCount: 0,
    poleX: new Float32Array(MAGNET_CAPACITY * 2),
    poleY: new Float32Array(MAGNET_CAPACITY * 2),
    poleQ: new Float32Array(MAGNET_CAPACITY * 2),
    centreCount: 0,
    centreX: new Float32Array(MAGNET_CAPACITY),
    centreY: new Float32Array(MAGNET_CAPACITY),
    nearSq: 0,
    coreSq: 0,
    bRefSq: 1,
    damping: 9,
    creep: 0,
    pullRadius: 0,
    pullStrength: 0,
    laneStep: 1,
    laneCap: 0,
    capNear: 0,
    capFar: 0,
    reduced: false,
  };

  const makeMagnet = ({ x, y, angle }, born, settled = false) => {
    const id = nextId;
    nextId += 1;
    return {
      id,
      x,
      y,
      angle,
      target: angle,
      velocity: 0,
      presence: reduced || settled ? 1 : 0,
      held: false,
      leaving: false,
      removing: false,
      twisting: false,
      snapshot: { id, born, transform: "" },
    };
  };

  let magnets = DEFAULT_MAGNETS.map((magnet) => makeMagnet(magnet, true, true));

  const magnetSize = () => (compact ? COMPACT_MAGNET : REGULAR_MAGNET);
  const elementFor = (magnet) => magnetEls.get(magnet.id);

  const liveMagnets = () => magnets.filter((magnet) => !magnet.removing);

  const updateAddable = () => {
    if (!embedded && liveMagnets().length < MAX_MAGNETS) plate.dataset.addable = "true";
    else delete plate.dataset.addable;
  };

  const publishMagnets = () => {
    updateAddable();
    for (const magnet of magnets) {
      if (!magnet.snapshot.transform && size > 0) {
        magnet.snapshot = { ...magnet.snapshot, transform: magnetTransform(magnet.x, magnet.y, magnet.angle, size) };
      }
    }
    callbacks.current.onMagnets?.(magnets.map((magnet) => magnet.snapshot));
  };

  const writeMagnet = (magnet) => {
    const element = elementFor(magnet);
    if (!element || size <= 0) return;
    element.style.transform = magnetTransform(magnet.x, magnet.y, magnet.angle, size);
  };

  const setFlag = (magnet, name, on) => {
    const element = elementFor(magnet);
    if (!element) return;
    if (on) element.dataset[name] = "true";
    else delete element.dataset[name];
  };

  const lookFrom = (next) => ({
    name: next.name,
    tint: next.tint,
    invert: next.invert,
    inkRgb: hexToRgb(next.ink),
    paperRgb: hexToRgb(next.paper),
  });

  if (initial.look) {
    look = lookFrom(initial.look);
    paperShown.splice(0, 3, ...look.paperRgb);
    paperTarget.splice(0, 3, ...look.paperRgb);
  }

  const origins = () => {
    const list = magnets.filter((magnet) => !magnet.removing).map((magnet) => [magnet.x, magnet.y]);
    return list.length ? list : [[0.5, 0.5]];
  };

  const countFor = () => {
    const base = filingCount(size, params.density, compact);
    return renderer.kind === "canvas" ? Math.round(base / 2) : base;
  };

  const now = () => clock(performance.now());

  const spawn = () => {
    if (spawned || !sample || !look || size <= 0) return;
    sim.layout(countFor(), LAYOUT_SEED);
    sim.paint(sample, look, { origins: origins(), clock: now(), mode: "spawn", reduced });
    renderer.uploadStatic(sim);
    renderer.uploadState(sim);
    spawned = true;
    startOpening();
    callbacks.current.onCount?.(sim.count);
    wake();
  };

  const repaint = (mode) => {
    if (!spawned) {
      spawn();
      return;
    }
    sim.paint(sample, look, { origins: origins(), clock: now(), mode, reduced });
    renderer.uploadStatic(sim);
    wake();
  };

  const relayout = () => {
    relayoutTimer = 0;
    if (!spawned || !alive) return;
    const count = countFor();
    if (gridColumns(count) === sim.columns) return;
    sim.layout(count, LAYOUT_SEED);
    const time = now();
    sim.paint(sample, look, { origins: origins(), clock: time, mode: "relayout", reduced });
    buildField();
    sim.snapToField(time, field);
    renderer.uploadStatic(sim);
    renderer.uploadState(sim);
    callbacks.current.onCount?.(sim.count);
    wake();
  };

  const resize = () => {
    hoverRect = null;
    const width = plate.clientWidth;
    if (!width) return;
    const sizeChanged = width !== size;
    size = width;
    const cap = embedded || compact ? 1.5 : 2;
    pixelRatio = Math.min(window.devicePixelRatio || 1, cap) * governor.scale;
    const pixels = Math.max(1, Math.round(size * pixelRatio));
    renderer.resize(pixels, pixels);
    if (sizeChanged) {
      for (const magnet of magnets) writeMagnet(magnet);
    }
    spawn();
  };

  const buildField = () => {
    const { width, height } = magnetSize();
    const poleOffset = (width / 2 - height / 2) / size;
    let poles = 0;
    let centres = 0;
    for (const magnet of magnets) {
      if (magnet.presence < 0.001 || centres >= MAGNET_CAPACITY) continue;
      const cos = Math.cos(magnet.angle);
      const sin = Math.sin(magnet.angle);
      field.poleX[poles] = magnet.x + cos * poleOffset;
      field.poleY[poles] = magnet.y + sin * poleOffset;
      field.poleQ[poles] = magnet.presence;
      poles += 1;
      field.poleX[poles] = magnet.x - cos * poleOffset;
      field.poleY[poles] = magnet.y - sin * poleOffset;
      field.poleQ[poles] = -magnet.presence;
      poles += 1;
      field.centreX[centres] = magnet.x;
      field.centreY[centres] = magnet.y;
      centres += 1;
    }
    field.poleCount = poles;
    field.centreCount = centres;
    const core = (height / 2 + 4) / size;
    field.coreSq = core * core;
    const reach = params.field / 100;
    const bRef = (2 * poleOffset) / (reach * reach) / 0.315;
    field.bRefSq = bRef * bRef;
    field.damping = 16 - 14 * (params.wobble / 100);
    field.creep = compact ? 0 : params.creep / 100;
    field.pullRadius = 16 / size;
    field.pullStrength = 8 / size;
    const spacingPx = Math.max(1, sim.spacing * size);
    const lanes = Math.min(40, Math.max(12, Math.round((Math.PI * 2 * LANE_REACH_PX) / (2.6 * spacingPx))));
    field.laneStep = (Math.PI * 2) / lanes;
    field.laneCap = 0.42 * sim.spacing;
    field.capNear = 10 / size;
    field.capFar = 6 / size;
    const near = (width * 0.75) / size;
    field.nearSq = near * near;
    field.reduced = reduced;
  };

  const omegaN = (Math.PI * 2) / SPRING_DURATION;
  const zeta = 1 - SPRING_BOUNCE;

  const updateMagnets = (dt) => {
    let busy = false;
    const presenceStep = 1 - Math.exp(-dt * PRESENCE_RATE);
    for (const magnet of magnets) {
      if (reduced || magnet.twisting) {
        magnet.angle = magnet.target;
        magnet.velocity = 0;
      } else {
        const steps = 4;
        const h = dt / steps;
        for (let step = 0; step < steps; step += 1) {
          const acceleration = -omegaN * omegaN * (magnet.angle - magnet.target) - 2 * zeta * omegaN * magnet.velocity;
          magnet.velocity += acceleration * h;
          magnet.angle += magnet.velocity * h;
        }
        if (Math.abs(magnet.angle - magnet.target) > 1e-4 || Math.abs(magnet.velocity) > 1e-3) busy = true;
        else {
          magnet.angle = magnet.target;
          magnet.velocity = 0;
          if (Math.abs(magnet.target) > Math.PI * 2) {
            const wrapped = wrapAngle(magnet.target);
            magnet.angle = wrapped;
            magnet.target = wrapped;
          }
        }
      }
      const goal = magnet.removing ? 0 : 1;
      if (reduced) magnet.presence = goal;
      else magnet.presence += (goal - magnet.presence) * presenceStep;
      if (Math.abs(goal - magnet.presence) > 0.004) busy = true;
      else magnet.presence = goal;
      if (magnet.held) busy = true;
      writeMagnet(magnet);
    }
    return busy;
  };

  const updatePaper = (dt) => {
    let busy = false;
    const step = reduced ? 1 : 1 - Math.exp(-dt * PAPER_RATE);
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = paperTarget[channel] - paperShown[channel];
      if (Math.abs(delta) > 0.002) {
        paperShown[channel] += delta * step;
        busy = true;
      } else paperShown[channel] = paperTarget[channel];
    }
    return busy;
  };

  const frameData = {
    paper: paperShown,
    dpr: 1,
    grain: GRAIN,
    plate: 1,
    intro: 0,
    introSpan: 1,
    morph: 0,
    morphSpan: 1,
    length: 1,
    showFilings: false,
  };

  const draw = (time) => {
    if (lost || size <= 0) return;
    frameData.dpr = canvas.width / size;
    frameData.plate = size;
    frameData.intro = time - sim.introClock;
    frameData.introSpan = sim.introSpan;
    frameData.morph = time - sim.morphClock;
    frameData.morphSpan = sim.morphSpan;
    frameData.length = params.length / 100;
    frameData.showFilings = spawned;
    renderer.draw(frameData);
    if (!painted) {
      painted = true;
      canvas.dataset.painted = "true";
    }
  };

  const frame = (stamp) => {
    raf = 0;
    if (!alive || lost) return;
    const elapsedMs = stamp - last;
    last = stamp;
    const dt = Math.min(1 / 30, Math.max(1 / 240, elapsedMs / 1000));
    if (renderer.kind === "webgl" && governor.sample(elapsedMs)) resize();
    const time = clock(stamp);
    let busy = updateMagnets(dt);
    busy = updatePaper(dt) || busy;
    if (spawned) {
      buildField();
      const activity = sim.step(dt, time, field);
      renderer.uploadState(sim);
      busy =
        busy ||
        activity.maxOmega > ((stamp - wokenAt) / 1000 > QUIET_AFTER_S ? IDLE_OMEGA_QUIET : IDLE_OMEGA) ||
        activity.maxCreep * size > IDLE_CREEP_PX ||
        sim.introBusy(time) ||
        sim.morphBusy(time);
    }
    draw(time);
    if (busy && visible && onscreen) raf = requestAnimationFrame(frame);
  };

  function wake() {
    wokenAt = performance.now();
    if (raf || !alive || lost || !visible || !onscreen) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const findMagnet = (target) => {
    const element = target instanceof Element ? target.closest("[data-magnet-id]") : null;
    if (!element) return null;
    const id = Number(element.dataset.magnetId);
    return magnets.find((magnet) => magnet.id === id && !magnet.removing) ?? null;
  };

  let rect = null;
  const toPlate = (event) => {
    if (!rect) rect = plate.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / size, y: (event.clientY - rect.top) / size };
  };

  const flip = (magnet) => {
    magnet.target += Math.PI;
    if (reduced) magnet.angle = magnet.target;
    wake();
  };

  const rotate = (magnet, direction) => {
    magnet.target += direction * ROTATE_STEP;
    if (reduced) magnet.angle = magnet.target;
    wake();
  };

  const shake = () => {
    if (!spawned) return;
    sim.kick();
    wake();
  };

  const clampToPlate = (value) => Math.min(0.96, Math.max(0.04, value));

  const nextAngle = () => {
    const live = liveMagnets();
    const reference = live[live.length - 1];
    return wrapAngle(reference ? reference.target + Math.PI : 0);
  };

  const addMagnet = (x, y, angle = nextAngle()) => {
    if (liveMagnets().length >= MAX_MAGNETS) return null;
    const magnet = makeMagnet({ x: clampToPlate(x), y: clampToPlate(y), angle: wrapAngle(angle) }, true);
    magnets = [...magnets, magnet];
    hideGhost(false);
    publishMagnets();
    wake();
    return magnet;
  };

  const partnerSpot = (anchor) => {
    const { width } = magnetSize();
    const spacing = Math.max(PARTNER_SPACING, (width + PARTNER_MIN_GAP_PX) / Math.max(1, size));
    const axisX = Math.cos(anchor.target);
    const axisY = Math.sin(anchor.target);
    let best = null;
    let bestScore = Infinity;
    for (const side of [-1, 1]) {
      const x = anchor.x + side * axisX * spacing;
      const y = anchor.y + side * axisY * spacing;
      const inside = x > PARTNER_MARGIN && x < 1 - PARTNER_MARGIN && y > PARTNER_MARGIN && y < 1 - PARTNER_MARGIN;
      const score = (inside ? 0 : 10) + Math.hypot(x - 0.5, y - 0.5);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return {
      x: Math.min(1 - PARTNER_MARGIN, Math.max(PARTNER_MARGIN, best.x)),
      y: Math.min(1 - PARTNER_MARGIN, Math.max(PARTNER_MARGIN, best.y)),
    };
  };

  const addPartner = (anchor, bridged) => {
    const spot = partnerSpot(anchor);
    return addMagnet(spot.x, spot.y, anchor.target + (bridged ? 0 : Math.PI));
  };

  const cancelOpening = () => {
    for (const timer of openingTimers) window.clearTimeout(timer);
    openingTimers = [];
  };

  const later = (task, delay) => {
    openingTimers.push(window.setTimeout(task, delay));
  };

  function startOpening() {
    cancelOpening();
    if (touched || !alive) return;
    const anchor = liveMagnets()[0];
    if (!anchor || liveMagnets().length > 1) return;
    if (reduced) {
      addPartner(anchor, true);
      return;
    }
    later(() => {
      if (!alive || touched || anchor.removing) return;
      const partner = addPartner(anchor, false);
      if (!partner) return;
      later(() => {
        if (alive && !touched && !partner.removing) flip(partner);
      }, PARTNER_FLIP_AT_MS - PARTNER_AT_MS);
    }, PARTNER_AT_MS);
  }

  const onFirstInput = () => {
    touched = true;
    cancelOpening();
  };

  function hideGhost(instant) {
    if (!ghostShown) return;
    ghostShown = false;
    if (instant) ghost.dataset.instant = "true";
    else delete ghost.dataset.instant;
    delete ghost.dataset.shown;
  }

  const updateGhost = (event) => {
    const show =
      !embedded &&
      spawned &&
      size > 0 &&
      event.pointerType === "mouse" &&
      pointers.size === 0 &&
      liveMagnets().length < MAX_MAGNETS &&
      !findMagnet(event.target);
    if (!show) {
      hideGhost(false);
      return;
    }
    if (!hoverRect) hoverRect = plate.getBoundingClientRect();
    const x = clampToPlate((event.clientX - hoverRect.left) / size);
    const y = clampToPlate((event.clientY - hoverRect.top) / size);
    ghost.style.transform = magnetTransform(x, y, nextAngle(), size);
    if (!ghostShown) {
      ghostShown = true;
      delete ghost.dataset.instant;
      ghost.dataset.shown = "true";
    }
  };

  const onPointerHover = (event) => {
    if (event.buttons === 0) updateGhost(event);
  };

  const onPointerLeave = () => {
    hoverRect = null;
    hideGhost(false);
  };

  const onScroll = () => {
    hoverRect = null;
  };

  const removeMagnet = (magnet) => {
    if (magnet.removing) return;
    magnet.removing = true;
    magnet.held = false;
    setFlag(magnet, "removing", true);
    updateAddable();
    wake();
    window.setTimeout(() => {
      if (!alive) return;
      magnets = magnets.filter((entry) => entry !== magnet);
      publishMagnets();
      wake();
    }, reduced ? 0 : REMOVE_MS);
  };

  const pointerAngle = () => {
    if (!twist) return 0;
    const anchor = pointers.get(twist.anchorId);
    const other = pointers.get(twist.pointerId);
    if (!anchor || !other) return twist.lastAngle;
    return Math.atan2(other.lastY - anchor.lastY, other.lastX - anchor.lastX);
  };

  const updateTwist = () => {
    if (!twist) return;
    const angle = pointerAngle();
    const delta = wrapAngle(angle - twist.lastAngle);
    twist.lastAngle = angle;
    twist.magnet.target += delta;
    twist.magnet.angle = twist.magnet.target;
  };

  const startTwist = (magnet, anchorId, event) => {
    const anchorEntry = pointers.get(anchorId);
    if (anchorEntry) anchorEntry.moved = true;
    hideGhost(false);
    pointers.set(event.pointerId, {
      kind: "twist",
      lastX: event.clientX,
      lastY: event.clientY,
    });
    twist = { magnet, anchorId, pointerId: event.pointerId, lastAngle: 0 };
    twist.lastAngle = pointerAngle();
    magnet.twisting = true;
    plate.setPointerCapture(event.pointerId);
  };

  const endTwist = () => {
    if (!twist) return;
    twist.magnet.twisting = false;
    twist = null;
  };

  const trackShake = (entry, event) => {
    const x = event.clientX;
    const y = event.clientY;
    const stamp = event.timeStamp;
    const stroke = entry.stroke;
    stroke.path += Math.hypot(x - entry.lastX, y - entry.lastY);
    const reach = Math.hypot(x - stroke.startX, y - stroke.startY);
    if (reach >= stroke.far) {
      stroke.far = reach;
      stroke.farX = x;
      stroke.farY = y;
      stroke.pathAtFar = stroke.path;
      return;
    }
    if (stroke.far < SHAKE_STROKE_PX || Math.hypot(x - stroke.farX, y - stroke.farY) < SHAKE_STROKE_PX) return;
    const straight = stroke.far >= SHAKE_STRAIGHTNESS * stroke.pathAtFar;
    const directionX = (stroke.farX - stroke.startX) / stroke.far;
    const directionY = (stroke.farY - stroke.startY) / stroke.far;
    const opposed = directionX * stroke.directionX + directionY * stroke.directionY < -0.5;
    if (straight && opposed) entry.reversals.push(stamp);
    else if (!straight) entry.reversals.length = 0;
    stroke.directionX = straight ? directionX : 0;
    stroke.directionY = straight ? directionY : 0;
    stroke.startX = stroke.farX;
    stroke.startY = stroke.farY;
    stroke.path -= stroke.pathAtFar;
    stroke.far = Math.hypot(x - stroke.startX, y - stroke.startY);
    stroke.farX = x;
    stroke.farY = y;
    stroke.pathAtFar = stroke.path;
    while (entry.reversals.length && stamp - entry.reversals[0] > SHAKE_WINDOW_MS) entry.reversals.shift();
    if (entry.reversals.length >= SHAKE_REVERSALS && stamp > shakeCooldownUntil) {
      entry.reversals.length = 0;
      shakeCooldownUntil = stamp + SHAKE_COOLDOWN_MS;
      shake();
    }
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    touched = true;
    rect = plate.getBoundingClientRect();
    const magnet = findMagnet(event.target);
    const holder = [...pointers.entries()].find(([, entry]) => entry.kind === "magnet");

    if (magnet && magnet.held) {
      const anchor = [...pointers.entries()].find(([, entry]) => entry.kind === "magnet" && entry.magnet === magnet);
      if (anchor && !twist) startTwist(magnet, anchor[0], event);
      event.preventDefault();
      return;
    }

    if (!magnet && holder && event.pointerType !== "mouse" && !twist) {
      startTwist(holder[1].magnet, holder[0], event);
      event.preventDefault();
      return;
    }

    const point = toPlate(event);
    if (magnet) {
      magnet.held = true;
      setFlag(magnet, "held", true);
      pointers.set(event.pointerId, {
        kind: "magnet",
        magnet,
        grabX: magnet.x - point.x,
        grabY: magnet.y - point.y,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        stroke: {
          startX: event.clientX,
          startY: event.clientY,
          farX: event.clientX,
          farY: event.clientY,
          far: 0,
          path: 0,
          pathAtFar: 0,
          directionX: 0,
          directionY: 0,
        },
        reversals: [],
      });
      hideGhost(false);
      elementFor(magnet)?.querySelector("button")?.focus({ preventScroll: true });
      event.preventDefault();
    } else {
      pointers.set(event.pointerId, {
        kind: "plate",
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      });
    }
    plate.setPointerCapture(event.pointerId);
    wake();
  };

  const onPointerMove = (event) => {
    const entry = pointers.get(event.pointerId);
    if (!entry) {
      onPointerHover(event);
      return;
    }
    if (entry.kind === "magnet") {
      const travelled = Math.hypot(event.clientX - entry.startX, event.clientY - entry.startY);
      if (!entry.moved && travelled > TAP_SLOP && !twist) entry.moved = true;
      if (entry.moved) {
        const point = toPlate(event);
        const magnet = entry.magnet;
        magnet.x = point.x + entry.grabX;
        magnet.y = point.y + entry.grabY;
        const leaving = magnet.x < 0 || magnet.x > 1 || magnet.y < 0 || magnet.y > 1;
        if (leaving !== magnet.leaving) {
          magnet.leaving = leaving;
          setFlag(magnet, "leaving", leaving);
        }
        trackShake(entry, event);
        writeMagnet(magnet);
      }
      entry.lastX = event.clientX;
      entry.lastY = event.clientY;
      if (twist && twist.anchorId === event.pointerId) updateTwist();
    } else if (entry.kind === "twist") {
      entry.lastX = event.clientX;
      entry.lastY = event.clientY;
      updateTwist();
    } else {
      entry.lastX = event.clientX;
      entry.lastY = event.clientY;
      if (!entry.moved && Math.hypot(event.clientX - entry.startX, event.clientY - entry.startY) > TAP_SLOP) {
        entry.moved = true;
        hideGhost(false);
      }
    }
    wake();
  };

  const onPointerEnd = (event) => {
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    pointers.delete(event.pointerId);
    const completed = event.type === "pointerup";
    if (twist && (twist.anchorId === event.pointerId || twist.pointerId === event.pointerId)) {
      const twisted = twist.magnet;
      endTwist();
      if (entry.kind === "magnet") entry.moved = true;
      if (twisted !== entry.magnet) twisted.held = [...pointers.values()].some((other) => other.magnet === twisted);
    }
    if (entry.kind === "magnet") {
      const magnet = entry.magnet;
      magnet.held = false;
      setFlag(magnet, "held", false);
      if (magnet.leaving) {
        magnet.leaving = false;
        setFlag(magnet, "leaving", false);
        if (completed) removeMagnet(magnet);
        else {
          magnet.x = Math.min(0.96, Math.max(0.04, magnet.x));
          magnet.y = Math.min(0.96, Math.max(0.04, magnet.y));
        }
      } else if (completed && !entry.moved) flip(magnet);
    } else if (entry.kind === "plate" && completed && !entry.moved) {
      const point = toPlate(event);
      const stamp = event.timeStamp;
      if (embedded) {
        callbacks.current.onTapEmpty?.();
      } else if (
        lastTap &&
        stamp - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - lastTap.clientX, event.clientY - lastTap.clientY) < DOUBLE_TAP_PX
      ) {
        lastTap = null;
        addMagnet(point.x, point.y);
      } else {
        lastTap = { time: stamp, clientX: event.clientX, clientY: event.clientY };
      }
    }
    rect = null;
    wake();
  };

  const onClick = (event) => {
    if (event.detail !== 0) return;
    const magnet = findMagnet(event.target);
    if (magnet) flip(magnet);
  };

  const onKeyDown = (event) => {
    touched = true;
    const magnet = findMagnet(event.target);
    if (!magnet || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = (event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP) / Math.max(1, size);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      magnet.x = Math.min(0.98, Math.max(0.02, magnet.x + dx));
      magnet.y = Math.min(0.98, Math.max(0.02, magnet.y + dy));
      writeMagnet(magnet);
      event.preventDefault();
      wake();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "r") {
      rotate(magnet, event.shiftKey ? -1 : 1);
      event.preventDefault();
    } else if (key === "f") {
      flip(magnet);
      event.preventDefault();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      removeMagnet(magnet);
      plate.focus({ preventScroll: true });
      event.preventDefault();
    }
  };

  const onWindowKey = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (typingInto(event.target)) return;
    if (event.key === "s" || event.key === "S") shake();
  };

  const onWheel = (event) => {
    const magnet = findMagnet(event.target);
    if (!magnet) return;
    onFirstInput();
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16.7 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
    if (event.deltaMode === 0 && Math.abs(delta) >= WHEEL_NOTCH * 1.6) {
      rotate(magnet, Math.sign(delta));
      wheelAccumulated = 0;
      return;
    }
    wheelAccumulated += delta;
    while (Math.abs(wheelAccumulated) >= WHEEL_NOTCH) {
      const direction = Math.sign(wheelAccumulated);
      rotate(magnet, direction);
      wheelAccumulated -= direction * WHEEL_NOTCH;
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };

  const onContextLost = (event) => {
    event.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onContextRestored = () => {
    try {
      const next = createGlRenderer(canvas);
      if (!next) return;
      renderer = next;
      lost = false;
      if (spawned) {
        renderer.uploadStatic(sim);
        renderer.uploadState(sim);
      }
      resize();
      draw(now());
      wake();
    } catch {
      lost = true;
    }
  };

  const onCompactChange = () => {
    compact = compactQuery.matches;
    resize();
    relayout();
    wake();
  };

  const onReducedChange = () => {
    reduced = reducedQuery.matches;
    wake();
  };

  const resizeObserver = new ResizeObserver(() => {
    hideGhost(true);
    resize();
    draw(now());
    wake();
  });
  resizeObserver.observe(plate);

  const intersection = new IntersectionObserver(
    ([entry]) => {
      onscreen = entry.isIntersecting;
      if (onscreen) wake();
    },
    { rootMargin: "60px" },
  );
  intersection.observe(plate);

  plate.addEventListener("pointerdown", onPointerDown);
  plate.addEventListener("pointermove", onPointerMove);
  plate.addEventListener("pointerup", onPointerEnd);
  plate.addEventListener("pointercancel", onPointerEnd);
  plate.addEventListener("lostpointercapture", onPointerEnd);
  plate.addEventListener("click", onClick);
  plate.addEventListener("keydown", onKeyDown);
  plate.addEventListener("wheel", onWheel, { passive: false });
  plate.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onWindowKey);
  window.addEventListener("pointerdown", onFirstInput, { capture: true });
  window.addEventListener("keydown", onFirstInput, { capture: true });
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  compactQuery.addEventListener("change", onCompactChange);
  reducedQuery.addEventListener("change", onReducedChange);

  resize();
  publishMagnets();
  draw(now());

  const capture = () => {
    draw(now());
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const context = out.getContext("2d");
    context.drawImage(canvas, 0, 0);
    const scale = canvas.width / size;
    const { width, height } = magnetSize();
    for (const magnet of magnets) {
      if (magnet.removing) continue;
      context.save();
      context.translate(magnet.x * size * scale, magnet.y * size * scale);
      context.rotate(magnet.angle);
      context.scale(scale, scale);
      context.beginPath();
      context.roundRect(-width / 2, -height / 2, width, height, height / 2);
      context.fillStyle = "#f5f2ea";
      context.fill();
      context.save();
      context.clip();
      context.fillStyle = "#1a1a1a";
      context.fillRect(0, -height / 2, width / 2, height);
      context.restore();
      context.lineWidth = 2;
      context.strokeStyle = "#1a1a1a";
      context.beginPath();
      context.roundRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, height / 2 - 1);
      context.stroke();
      context.restore();
    }
    return out.toDataURL("image/png");
  };

  return {
    setCover(next) {
      if (!next || next === sample) {
        spawn();
        return;
      }
      const first = !sample;
      sample = next;
      if (first || !spawned) spawn();
      else repaint("morph");
    },
    setLook(next) {
      if (next === lookSource && look) return;
      lookSource = next;
      look = lookFrom(next);
      paperTarget.splice(0, 3, ...look.paperRgb);
      if (spawned) repaint("morph");
      else {
        spawn();
        wake();
      }
    },
    setParams(next) {
      const densityChanged = params.density !== next.density;
      params = next;
      if (densityChanged && spawned) {
        window.clearTimeout(relayoutTimer);
        relayoutTimer = window.setTimeout(relayout, reduced ? 0 : RELAYOUT_DEBOUNCE_MS);
      }
      if (!spawned) spawn();
      draw(now());
      wake();
    },
    shake,
    capture,
    resetMagnets() {
      cancelOpening();
      for (const magnet of magnets) {
        if (!magnet.removing) removeMagnet(magnet);
      }
      const fresh = makeMagnet(DEFAULT_MAGNETS[0], true);
      magnets = [...magnets, fresh];
      addPartner(fresh, true);
      wake();
    },
    dispose() {
      alive = false;
      cancelOpening();
      window.clearTimeout(relayoutTimer);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      plate.removeEventListener("pointerdown", onPointerDown);
      plate.removeEventListener("pointermove", onPointerMove);
      plate.removeEventListener("pointerup", onPointerEnd);
      plate.removeEventListener("pointercancel", onPointerEnd);
      plate.removeEventListener("lostpointercapture", onPointerEnd);
      plate.removeEventListener("click", onClick);
      plate.removeEventListener("keydown", onKeyDown);
      plate.removeEventListener("wheel", onWheel);
      plate.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onWindowKey);
      window.removeEventListener("pointerdown", onFirstInput, { capture: true });
      window.removeEventListener("keydown", onFirstInput, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      compactQuery.removeEventListener("change", onCompactChange);
      reducedQuery.removeEventListener("change", onReducedChange);
      renderer.dispose();
      canvas.remove();
      ghost.remove();
      delete plate.dataset.addable;
    },
  };
}
