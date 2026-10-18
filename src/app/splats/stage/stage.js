// The splat stage: one WebGL canvas, one Spark renderer, every splat on the
// page. It is a module singleton on purpose.
//
// Why a singleton: PageTransition keys every page by pathname, so a route
// change remounts the whole React tree under it — a <Canvas> in a layout would
// be torn down and rebuilt between /splats and /splats/[slug], reloading every
// splat and dropping the one you clicked. The stage lives outside React. Each
// page mounts a host element and the stage re-parents its canvas into it, so
// the WebGL context, the decoded splats and every actor's motion state survive
// navigation. The clicked splat is the same live object on both pages and
// flies between them; nothing is snapshotted.
//
// Pages never position splats. They render anchors — ordinary DOM boxes — and
// say which actor belongs to each (see useSplatAnchor). Every frame the stage
// reads anchor rects and moves actors to them:
//   - an actor that gains a target while hidden enters (a toss from the side
//     on the first visit, a rise from below after that);
//   - a target that jumps (a route change swapped its anchor) starts a flight
//     from the actor's current position and velocity — interruptible;
//   - a target that moves continuously (scroll, a carousel track) is tracked
//     exactly, so the splat stays glued to its frame;
//   - an actor whose anchors all disappear falls out of frame and fades.

import { clamp, createFlight, easeOutCubic, lerp, moveDuration, moveLaunch, riseFrom, stepFlight, tossFrom } from "./motion";
import { localUp, robustBounds } from "./fit";

// A long lens: a narrow field of view from far away keeps perspective out of
// the framing, so a splat fills its anchor box the same way whether its near
// side or far side faces the camera. At 30° the near half of a large object
// swelled past its card by a quarter.
const FOV = 12;
const CAMERA_Z = 40;
const ENTER_SECONDS = 1.25;
const ENTER_STAGGER = 0.085;
const EXIT_SECONDS = 0.55;
const GRAVITY = 2600;
const IDLE_SPIN = 0.22; // rad/s
const LOOK_YAW = 0.55;
const LOOK_PITCH = 0.3;
const MAX_CONCURRENT_LOADS = 2;
const DPR_CAP = { desktop: 1.5, touch: 1.25 };
const DPR_FLOOR = 0.75;
const DISPOSE_AFTER_MS = 30000;

const listeners = new Set();
const actors = new Map();
const anchors = new Map(); // actorId -> Set<anchor>
const fileCache = new Map(); // src -> Promise<ArrayBuffer>
const versions = new Map(); // actorId -> bumps whenever its anchor set changes

const bump = (actorId) => versions.set(actorId, (versions.get(actorId) ?? 0) + 1);
const anchorVersion = (actor) => versions.get(actor.item.id) ?? 0;

const state = {
  canvas: null,
  host: null,
  gl: null, // { THREE, renderer, scene, camera, spark, SplatMesh }
  booting: null,
  running: false,
  disposeTimer: 0,
  viewport: { w: 1, h: 1 },
  dpr: 1,
  dprCap: 1.5,
  frameEma: 16.7,
  slowFor: 0,
  fastFor: 0,
  lastTime: 0,
  loads: 0,
  queue: [],
  introDeadline: 0, // the first visit's toss window, in performance.now() ms
  enterClock: 0,
  reducedMotion: false,
  frames: 0,
  manual: false,
};

/* ---------- public API ---------- */

/** Declare the actors (one per splat). Idempotent; call from the layout. */
export function defineActors(items) {
  for (const item of items) {
    if (actors.has(item.id)) continue;
    actors.set(item.id, {
      item,
      mesh: null,
      pivot: null,
      orient: null,
      status: "idle", // idle → loading → ready | error
      phase: "hidden", // hidden | flying | tracking | exiting
      x: 0,
      y: 0,
      s: 0,
      vx: 0,
      vy: 0,
      vs: 0,
      opacity: 0,
      flight: null,
      seenAnchors: 0,
      spin: Math.random() * Math.PI * 2,
      spinVelocity: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      look: { x: 0, y: 0, active: false },
      hover: 0,
      hoverTarget: 0,
      tumble: 0,
      side: 1,
    });
    // Anchors can register before the actors are declared (child refs attach
    // before the layout's effect runs); start their loads now.
    if (anchors.get(item.id)?.size) requestLoad(actors.get(item.id), true);
  }
}

/** Mount the canvas into `host`. Returns the unmount function. */
export function attach(host) {
  clearTimeout(state.disposeTimer);
  state.host = host;
  state.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = ensureCanvas();
  host.appendChild(canvas);
  resize();
  boot().then(start);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  return () => {
    observer.disconnect();
    if (state.host === host) {
      state.host = null;
      stop();
      canvas.remove();
      // Leaving the splat routes entirely: keep the GPU state warm for a
      // quick return, then let it go.
      state.disposeTimer = setTimeout(dispose, DISPOSE_AFTER_MS);
    }
  };
}

/**
 * Register a DOM element as a place for an actor (see SplatAnchor). Returns
 * the anchor; call anchor.remove() to drop it.
 */
export function addAnchor(actorId, el, { slot = "default", weight = 1, fit = 1 } = {}) {
  const anchor = {
    actorId,
    slot,
    el,
    weight,
    fit,
    remove: () => {
      if (anchors.get(actorId)?.delete(anchor)) bump(actorId);
    },
  };
  if (!anchors.has(actorId)) anchors.set(actorId, new Set());
  anchors.get(actorId).add(anchor);
  bump(actorId);
  const actor = actors.get(actorId);
  if (actor) requestLoad(actor, true);
  return anchor;
}

/**
 * Blend an actor between its anchors: the stage aims it at the
 * weight-averaged centre and size of every anchor it has. Cheap enough to call
 * from a scroll handler every frame. Weight 0 everywhere means "nowhere" and
 * the actor falls out of frame.
 */
export function setWeight(actorId, slot, weight) {
  const set = anchors.get(actorId);
  if (!set) return;
  for (const anchor of set) if (anchor.slot === slot) anchor.weight = weight;
}

/** Pointer position over an actor's anchor, in -1..1. Pass null to release. */
export function setLook(actorId, point) {
  const actor = actors.get(actorId);
  if (!actor) return;
  actor.look.active = Boolean(point);
  if (point) {
    actor.look.x = point.x;
    actor.look.y = point.y;
  }
  actor.hoverTarget = point ? 1 : 0;
}

/** Spin an actor by a drag, in px of pointer travel; release keeps the momentum. */
export function spinBy(actorId, dxPx, dtSeconds) {
  const actor = actors.get(actorId);
  if (!actor) return;
  const radians = (dxPx / Math.max(120, actor.s)) * Math.PI * 0.9;
  actor.spin += radians;
  if (dtSeconds > 0) actor.spinVelocity = clamp(radians / dtSeconds, -9, 9);
}

/** Start fetching an actor's splat ahead of need (hover intent, next article). */
export function preload(actorId) {
  const actor = actors.get(actorId);
  if (actor) requestLoad(actor, false);
}

/** Subscribe to load progress: fn({ ready, total }). */
export function subscribe(fn) {
  listeners.add(fn);
  fn(progress());
  return () => listeners.delete(fn);
}

export function progress() {
  let ready = 0;
  for (const actor of actors.values()) if (actor.status === "ready") ready += 1;
  return { ready, total: actors.size };
}

/* ---------- boot / teardown ---------- */

function ensureCanvas() {
  if (!state.canvas) {
    state.canvas = document.createElement("canvas");
    state.canvas.className = "splat-stage__canvas";
    state.canvas.setAttribute("aria-hidden", "true");
  }
  return state.canvas;
}

function boot() {
  if (state.gl) return Promise.resolve(state.gl);
  if (state.booting) return state.booting;
  state.booting = Promise.all([import("three"), import("@sparkjsdev/spark")]).then(([THREE, Spark]) => {
    const renderer = new THREE.WebGLRenderer({
      canvas: state.canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 200);
    camera.position.set(0, 0, CAMERA_Z);
    // √6 instead of √8 trims each splat's faint outer skirt: a little less
    // softness at the edges for noticeably less overdraw. LoD is pointless
    // for objects this small (under ~150k splats each).
    const spark = new Spark.SparkRenderer({ renderer, maxStdDev: Math.sqrt(6), enableLod: false });
    scene.add(spark);
    const touch = window.matchMedia("(pointer: coarse)").matches;
    state.dprCap = touch ? DPR_CAP.touch : DPR_CAP.desktop;
    state.dpr = Math.min(window.devicePixelRatio || 1, state.dprCap);
    state.gl = { THREE, renderer, scene, camera, spark, SplatMesh: Spark.SplatMesh, dyno: Spark.dyno };
    resize();
    pump();
    return state.gl;
  });
  return state.booting;
}

function dispose() {
  if (state.host || !state.gl) return;
  for (const actor of actors.values()) {
    actor.mesh?.dispose();
    actor.mesh = actor.pivot = actor.orient = null;
    actor.status = "idle";
    actor.phase = "hidden";
    actor.opacity = 0;
  }
  state.queue.length = 0;
  state.gl.spark.dispose();
  state.gl.renderer.dispose();
  state.gl.renderer.forceContextLoss();
  state.gl = null;
  state.booting = null;
  state.canvas = null;
  state.introDeadline = 0;
}

function start() {
  if (!state.host || !state.gl || state.running || state.manual) return;
  state.running = true;
  state.lastTime = 0;
  state.gl.renderer.setAnimationLoop(frame);
}

function stop() {
  state.running = false;
  state.gl?.renderer.setAnimationLoop(null);
}

function resize() {
  if (!state.host) return;
  const w = Math.max(1, state.host.clientWidth);
  const h = Math.max(1, state.host.clientHeight);
  state.viewport = { w, h };
  if (!state.gl) return;
  const { renderer, camera } = state.gl;
  renderer.setPixelRatio(state.dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ---------- loading ---------- */

function fetchBytes(src) {
  if (!fileCache.has(src)) {
    const request = fetch(src).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${src}`);
      return response.arrayBuffer();
    });
    request.catch(() => fileCache.delete(src));
    fileCache.set(src, request);
  }
  return fileCache.get(src);
}

function requestLoad(actor, urgent) {
  if (actor.status !== "idle") return;
  actor.status = "queued";
  if (urgent) state.queue.unshift(actor);
  else state.queue.push(actor);
  pump();
}

function pump() {
  if (!state.gl) return;
  while (state.loads < MAX_CONCURRENT_LOADS && state.queue.length) {
    const actor = state.queue.shift();
    state.loads += 1;
    load(actor).finally(() => {
      state.loads -= 1;
      pump();
    });
  }
}

async function load(actor) {
  actor.status = "loading";
  const { item } = actor;
  const gl = state.gl;
  // The stage can be disposed (and even rebooted) while a load is in flight.
  // Anything that finishes for a renderer that is gone goes back to idle so
  // the next mount queues it again.
  const stale = () => state.gl !== gl;
  try {
    const bytes = await fetchBytes(item.src);
    if (stale()) {
      actor.status = "idle";
      return;
    }
    const { THREE, scene, SplatMesh } = gl;
    const mesh = new SplatMesh({ fileBytes: bytes.slice(0), fileName: item.src.split("/").pop() });
    await mesh.initialized;
    if (stale()) {
      mesh.dispose();
      actor.status = "idle";
      return;
    }
    const rotation = item.rotation ?? [0, 0, 0];
    let bounds = robustBounds(mesh);
    if (item.crop) {
      const keep = applyCrop(mesh, bounds, rotation, item.crop);
      bounds = robustBounds(mesh, { keep });
    }
    const { center, radius } = bounds;
    const orient = new THREE.Group();
    orient.rotation.set(...rotation);
    // Unit-diameter subject centred on the pivot. The offset is in the
    // parent's space, so it carries the mesh's scale.
    const unit = 1 / (radius * 2);
    mesh.scale.setScalar(unit);
    mesh.position.set(-center[0] * unit, -center[1] * unit, -center[2] * unit);
    orient.add(mesh);
    const pivot = new THREE.Group();
    pivot.add(orient);
    pivot.visible = false;
    mesh.opacity = 0;
    scene.add(pivot);
    actor.mesh = mesh;
    actor.orient = orient;
    actor.pivot = pivot;
    actor.status = "ready";
  } catch (error) {
    actor.status = "error";
    console.warn(`[splat-stage] ${item.id}: ${error?.message || error}`);
  }
  notify();
}

/**
 * Hide the bottom `fraction` of a capture (a plinth, a turntable, the floor
 * it stood on) with a per-splat modifier that fades alpha out below a cut
 * plane in the capture's own space. Returns the same test for re-framing.
 */
function applyCrop(mesh, bounds, rotation, fraction) {
  const { THREE, dyno } = state.gl;
  const up = localUp(THREE, rotation);
  const [lo, hi] = bounds.box[up.axis];
  const bottom = up.sign > 0 ? lo : hi;
  const cut = bottom + up.sign * (hi - lo) * fraction; // in local units along `up`
  const height = (c) => up.sign * c[up.name];
  const threshold = up.sign * cut;
  // Splats just above the cut fade in over a thin band, and every splat is
  // capped to half its distance from the plane: Gaussians stretched along a
  // plinth's edge otherwise hang below the subject like drips.
  const band = (hi - lo) * 0.015;
  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const crop = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat },
      outTypes: { gsplat: dyno.Gsplat },
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          float d = ${up.sign.toFixed(1)} * ${inputs.gsplat}.center.${up.name} - ${threshold.toFixed(6)};
          ${outputs.gsplat}.rgba.a *= smoothstep(0.0, ${band.toFixed(6)}, d);
          ${outputs.gsplat}.scales = min(${inputs.gsplat}.scales, vec3(max(d, 0.0) * 0.5));
        `),
    });
    return { gsplat: crop.apply({ gsplat }).gsplat };
  });
  mesh.updateGenerator();
  return (c) => height(c) >= threshold;
}

function notify() {
  const value = progress();
  for (const fn of listeners) fn(value);
}

/* ---------- frame ---------- */

function targetFor(actor) {
  const set = anchors.get(actor.item.id);
  if (!set?.size) return null;
  let total = 0;
  let x = 0;
  let y = 0;
  let s = 0;
  for (const anchor of set) {
    const w = anchor.weight;
    if (w <= 0 || !anchor.el.isConnected) continue;
    const rect = anchor.el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    total += w;
    x += (rect.left + rect.width / 2) * w;
    y += (rect.top + rect.height / 2) * w;
    s += Math.min(rect.width, rect.height) * anchor.fit * w;
  }
  if (total <= 0) return null;
  const fit = actor.item.fit ?? 1;
  return { x: x / total, y: y / total, s: (s / total) * fit };
}

function onScreen(t, { w, h }) {
  const r = t.s * 0.6;
  return t.x + r > 0 && t.x - r < w && t.y + r > 0 && t.y - r < h;
}

function beginEnter(actor, target, now) {
  const { viewport } = state;
  actor.opacity = 0;
  actor.vx = actor.vy = actor.vs = 0;
  if (state.reducedMotion || !onScreen(target, viewport)) {
    Object.assign(actor, { x: target.x, y: target.y, s: target.s, phase: "tracking", flight: null, tumble: 0 });
    return;
  }
  // Everything that enters in the first few seconds of a visit is tossed in
  // from the sides — including a splat that finished loading late. After
  // that, entrances (coming back from an article) rise from below.
  if (!state.introDeadline) state.introDeadline = now + 3000;
  const first = now < state.introDeadline;
  const delay = state.enterClock;
  state.enterClock += first ? ENTER_STAGGER : ENTER_STAGGER * 0.5;
  actor.side = target.x < viewport.w / 2 ? -1 : 1;
  const plan = first
    ? tossFrom({ target, side: actor.side, viewport, duration: ENTER_SECONDS })
    : riseFrom({ target, viewport, duration: ENTER_SECONDS * 0.7 });
  Object.assign(actor, plan.from);
  actor.flight = createFlight({ ...plan, kind: first ? "toss" : "rise" });
  actor.flight.elapsed = -delay;
  actor.tumble = first ? actor.side * -1.1 : 0;
  actor.phase = "flying";
}

function beginMove(actor, target) {
  if (state.reducedMotion) {
    Object.assign(actor, { x: target.x, y: target.y, s: target.s, phase: "tracking", flight: null });
    return;
  }
  const duration = moveDuration(actor, target);
  actor.flight = createFlight({
    from: { x: actor.x, y: actor.y, s: actor.s },
    launch: moveLaunch(actor, target, duration, 0.14),
    duration,
    kind: "move",
  });
  actor.phase = "flying";
}

function beginExit(actor) {
  actor.flight = null;
  actor.phase = "exiting";
  const { w } = state.viewport;
  // Fall away from the centre line, carrying whatever velocity it had.
  const away = actor.x < w / 2 ? -1 : 1;
  actor.vx = actor.vx * 0.5 + away * (160 + Math.random() * 120);
  actor.vy = Math.min(actor.vy, 0) - 240;
  actor.tumble = 0;
}

function stepActor(actor, dt, now) {
  if (actor.status !== "ready") return;
  const target = targetFor(actor);
  const { viewport } = state;

  if (!target) {
    if (actor.phase === "flying" || actor.phase === "tracking") beginExit(actor);
  } else if (actor.phase === "hidden") {
    beginEnter(actor, target, now);
  } else if (actor.phase === "exiting") {
    beginMove(actor, target);
  } else if (actor.phase === "tracking" && actor.seenAnchors !== anchorVersion(actor)) {
    // The actor's set of anchors changed (a route change swapped its card for
    // an article hero): fly. Anything else that moves a target — scroll, the
    // rail, a resize — is tracked exactly, however far it moves in a frame,
    // so a fast flick never leaves a splat behind its card.
    if (onScreen(target, viewport) || onScreen(actor, viewport)) beginMove(actor, target);
  }
  actor.seenAnchors = anchorVersion(actor);

  if (actor.phase === "flying") {
    const f = actor.flight;
    if (f.elapsed < 0) {
      f.elapsed += dt; // staggered start: hold, invisible, at the launch point
    } else {
      const out = stepFlight(f, target, dt);
      Object.assign(actor, { x: out.x, y: out.y, s: out.s, vx: out.vx, vy: out.vy, vs: out.vs });
      if (f.kind === "move") actor.opacity = Math.min(1, actor.opacity + dt / 0.2);
      else actor.opacity = easeOutCubic(out.t / 0.35);
      if (out.done) {
        actor.phase = "tracking";
        actor.flight = null;
        actor.vx = actor.vy = actor.vs = 0;
      }
    }
  } else if (actor.phase === "tracking") {
    actor.x = target.x;
    actor.y = target.y;
    actor.s = target.s;
    actor.opacity = Math.min(1, actor.opacity + dt / (state.reducedMotion ? 0.2 : 0.3));
  } else if (actor.phase === "exiting") {
    actor.vy += GRAVITY * dt;
    actor.x += actor.vx * dt;
    actor.y += actor.vy * dt;
    actor.opacity -= dt / (state.reducedMotion ? 0.15 : EXIT_SECONDS);
    actor.roll += (actor.vx > 0 ? 1 : -1) * dt * 0.9;
    if (actor.opacity <= 0 || actor.y - actor.s > viewport.h) {
      actor.phase = "hidden";
      actor.opacity = 0;
      actor.roll = 0;
    }
  }

  // Rotation: a slow turntable, a look toward the pointer, the tumble of an
  // entrance unwinding as it lands.
  const still = state.reducedMotion;
  if (!still) actor.spin += dt * IDLE_SPIN * (1 - actor.hover * 0.85);
  actor.spin += actor.spinVelocity * dt;
  actor.spinVelocity *= Math.exp(-dt * 3.2);
  const follow = 1 - Math.exp(-dt * 10);
  actor.hover += (actor.hoverTarget - actor.hover) * follow;
  const lookYaw = actor.look.active ? actor.look.x * LOOK_YAW : 0;
  const lookPitch = actor.look.active ? actor.look.y * LOOK_PITCH : 0;
  actor.yaw += (lookYaw - actor.yaw) * follow;
  actor.pitch += (lookPitch - actor.pitch) * follow;
  const landing = actor.flight?.kind === "toss" ? 1 - easeOutCubic(clamp(actor.flight.elapsed / actor.flight.duration)) : 0;
  if (actor.phase !== "exiting") actor.roll += (0 - actor.roll) * follow;

  place(actor, landing);
}

function place(actor, landing) {
  const { pivot, mesh } = actor;
  const { w, h } = state.viewport;
  const k = (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360)) / h; // world units per px at z=0
  const waiting = actor.flight && actor.flight.elapsed < 0;
  const visible = actor.phase !== "hidden" && !waiting && actor.opacity > 0.004;
  const inView = actor.x + actor.s > -w * 0.25 && actor.x - actor.s < w * 1.25 && actor.y + actor.s > -h * 0.25 && actor.y - actor.s < h * 1.25;
  pivot.visible = visible && inView;
  if (!pivot.visible) return;
  const scale = actor.s * k * (1 + actor.hover * 0.05);
  pivot.position.set((actor.x - w / 2) * k, (h / 2 - actor.y) * k, 0);
  pivot.scale.setScalar(Math.max(1e-4, scale));
  pivot.rotation.set(actor.pitch, actor.spin + actor.yaw + actor.tumble * landing * Math.PI, actor.roll + actor.tumble * landing * 0.35);
  mesh.opacity = clamp(actor.opacity);
}

function frame(now) {
  const { gl } = state;
  if (!gl || !state.host) return;
  const dt = state.lastTime ? Math.min(0.05, (now - state.lastTime) / 1000) : 1 / 60;
  state.lastTime = now;
  adaptResolution(dt);

  let anyEntering = false;
  for (const actor of actors.values()) {
    stepActor(actor, dt, now);
    if (actor.flight && actor.flight.kind !== "move" && actor.flight.elapsed < actor.flight.duration) anyEntering = true;
  }
  if (!anyEntering) state.enterClock = 0;
  gl.renderer.render(gl.scene, gl.camera);
  state.frames += 1;
}

// Splats are fill-rate bound: overdraw scales with pixels, not splat count.
// Watch the frame time and trade resolution for frame rate in quarter steps.
function adaptResolution(dt) {
  state.frameEma = lerp(state.frameEma, dt * 1000, 0.08);
  if (state.frameEma > 21) {
    state.slowFor += dt;
    state.fastFor = 0;
  } else if (state.frameEma < 14) {
    state.fastFor += dt;
    state.slowFor = 0;
  } else {
    state.slowFor = state.fastFor = 0;
  }
  let next = state.dpr;
  if (state.slowFor > 1) next = Math.max(DPR_FLOOR, state.dpr - 0.25);
  if (state.fastFor > 4) next = Math.min(state.dprCap, Math.min(window.devicePixelRatio || 1, state.dprCap), state.dpr + 0.25);
  if (next !== state.dpr) {
    state.dpr = next;
    state.slowFor = state.fastFor = 0;
    resize();
  }
}

/**
 * Dev only: take the stage off the display clock and advance it by hand, one
 * fixed step per call. A software-rendered headless browser draws a frame
 * every second or so; stepping lets it record motion at its real speed, one
 * screenshot per step.
 */
export function manualClock() {
  stop();
  state.manual = true;
  let now = performance.now();
  return {
    step(ms) {
      now += ms;
      frame(now);
    },
    release() {
      state.manual = false;
      start();
    },
  };
}

/** Debug handle for the console and the browser checks. */
export function inspect() {
  return {
    dpr: state.dpr,
    frames: state.frames,
    frameMs: state.frameEma,
    introDeadline: state.introDeadline,
    actors: [...actors.values()].map((a) => ({
      id: a.item.id,
      status: a.status,
      phase: a.phase,
      x: Math.round(a.x),
      y: Math.round(a.y),
      s: Math.round(a.s),
      opacity: Number(a.opacity.toFixed(2)),
      flight: a.flight ? `${a.flight.kind} ${a.flight.elapsed.toFixed(2)}/${a.flight.duration.toFixed(2)}` : null,
      visible: Boolean(a.pivot?.visible),
    })),
  };
}
