import { createCoverQueue } from "./coverQueue";
import { easeEntrance, easeInOut, easeInQuad, easeOutCubic, easeOutQuad, easeOutQuint, springProgress } from "./motion";
import { GRAIN_SIZE, paperGrain } from "./paperGrain";
import { createPreviewDeck } from "./previewDeck";
import { createTearSound } from "./tearSound";
import { createEdge, paperPaths } from "./ticketPaper";
import {
  BRIDGES,
  FOLLOW,
  FREE,
  RAIL,
  addBody,
  addSeam,
  bodyPose,
  breakAll,
  createWorld,
  grab,
  holdSeam,
  moveHand,
  release,
  removeBody,
  setMode,
  setPreload,
  step,
} from "./xpbd";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDE_AXIS = (-4 * Math.PI) / 180;
const NARROW_AXIS = (-18 * Math.PI) / 180;
const MAX_STRIP = 6;
const MAX_STUBS = 8;
const BODY_CAPACITY = 20;
const SEAM_CAPACITY = 24;
const STRIP_HAND = 2e-4;
const STUB_HAND = 1e-6;
const RELEASE_WINDOW_MS = 90;
const MAX_THROW = 3200;
const MAX_SPIN = 9;
const TAP_SLOP = 6;
const INTRO_MS = 900;
const FEED_MS = 480;
const WIND_SPRING = springProgress(420, 0.18);
const TEAR_SCRIPT_MS = 700;
const TEASE_SCRIPT_MS = 900;
const TEASE_TWIST = (3 * Math.PI) / 180;
const TEASE_RELAX = 0.15;
const TEASE_RELAX_MS = 260;
const TEASE_HOLD_S = 0.32;
const PRESS_PRELOAD = 0.22;
const COVER_WAIT_MS = 600;
const FIRST_VISIBLE = 3;
const FLING_SPIN = 4;
const SCRIPT_FOLLOW_THROUGH_MS = 90;
const TEASE_BREAKS = 4;
const ROLL_LINES = 18;
const LEAVE_MS = 280;
const STILL_FRAMES = 8;
const FIRST_NUMBER = 14;
const INITIAL_TORN = 2;
const SPIN_LINE_INSET = 6;
const WIDE_STEPS = [220, 260, 300, 320];
const NARROW_STEPS = [168, 184, 196];
const OVER_EXTENDED = 4;
const SMALL_PILE = 2.4;
const GRAIN_HALF = GRAIN_SIZE / 2;
const GRAIN_TURNS = ["", `rotate(90 ${GRAIN_HALF} ${GRAIN_HALF})`, `rotate(180 ${GRAIN_HALF} ${GRAIN_HALF})`, `translate(${GRAIN_SIZE} 0) scale(-1 1)`];
const TOOTH_SALT = 0x9e3779b9;
const ROLL_GRAIN_SEED = 0x2f6b1d;
const ROLL_SHADE_STOPS = [
  [0, "var(--color-ink)", 0.2],
  [0.04, "var(--color-ink)", 0.13],
  [0.1, "var(--color-ink)", 0.06],
  [0.18, "var(--color-ink)", 0.015],
  [0.26, "#fff", 0.1],
  [0.35, "#fff", 0.26],
  [0.43, "#fff", 0.16],
  [0.52, "#fff", 0.04],
  [0.62, "var(--color-ink)", 0],
  [0.74, "var(--color-ink)", 0.035],
  [0.85, "var(--color-ink)", 0.09],
  [0.94, "var(--color-ink)", 0.16],
  [1, "var(--color-ink)", 0.24],
];
const CURL_STOPS = [
  [0, "var(--color-ink)", 0.07],
  [0.05, "var(--color-ink)", 0.04],
  [0.16, "var(--color-ink)", 0.012],
  [0.34, "var(--color-ink)", 0],
  [0.62, "#fff", 0],
  [0.84, "#fff", 0.04],
  [0.95, "#fff", 0.08],
  [1, "#fff", 0.05],
];
const FALLBACK_TINT = "rgb(246 246 243)";
const FALLBACK_SPOT = "rgb(128 120 112)";
const LIFT_RISE_TAU = 0.07;
const LIFT_FALL_TAU = 0.16;
const LIFT_EPSILON = 0.003;
const LIFT_TILT = 3.5;
const LIFT_PERSPECTIVE = 720;
const LIFT_SHADOW_X = 2;
const LIFT_SHADOW_Y = 6;
const LIFT_SHADOW_BLUR = 8;
const LIFT_SHADOW_OPACITY = 0.12;
const LIFT_SHADOW_GROW = 0.02;
const STUB_LIFT_SCALE = 0.022;
const HELD_LIFT = 0.35;
const STRAIN_LIFT = 0.45;
const TORN_LIFT = 0.4;
const RESTING_CURL = 0.2;
const CONTACT_BLUR = 0.6;
const CONTACT_OFFSET = "translate(0.25 0.6)";
const INK_SOFTNESS = 0.12;
const FLIGHT_LIFT = 0.7;
const FLIGHT_SPEED = 1600;
const MOUTH_SLACK = 12;
const FLOOR_GAP = 20;
const MAGNET_RX = 0.75;
const MAGNET_RY = 1.3;
const MAGNET_CORE = 0.3;
const MAGNET_PULL = 0.94;
const MAGNET_TURN = 16;
const MAGNET_TRAVEL = 28;
const ARM_RADIUS = 0.6;
const SEAT_MIN_MS = 90;
const SEAT_MAX_MS = 520;
const SEAT_MS_PER_PX = 0.5;
const CARRY_LIFT = 0.55;
const CARRY_DISTANCE = 360;
const WAIT_LIFT = 0.3;
const CATCH_DEPTH = 0.12;
const CATCH_MS = 120;
const WAIT_CATCH_MS = 240;
const DRAW_DELAY_MS = 70;
const DRAW_MS = 540;
const DRAW_OVERRUN = 4;
const EJECT_MS = 640;
const SWAP_EJECT_MS = 440;
const EJECT_MIN_MS = 220;
const EJECT_CLEAR = 6;
const TOSS_X = 280;
const TOSS_Y = 360;
const TOSS_SPIN = 0.8;
const SET_DOWN_X = 200;
const SET_DOWN_Y = 220;
const CLIP_BLEED = 48;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function snapDown(value, steps) {
  let best = steps[0];
  for (const candidate of steps) if (candidate <= value) best = candidate;
  return best;
}

function copyEdge(from, to) {
  to.broken.set(from.broken);
  to.gap.set(from.gap);
  to.load.set(from.load);
  to.share.set(from.share);
  to.seed.set(from.seed);
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDuration(ms) {
  if (!ms || !Number.isFinite(ms)) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function barcodePath(seed, width, height) {
  let state = seed || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  let y = 0;
  let d = "";
  while (y < height) {
    const bar = 1 + Math.floor(next() * 3) * 0.75;
    if (y + bar > height) break;
    d += `M0 ${y.toFixed(2)}h${width}v${bar.toFixed(2)}h-${width}Z`;
    y += bar + 1 + next() * 1.75;
  }
  return d;
}

function svg(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key in attributes) node.setAttribute(key, attributes[key]);
  return node;
}

function grainTransform(seed) {
  const turn = GRAIN_TURNS[(seed >>> 16) & 3];
  return `translate(${seed % GRAIN_SIZE} ${(seed >>> 8) % GRAIN_SIZE})${turn ? ` ${turn}` : ""}`;
}

function grainPattern(id, seed, href) {
  const pattern = svg("pattern", {
    id,
    patternUnits: "userSpaceOnUse",
    width: String(GRAIN_SIZE),
    height: String(GRAIN_SIZE),
    patternTransform: grainTransform(seed),
  });
  const image = svg("image", { width: String(GRAIN_SIZE), height: String(GRAIN_SIZE), preserveAspectRatio: "none" });
  if (href) image.setAttribute("href", href);
  pattern.appendChild(image);
  return { pattern, image };
}

function div(className, text) {
  const node = document.createElement("div");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createTearOff(stage, { covers, onCount, onDeck, onTime, mouth: mouthEl = null, reducedMotion: initialReduced = false }) {
  const world = createWorld(BODY_CAPACITY, SEAM_CAPACITY);
  const queue = createCoverQueue(covers);
  const sound = createTearSound();
  const deck = createPreviewDeck(onDeckStatus);
  const byBody = new Array(BODY_CAPACITY).fill(null);
  const tickets = [];
  const timers = new Set();
  const pose = { x: 0, y: 0, a: 0 };
  const samples = new Float64Array(48);
  const layout = { width: 0, height: 0, W: 0, H: 0, D: 0, mouthX: 0, mouthY: 0, restEnd: 0, small: false, angle: WIDE_AXIS, ux: 1, uy: 0, floor: 0 };
  const mouth = { x: 0, y: 0 };
  const reader = { inside: null, feeding: null, ejecting: [], current: null, armed: false };
  const paths = { fill: "", line: "", torn: "", fibres: "" };
  const leavingEls = new Set();

  let strip = [];
  let stubs = [];
  let coverCursor = 0;
  let maxCover = 0;
  let numberCursor = FIRST_NUMBER;
  let count = INITIAL_TORN;
  let interacted = false;
  let stubSequence = 0;
  let tween = null;
  let script = null;
  let pointer = null;
  let frame = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let feedPending = false;
  let focusAfterFeed = false;
  let reducedMotion = initialReduced;
  let timeFrame = 0;
  let stubStop = null;
  let lastRollS = Number.NaN;
  let ticketId = 0;
  let generation = 0;
  let resizeTimer = 0;
  let pendingTicks = 0;
  let pendingSpeed = 0;

  const uid = `to-${hashString(String(Math.random())).toString(36)}`;
  let grainUrls = null;
  let paperId = 0;
  const defsSvg = svg("svg", { class: "to-defs", width: "0", height: "0", "aria-hidden": "true", focusable: "false" });
  const sharedDefs = svg("defs", {});
  const rollGrain = grainPattern(`${uid}-roll-paper`, ROLL_GRAIN_SEED, null);
  const rollShade = svg("linearGradient", { id: `${uid}-roll-shade`, x1: "0", y1: "0", x2: "1", y2: "0" });
  for (const [offset, color, alpha] of ROLL_SHADE_STOPS) {
    rollShade.appendChild(svg("stop", { offset: String(offset), style: `stop-color: ${color}; stop-opacity: ${alpha}` }));
  }
  sharedDefs.append(rollGrain.pattern, rollShade);
  const curlGradient = svg("linearGradient", { id: `${uid}-curl`, x1: "0", y1: "0", x2: "1", y2: "0" });
  for (const [offset, color, alpha] of CURL_STOPS) {
    curlGradient.appendChild(svg("stop", { offset: String(offset), style: `stop-color: ${color}; stop-opacity: ${alpha}` }));
  }
  const contactFilter = svg("filter", { id: `${uid}-contact`, x: "-5%", y: "-10%", width: "110%", height: "130%" });
  contactFilter.appendChild(svg("feGaussianBlur", { stdDeviation: String(CONTACT_BLUR) }));
  const liftFilter = svg("filter", { id: `${uid}-lift`, x: "-25%", y: "-50%", width: "150%", height: "200%" });
  liftFilter.appendChild(svg("feGaussianBlur", { stdDeviation: String(LIFT_SHADOW_BLUR) }));
  const inkFilter = svg("filter", { id: `${uid}-ink`, x: "-20%", y: "-2%", width: "140%", height: "104%" });
  inkFilter.appendChild(svg("feGaussianBlur", { stdDeviation: String(INK_SOFTNESS) }));
  sharedDefs.append(curlGradient, contactFilter, liftFilter, inkFilter);
  defsSvg.appendChild(sharedDefs);
  stage.appendChild(defsSvg);

  const roll = div("to-roll");
  roll.setAttribute("aria-hidden", "true");
  const rollSvg = svg("svg", { class: "to-roll__svg" });
  const rollRect = svg("rect", { class: "to-roll__body" });
  const rollTexture = svg("rect", { class: "to-roll__texture", fill: `url(#${rollGrain.pattern.id})` });
  const rollShadeRect = svg("rect", { class: "to-roll__shade", fill: `url(#${rollShade.id})` });
  const rollLines = [];
  for (let i = 0; i < ROLL_LINES; i += 1) {
    const line = svg("line", { class: "to-roll__line" });
    rollLines.push(line);
  }
  const rollClip = svg("clipPath", { id: `to-roll-clip-${hashString(String(Math.random()))}` });
  const rollClipRect = svg("rect", {});
  rollClip.appendChild(rollClipRect);
  const rollLineGroup = svg("g", { "clip-path": `url(#${rollClip.id})` });
  rollLines.forEach((line) => rollLineGroup.appendChild(line));
  const rollDefs = svg("defs", {});
  rollDefs.appendChild(rollClip);
  rollSvg.append(rollDefs, rollRect, rollTexture, rollShadeRect, rollLineGroup);
  roll.appendChild(rollSvg);
  stage.appendChild(roll);

  paperGrain().then((urls) => {
    if (destroyed || !urls) return;
    grainUrls = urls;
    rollGrain.image.setAttribute("href", urls.paper);
    for (const ticket of tickets) {
      ticket.paperImage.setAttribute("href", urls.paper);
      ticket.toothImage.setAttribute("href", urls.tooth);
    }
  });

  function later(callback, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!destroyed) callback();
    }, ms);
    timers.add(id);
    return id;
  }

  function axialAt(x, y) {
    return (x - layout.mouthX) * layout.ux + (y - layout.mouthY) * layout.uy;
  }

  function axialOf(ticket) {
    bodyPose(world, ticket.body, pose);
    return axialAt(pose.x, pose.y);
  }

  function endRight() {
    if (!strip.length) return -layout.W;
    const end = strip[strip.length - 1];
    return axialOf(end) + layout.W / 2;
  }

  function computeLayout(width, height) {
    const small = width < 640;
    const angle = small ? NARROW_AXIS : WIDE_AXIS;
    const W = small ? snapDown(width * 0.44, NARROW_STEPS) : snapDown((width - 120) / 3.4, WIDE_STEPS);
    const H = Math.round((W * 0.42) / 4) * 4;
    const D = Math.round(H * 1.12);
    const mouthX = Math.round(small ? Math.max(16, D * 0.36) : Math.min(width * 0.06 + 24, D * 0.55));
    const mouthY = Math.round(small ? Math.max(184 + H, height * 0.4) : Math.max(208 + H / 2, height * 0.42));
    const margin = small ? 12 : Math.max(20, width * 0.05);
    Object.assign(layout, {
      width,
      height,
      W,
      H,
      D,
      mouthX,
      mouthY,
      small,
      angle,
      restEnd: (width - margin - mouthX) / Math.cos(angle),
      ux: Math.cos(angle),
      uy: Math.sin(angle),
    });
    world.rail.ux = layout.ux;
    world.rail.uy = layout.uy;
    stage.dataset.size = small ? "sm" : "lg";
    stage.style.setProperty("--to-w", `${W}px`);
    stage.style.setProperty("--to-h", `${H}px`);
    measureMouth();
    updateBounds();
    drawRoll();
  }

  function measureMouth() {
    const { width, height, W, H } = layout;
    mouth.x = width / 2;
    mouth.y = height - 80;
    if (mouthEl) {
      mouthEl.style.setProperty("--to-mouth", `${W + MOUTH_SLACK}px`);
      const box = mouthEl.getBoundingClientRect();
      const frame = stage.getBoundingClientRect();
      if (box.width > 0) {
        mouth.x = box.left + box.width / 2 - frame.left;
        mouth.y = box.top + box.height / 2 - frame.top;
      }
    }
    layout.floor = mouth.y - H / 2 - FLOOR_GAP;
  }

  function dockY() {
    return mouth.y - layout.H / 2;
  }

  function updateBounds() {
    world.bounds.minX = layout.W * 0.12;
    world.bounds.maxX = layout.width - layout.W * 0.12;
    world.bounds.minY = 64 + layout.H * 0.2;
    world.bounds.maxY = Math.max(world.bounds.minY, dockY());
  }

  function liftOffPlayer() {
    const limit = world.bounds.maxY;
    for (const ticket of stubs) {
      const body = ticket.body;
      if (world.y[body] <= limit) continue;
      world.y[body] = limit;
      world.py[body] = limit;
      world.vy[body] = Math.min(0, world.vy[body]);
    }
  }

  function drawRoll() {
    const { D, H, mouthX, mouthY } = layout;
    const half = H / 2 + 10;
    roll.style.transform = `translate3d(${mouthX}px, ${mouthY}px, 0) rotate(${layout.angle}rad)`;
    rollSvg.setAttribute("width", String(D + 4));
    rollSvg.setAttribute("height", String(half * 2 + 4));
    rollSvg.setAttribute("viewBox", `${-D - 2} ${-half - 2} ${D + 4} ${half * 2 + 4}`);
    rollSvg.style.transform = `translate(${-D - 2}px, ${-half - 2}px)`;
    rollRect.setAttribute("x", String(-D));
    rollRect.setAttribute("y", String(-half));
    rollRect.setAttribute("width", String(D));
    rollRect.setAttribute("height", String(half * 2));
    rollRect.setAttribute("rx", "12");
    for (const attribute of ["x", "y", "width", "height", "rx"]) {
      rollTexture.setAttribute(attribute, rollRect.getAttribute(attribute));
      rollShadeRect.setAttribute(attribute, rollRect.getAttribute(attribute));
    }
    rollClipRect.setAttribute("x", String(-D + SPIN_LINE_INSET));
    rollClipRect.setAttribute("y", String(-half + SPIN_LINE_INSET));
    rollClipRect.setAttribute("width", String(D - SPIN_LINE_INSET * 2));
    rollClipRect.setAttribute("height", String(half * 2 - SPIN_LINE_INSET * 2));
    rollClipRect.setAttribute("rx", "7");
    rollLines.forEach((line) => {
      line.setAttribute("y1", String(-half + SPIN_LINE_INSET));
      line.setAttribute("y2", String(half - SPIN_LINE_INSET));
    });
    lastRollS = Number.NaN;
    spinRoll();
  }

  function spinRoll() {
    const s = world.rail.s;
    if (s === lastRollS) return;
    lastRollS = s;
    const radius = layout.D / 2;
    const phase = s / radius;
    for (let i = 0; i < ROLL_LINES; i += 1) {
      const theta = phase + (i / ROLL_LINES) * Math.PI * 2;
      const facing = Math.cos(theta);
      const line = rollLines[i];
      if (facing < 0.06) {
        line.setAttribute("visibility", "hidden");
        continue;
      }
      const x = -radius + (radius - SPIN_LINE_INSET) * Math.sin(theta);
      line.setAttribute("visibility", "visible");
      line.setAttribute("x1", x.toFixed(2));
      line.setAttribute("x2", x.toFixed(2));
      line.setAttribute("stroke-width", (0.4 + 0.8 * facing).toFixed(2));
    }
  }

  function makeTicket({ coverIndex, number, x, y, a, mode, before = null, reuseId = null }) {
    const entry = queue.get(coverIndex);
    const cover = entry?.cover ?? { id: `blank-${number}`, title: "Untitled", artist: "", image: "" };
    const { W, H, small } = layout;
    const body = addBody(world, { x, y, a, halfW: W / 2, halfH: H / 2, mode });
    if (body < 0) return null;
    const id = reuseId ?? `t${(ticketId += 1)}`;
    const el = div("to-ticket");
    el.dataset.ticket = id;
    el.dataset.kind = mode === FREE ? "stub" : "strip";
    el.style.width = `${W}px`;
    el.style.height = `${H}px`;
    const paperSeed = hashString(`${id}:${cover.id}:${number}`);
    const paperKey = `${uid}-p${(paperId += 1)}`;
    el.style.setProperty("--to-tint", entry?.tint ?? FALLBACK_TINT);
    el.style.setProperty("--to-spot", entry?.spot ?? FALLBACK_SPOT);
    el.tabIndex = -1;
    el.setAttribute("role", "button");
    const inner = div("to-ticket__body");
    const paperBox = { width: String(W), height: String(H), viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" };
    const outline = svg("path", { id: `${paperKey}-outline` });
    const outlineRef = `#${outline.id}`;
    const paperGrainPattern = grainPattern(`${paperKey}-paper`, paperSeed, grainUrls?.paper);
    const toothGrainPattern = grainPattern(`${paperKey}-tooth`, (paperSeed ^ TOOTH_SALT) >>> 0, grainUrls?.tooth);
    const paperDefs = svg("defs", {});
    paperDefs.append(outline, paperGrainPattern.pattern, toothGrainPattern.pattern);
    const shadow = svg("svg", { class: "to-ticket__shadow", ...paperBox });
    shadow.appendChild(svg("use", { href: outlineRef, filter: `url(#${uid}-lift)` }));
    const paper = svg("svg", { class: "to-ticket__paper", ...paperBox });
    const contact = svg("use", { href: outlineRef, class: "to-ticket__contact", filter: `url(#${uid}-contact)`, transform: CONTACT_OFFSET });
    const path = svg("use", { href: outlineRef, class: "to-ticket__fill" });
    const texture = svg("use", { href: outlineRef, class: "to-ticket__texture", fill: `url(#${paperGrainPattern.pattern.id})` });
    paper.append(paperDefs, contact, path, texture);
    const overlay = svg("svg", { class: "to-ticket__paper to-ticket__paper--top", ...paperBox });
    const tooth = svg("use", { href: outlineRef, class: "to-ticket__tooth", fill: `url(#${toothGrainPattern.pattern.id})` });
    const curl = svg("use", { href: outlineRef, class: "to-ticket__curl", fill: `url(#${uid}-curl)` });
    curl.style.opacity = "0";
    const line = svg("path", { class: "to-ticket__line" });
    const core = svg("path", { class: "to-ticket__core" });
    const torn = svg("path", { class: "to-ticket__torn" });
    const fibres = svg("path", { class: "to-ticket__fibres" });
    overlay.append(tooth, curl, line, core, torn, fibres);
    const face = div("to-ticket__face");
    const image = document.createElement("img");
    image.className = "to-ticket__cover";
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.addEventListener(
      "load",
      () => {
        image.dataset.loaded = "";
      },
      { once: true },
    );
    if (cover.image) image.src = cover.image;
    const well = div("to-ticket__well");
    well.appendChild(image);
    const text = div("to-ticket__text");
    const meta = div("to-ticket__meta");
    const numberLabel = `No. ${String(number).padStart(3, "0")}`;
    meta.append(div("to-ticket__number", numberLabel));
    const duration = formatDuration(cover.durationMs);
    if (duration) meta.append(div("to-ticket__duration", duration));
    const names = div("to-ticket__names");
    names.append(div("to-ticket__title", cover.title || "Untitled"), div("to-ticket__artist", cover.artist || ""));
    text.append(meta, names);
    const codeWidth = small ? 10 : 12;
    const codeHeight = H - (small ? 16 : 24);
    const code = div("to-ticket__code");
    const bars = barcodePath(hashString(String(cover.id)), codeWidth, codeHeight);
    const ink = svg("svg", { class: "to-ticket__bars", width: String(codeWidth), height: String(codeHeight), viewBox: `0 0 ${codeWidth} ${codeHeight}`, "aria-hidden": "true" });
    ink.appendChild(svg("path", { d: bars, filter: `url(#${uid}-ink)` }));
    code.append(ink);
    face.append(well, text, code);
    inner.append(paper, face, overlay);
    el.append(shadow, inner);
    el.style.transform = `translate3d(${(x - W / 2).toFixed(2)}px, ${(y - H / 2).toFixed(2)}px, 0) rotate(${a.toFixed(5)}rad)`;
    stage.insertBefore(el, before && before.parentNode === stage ? before : null);

    const ticket = {
      id,
      body,
      el,
      inner,
      shadow,
      outline,
      paperImage: paperGrainPattern.image,
      toothImage: toothGrainPattern.image,
      curl,
      line,
      core,
      torn,
      fibres,
      code,
      paperSeed,
      lift: 0,
      curlLevel: 0,
      tilt: 0,
      liftApplied: 0,
      curlApplied: 0,
      tiltApplied: 0,
      layered: false,
      number,
      numberLabel,
      coverIndex,
      cover,
      kind: mode === FREE ? "stub" : "strip",
      leftSeam: -1,
      rightSeam: -1,
      leftEdge: createEdge(),
      rightEdge: createEdge(),
      dirty: true,
      lastX: Number.NaN,
      lastY: Number.NaN,
      lastA: Number.NaN,
      still: 0,
      moving: false,
      z: 0,
      zApplied: -1,
      leaving: false,
      reader: null,
      carry: 0,
      clip: "",
    };
    byBody[body] = ticket;
    tickets.push(ticket);
    maxCover = Math.max(maxCover, coverIndex);
    if (entry && !queue.isReady(coverIndex)) {
      const built = generation;
      queue.ensure(coverIndex).then((loaded) => {
        if (destroyed || built !== generation || !loaded) return;
        el.style.setProperty("--to-tint", loaded.tint);
        el.style.setProperty("--to-spot", loaded.spot);
      });
    }
    labelTicket(ticket);
    return ticket;
  }

  function labelTicket(ticket) {
    const { cover, numberLabel } = ticket;
    const name = `${numberLabel}, ${cover.title}${cover.artist ? ` by ${cover.artist}` : ""}`;
    ticket.el.setAttribute(
      "aria-label",
      ticket.kind === "strip" ? `${name}. Enter tears it off, Backspace winds the roll back.` : `${name}. Torn stub. Enter feeds it into the reader, arrow keys move through the pile.`,
    );
  }

  function tearEdge(edge, seed) {
    let state = seed || 7;
    for (let k = 0; k < BRIDGES; k += 1) {
      state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
      state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
      edge.broken[k] = 1;
      edge.gap[k] = 2.6;
      edge.load[k] = 1;
      edge.share[k] = 0.3 + ((state >>> 8) / 16777216) * 0.4;
      edge.seed[k] = state;
    }
  }

  function linkSeam(left, right, seed, brokenFrom, brokenTo) {
    const seam = addSeam(world, left.body, right.body, seed, brokenFrom, brokenTo);
    if (seam < 0) return -1;
    left.rightSeam = seam;
    right.leftSeam = seam;
    left.dirty = true;
    right.dirty = true;
    return seam;
  }

  function copySeam(edge, seam, isLeft) {
    for (let k = 0; k < BRIDGES; k += 1) {
      const q = seam * BRIDGES + k;
      edge.broken[k] = world.bridgeBroken[q];
      edge.gap[k] = world.bridgeGap[q];
      edge.load[k] = world.bridgeLoad[q];
      edge.share[k] = isLeft ? world.bridgeShare[q] : 1 - world.bridgeShare[q];
      edge.seed[k] = isLeft ? world.bridgeSeed[q] : (world.bridgeSeed[q] ^ 0x5bd1e995) >>> 0;
    }
  }

  function detachSeam(seam) {
    const left = byBody[world.seamA[seam]];
    const right = byBody[world.seamB[seam]];
    if (left) {
      copySeam(left.rightEdge, seam, true);
      left.rightSeam = -1;
      left.dirty = true;
    }
    if (right) {
      copySeam(right.leftEdge, seam, false);
      right.leftSeam = -1;
      right.dirty = true;
    }
    world.seamAlive[seam] = 0;
  }

  function positionAt(axial) {
    return { x: layout.mouthX + layout.ux * axial, y: layout.mouthY + layout.uy * axial };
  }

  function clearScene() {
    generation += 1;
    tween = null;
    script = null;
    pointer = null;
    feedPending = false;
    release(world);
    for (const ticket of tickets) {
      ticket.el.remove();
      removeBody(world, ticket.body);
      byBody[ticket.body] = null;
    }
    tickets.length = 0;
    strip = [];
    stubs = [];
    stubStop = null;
    for (let seam = 0; seam < SEAM_CAPACITY; seam += 1) world.seamAlive[seam] = 0;
    world.events.length = 0;
    world.rail.s = 0;
    world.rail.ps = 0;
    world.rail.v = 0;
    world.rail.driven = false;
    world.rail.max = Infinity;
  }

  function startingPiles() {
    const { width, W, H, mouthY, small, floor } = layout;
    if (small) {
      return [
        [width * 0.36, Math.min(floor, mouthY + H * SMALL_PILE), -9],
        [width * 0.64, Math.min(floor, mouthY + H * (SMALL_PILE + 0.35)), 6],
      ];
    }
    const first = clamp(Math.max(width * 0.62, mouth.x + W * 0.85), W * 0.55, width - W * 0.55);
    const second = clamp(Math.max(width * 0.79, first + W * 0.6), W * 0.55, width - W * 0.55);
    return [
      [first, floor - H * 0.25, -8],
      [second, floor, 5],
    ];
  }

  function placeStub(record, intro) {
    const stub = makeTicket({ coverIndex: record.coverIndex, number: record.number, x: record.x, y: record.y, a: record.a, mode: FREE, reuseId: record.id ?? null });
    if (!stub) return null;
    if (record.left) copyEdge(record.left, stub.leftEdge);
    else tearEdge(stub.leftEdge, hashString(`${stub.cover.id}l`));
    if (record.right) copyEdge(record.right, stub.rightEdge);
    else tearEdge(stub.rightEdge, hashString(`${stub.cover.id}r`));
    stub.z = record.z ?? 100 + (stubSequence += 1);
    world.awake[stub.body] = 0;
    stubs.push(stub);
    if (intro && !reducedMotion && record.delay !== undefined) {
      stub.el.dataset.enter = "";
      stub.el.style.setProperty("--to-delay", `${record.delay}ms`);
      stub.el.addEventListener("animationend", () => delete stub.el.dataset.enter, { once: true });
    }
    return stub;
  }

  function buildRoll({ withStubs = false, kept = null, endEdge = null, firstNumber, firstCover, intro }) {
    clearScene();
    const { W, restEnd } = layout;
    let cover = queue.usable(firstCover);
    let records = kept;
    if (withStubs) {
      records = startingPiles().map(([x, y, degrees], index) => {
        const record = { coverIndex: cover, number: firstNumber - 2 + index, x, y, a: (degrees * Math.PI) / 180, delay: 60 + index * 90 };
        cover = queue.usable(cover + 1);
        return record;
      });
    }
    world.rail.s = 0;
    const built = [];
    let center = restEnd - W / 2;
    let number = firstNumber;
    while (built.length < MAX_STRIP) {
      const at = positionAt(center);
      const before = built.length ? built[built.length - 1].el : stage.querySelector('.to-ticket[data-kind="stub"]');
      const ticket = makeTicket({ coverIndex: cover, number, x: at.x, y: at.y, a: layout.angle, mode: RAIL, before });
      if (!ticket) break;
      ticket.z = 10 + MAX_STRIP - built.length;
      built.push(ticket);
      cover = queue.usable(cover + 1);
      number += 1;
      if (center - W / 2 <= -0.15 * W) break;
      center -= W;
    }
    strip = built.reverse();
    for (let i = 0; i + 1 < strip.length; i += 1) {
      linkSeam(strip[i], strip[i + 1], hashString(`${strip[i + 1].cover.id}:${strip[i + 1].number}`));
    }
    const end = strip[strip.length - 1];
    if (end && endEdge) copyEdge(endEdge, end.rightEdge);
    else if (end && withStubs) tearEdge(end.rightEdge, hashString(`${end.cover.id}end`));
    coverCursor = cover;
    numberCursor = number;
    queue.ensure(coverCursor);
    queue.ensure(coverCursor + 1);
    if (records) records.forEach((record) => placeStub(record, intro));
    updateTabStops();
    if (intro && !reducedMotion) {
      const start = -(restEnd + W * 0.4);
      world.rail.s = start;
      const introGeneration = generation;
      const firstSeen = [...stubs, ...strip.slice(-FIRST_VISIBLE)].map((ticket) => ticket.coverIndex);
      queue.whenReady(firstSeen, COVER_WAIT_MS).then(() => {
        if (destroyed || introGeneration !== generation || tween || script || world.rail.s !== start) return;
        tween = { kind: "ease", from: start, to: 0, start: null, duration: INTRO_MS, wind: false, done: startTease };
        wake();
      });
    }
    ready = true;
    wake();
  }

  function startTease() {
    const end = strip[strip.length - 1];
    if (!end || reducedMotion || pointer) return;
    later(() => {
      if (interacted || pointer || script || tween || strip[strip.length - 1] !== end) return;
      beginScript(end, "tease");
    }, 140);
  }

  function updateTabStops() {
    const end = strip[strip.length - 1];
    if (!stubStop || !stubs.includes(stubStop)) stubStop = stubs[stubs.length - 1] ?? null;
    for (const ticket of tickets) {
      const tabbable = ticket === end || ticket === stubStop;
      if (ticket.el.tabIndex !== (tabbable ? 0 : -1)) ticket.el.tabIndex = tabbable ? 0 : -1;
    }
  }

  function spawnRoot() {
    const root = strip[0];
    const axial = axialOf(root) - layout.W;
    const at = positionAt(axial);
    const cover = queue.usable(coverCursor);
    const ticket = makeTicket({ coverIndex: cover, number: numberCursor, x: at.x, y: at.y, a: layout.angle, mode: RAIL, before: root.el });
    if (!ticket) return false;
    coverCursor = queue.usable(cover + 1);
    numberCursor += 1;
    queue.ensure(coverCursor);
    queue.ensure(coverCursor + 1);
    ticket.z = 10 + MAX_STRIP;
    strip.unshift(ticket);
    strip.forEach((item, index) => {
      item.z = 10 + MAX_STRIP - (strip.length - 1 - index);
    });
    linkSeam(ticket, root, hashString(`${root.cover.id}:${root.number}`));
    return true;
  }

  function despawnRoot() {
    const root = strip.shift();
    const next = strip[0];
    if (root.rightSeam >= 0) world.seamAlive[root.rightSeam] = 0;
    if (next) {
      next.leftSeam = -1;
      next.leftEdge.broken.fill(0);
      next.leftEdge.gap.fill(0);
      next.leftEdge.load.fill(0);
      next.dirty = true;
    }
    coverCursor = root.coverIndex;
    numberCursor = root.number;
    discardTicket(root);
  }

  function discardTicket(ticket) {
    removeBody(world, ticket.body);
    byBody[ticket.body] = null;
    const index = tickets.indexOf(ticket);
    if (index >= 0) tickets.splice(index, 1);
    ticket.el.remove();
  }

  function maintainRoll() {
    if (!strip.length) return;
    const W = layout.W;
    const root = strip[0];
    const rootLeft = axialOf(root) - W / 2;
    if (rootLeft > -0.15 * W && strip.length < MAX_STRIP && world.mode[root.body] === RAIL) {
      if (spawnRoot()) updateTabStops();
    }
    const head = strip[0];
    const headLeft = axialOf(head) - W / 2;
    world.rail.max = strip.length >= MAX_STRIP ? world.rail.s + Math.max(0, -0.1 * W - headLeft) : Infinity;
    if (tween && tween.wind) {
      while (strip.length > 1 && axialOf(strip[0]) + W / 2 < -0.05 * W) despawnRoot();
    }
  }

  function settleStrip() {
    for (const ticket of strip) {
      if (world.mode[ticket.body] === FOLLOW) setMode(world, ticket.body, RAIL);
    }
  }

  function stripHeld() {
    const held = world.hand.body;
    if (held < 0) return false;
    const ticket = byBody[held];
    return Boolean(ticket && ticket.kind === "strip");
  }

  function settleFollowers() {
    if (stripHeld() || (script && script.ticket.kind === "strip")) return;
    let following = false;
    let awake = false;
    for (const ticket of strip) {
      if (world.mode[ticket.body] !== FOLLOW) continue;
      following = true;
      if (world.awake[ticket.body]) awake = true;
    }
    if (following && !awake) settleStrip();
    if (feedPending) runFeed();
  }

  function railLimit() {
    if (!strip.length) return world.rail.s;
    const W = layout.W;
    const rootLeft = axialOf(strip[0]) - W / 2;
    return world.rail.s + Math.max(0, -0.1 * W - rootLeft) + (MAX_STRIP - strip.length) * W;
  }

  function runFeed() {
    feedPending = false;
    settleStrip();
    if (!strip.length) return;
    const over = endRight() - layout.restEnd;
    if (over > OVER_EXTENDED) {
      startTween(world.rail.s - over, "spring");
      return;
    }
    const delta = Math.min(layout.restEnd - endRight(), railLimit() - world.rail.s);
    if (delta > 2) startTween(world.rail.s + delta, "ease");
    else finishFeedFocus();
  }

  function startTween(to, kind) {
    if (tween?.locked) return;
    settleStrip();
    const from = world.rail.s;
    if (reducedMotion) {
      tween = { kind: "ease", from, to, start: performance.now(), duration: 1, wind: to < from, done: finishFeedFocus };
    } else {
      tween = {
        kind,
        from,
        to,
        start: performance.now(),
        duration: kind === "spring" ? WIND_SPRING.settle : FEED_MS,
        wind: to < from,
        done: finishFeedFocus,
      };
    }
    wake();
  }

  function finishFeedFocus() {
    updateTabStops();
    if (!focusAfterFeed) return;
    focusAfterFeed = false;
    const end = strip[strip.length - 1];
    if (end) end.el.focus({ preventScroll: true });
  }

  function updateTween(now) {
    if (!tween) return;
    if (tween.start === null) tween.start = now + (tween.delay ?? 0);
    const elapsed = now - tween.start;
    if (elapsed < 0) {
      world.rail.driven = true;
      world.rail.s = tween.from;
      return;
    }
    const t = Math.min(1, elapsed / tween.duration);
    const progress = tween.kind === "spring" ? WIND_SPRING.at(elapsed) : easeEntrance(t);
    world.rail.driven = true;
    world.rail.s = tween.from + (tween.to - tween.from) * progress;
    world.rail.v = 0;
    if (t >= 1) {
      world.rail.s = tween.to;
      world.rail.driven = false;
      const done = tween.done;
      tween = null;
      if (done) done();
    }
  }

  function beginScript(ticket, kind) {
    const index = strip.indexOf(ticket);
    if (index < 1 || tween?.locked) return false;
    if (tween) {
      world.rail.driven = false;
      tween = null;
    }
    for (let i = index; i < strip.length; i += 1) setMode(world, strip[i].body, FOLLOW);
    bodyPose(world, ticket.body, pose);
    const { W, H } = layout;
    const variation = hashString(`${ticket.cover.id}:${ticket.number}`);
    const pile = pilePoint(variation);
    script = {
      ticket,
      kind,
      seam: ticket.leftSeam,
      start: performance.now(),
      duration: kind === "tear" ? TEAR_SCRIPT_MS : TEASE_SCRIPT_MS,
      x: pose.x,
      y: pose.y,
      a: pose.a,
      grabX: 0.42 * W,
      grabY: -0.36 * H,
      pivotX: -W / 2,
      pivotY: H / 2,
      lastX: 0,
      lastY: 0,
      vx: 0,
      vy: 0,
      twist: ((15 + ((variation >>> 4) % 7)) * Math.PI) / 180,
      flingX: kind === "tear" ? pile.x - pose.x : 0,
      flingY: kind === "tear" ? pile.y - pose.y : 0,
      pileX: pile.x,
      pileY: pile.y,
      pileA: pile.a,
      freedAt: 0,
      angle: 0,
      relaxAt: 0,
      relaxAngle: 0,
    };
    const target = scriptTarget(script, 0, script.start);
    grab(world, ticket.body, target.x, target.y, STRIP_HAND, true);
    ticket.z = 1000;
    script.lastX = target.x;
    script.lastY = target.y;
    wake();
    return true;
  }

  const scriptPoint = { x: 0, y: 0 };

  function scriptTarget(current, t, now) {
    let angle;
    let outward;
    let fling = 0;
    if (current.kind === "tear") {
      angle = current.twist * easeInOut(Math.min(1, t / 0.6));
      const pull = Math.max(0, (t - 0.3) / 0.7);
      outward = layout.W * 0.3 * easeInQuad(Math.min(1, pull)) * Math.max(1, pull);
      fling = 0.6 * easeInQuad(Math.min(1, pull));
    } else if (current.relaxAt) {
      const relax = Math.min(1, (now - current.relaxAt) / TEASE_RELAX_MS);
      angle = current.relaxAngle * (1 - TEASE_RELAX * easeEntrance(relax));
      outward = 0;
    } else {
      angle = TEASE_TWIST * easeInOut(Math.min(1, t));
      outward = 0;
    }
    current.angle = angle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = current.grabX - current.pivotX;
    const ry = current.grabY - current.pivotY;
    const localX = current.pivotX + rx * cos - ry * sin + outward;
    const localY = current.pivotY + rx * sin + ry * cos;
    const baseCos = Math.cos(current.a);
    const baseSin = Math.sin(current.a);
    scriptPoint.x = current.x + localX * baseCos - localY * baseSin + current.flingX * fling;
    scriptPoint.y = current.y + localX * baseSin + localY * baseCos + current.flingY * fling;
    return scriptPoint;
  }

  function seamBroken(seam) {
    if (seam < 0 || !world.seamAlive[seam]) return BRIDGES;
    let broken = 0;
    for (let k = 0; k < BRIDGES; k += 1) if (world.bridgeBroken[seam * BRIDGES + k]) broken += 1;
    return broken;
  }

  function updateScript(now, dt) {
    if (!script) return;
    const t = (now - script.start) / script.duration;
    const target = scriptTarget(script, Math.max(0, t), now);
    script.vx = (target.x - script.lastX) / dt;
    script.vy = (target.y - script.lastY) / dt;
    script.lastX = target.x;
    script.lastY = target.y;
    moveHand(world, target.x, target.y);
    const ticket = script.ticket;
    if (script.kind === "tease") {
      if (script.relaxAt) {
        if (now - script.relaxAt >= TEASE_RELAX_MS) endScript(false);
      } else if (seamBroken(script.seam) >= TEASE_BREAKS) {
        script.relaxAt = now;
        script.relaxAngle = script.angle;
        holdSeam(world, script.seam, TEASE_HOLD_S);
      } else if (t >= 1) {
        endScript(false);
      }
      return;
    }
    if (ticket.kind === "stub") {
      if (!script.freedAt) script.freedAt = now;
      if (now - script.freedAt >= SCRIPT_FOLLOW_THROUGH_MS) endScript(true);
      return;
    }
    if (t >= 1.6 && ticket.kind === "strip" && ticket.leftSeam >= 0) breakAll(world, ticket.leftSeam);
  }

  function endScript(fling) {
    const ticket = script.ticket;
    const { pileX, pileY, pileA } = script;
    script = null;
    release(world);
    ticket.z = ticket.kind === "stub" ? 100 + (stubSequence += 1) : 10 + MAX_STRIP;
    if (fling && world.mode[ticket.body] === FREE) {
      const body = ticket.body;
      const tau = world.linearTau[body];
      const vx = (pileX - world.x[body]) / tau;
      const vy = (pileY - world.y[body]) / tau;
      const speed = Math.hypot(vx, vy);
      const scale = speed > MAX_THROW ? MAX_THROW / speed : 1;
      world.vx[body] = vx * scale;
      world.vy[body] = vy * scale;
      const turn = Math.atan2(Math.sin(pileA - world.a[body]), Math.cos(pileA - world.a[body]));
      world.va[body] = clamp(turn / world.angularTau[body], -FLING_SPIN, FLING_SPIN);
    }
    if (!fling) settleStrip();
    if (feedPending) runFeed();
  }

  function scriptedTear() {
    const end = strip[strip.length - 1];
    if (!end || strip.length < 2 || script || pointer || tween?.locked) return;
    if (reducedMotion) {
      settleStrip();
      if (end.leftSeam >= 0) breakAll(world, end.leftSeam);
      handleEvents();
      const target = pilePoint(hashString(`${end.cover.id}:${end.number}`));
      world.x[end.body] = target.x;
      world.y[end.body] = target.y;
      world.a[end.body] = target.a;
      world.vx[end.body] = 0;
      world.vy[end.body] = 0;
      world.va[end.body] = 0;
      wake();
      return;
    }
    beginScript(end, "tear");
  }

  function pilePoint(variation = 0) {
    const { width, H, W, small, floor } = layout;
    const spread = stubs.length % 4;
    const jitterX = (((variation >>> 8) % 1000) / 1000 - 0.5) * W * 0.3;
    const jitterY = (((variation >>> 18) % 1000) / 1000 - 0.5) * H * 0.4;
    const base = small ? width * 0.5 : Math.max(width * 0.7, mouth.x + W * 0.95);
    return {
      x: clamp(base + (spread - 1.5) * W * 0.16 + jitterX, W * 0.5, width - W * 0.5),
      y: small
        ? clamp(layout.mouthY + H * (SMALL_PILE + (spread % 2) * 0.35) + jitterY, layout.mouthY + H * 1.6, floor)
        : clamp(floor - H * (spread % 2) * 0.2 + jitterY, layout.mouthY + H * 1.2, floor),
      a: (((spread % 2 ? 7 : -6) + (((variation >>> 3) % 9) - 4)) * Math.PI) / 180,
    };
  }

  function handleEvents() {
    const events = world.events;
    if (!events.length) return;
    let breaks = 0;
    let speed = 0;
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event.type === "break") {
        breaks += 1;
        speed = Math.max(speed, event.speed);
      }
    }
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event.type === "free" && world.seamAlive[event.seam]) freeSeam(event.seam);
    }
    events.length = 0;
    if (breaks >= 4) {
      sound.snap();
    } else if (breaks > 0) {
      pendingTicks += breaks;
      pendingSpeed = Math.max(pendingSpeed, speed);
    }
  }

  function flushTicks() {
    if (!pendingTicks) return;
    sound.tick(0.25 + pendingSpeed / 1400);
    pendingTicks -= 1;
    if (pendingTicks === 0) pendingSpeed = 0;
  }

  function freeSeam(seam) {
    const left = byBody[world.seamA[seam]];
    const right = byBody[world.seamB[seam]];
    detachSeam(seam);
    if (!left || !right) return;
    const rightIndex = strip.indexOf(right);
    if (rightIndex < 1 || strip[rightIndex - 1] !== left) return;
    const freed = strip.splice(rightIndex);
    for (const ticket of freed) {
      setMode(world, ticket.body, FREE);
      world.linearTau[ticket.body] = 0.25;
      world.angularTau[ticket.body] = 0.18;
      ticket.kind = "stub";
      ticket.el.dataset.kind = "stub";
      ticket.z = world.hand.body === ticket.body ? 1000 : 100 + (stubSequence += 1);
      stubs.push(ticket);
      labelTicket(ticket);
    }
    if (document.activeElement === right.el) focusAfterFeed = true;
    stubStop = right;
    count += freed.length;
    onCount?.(count);
    deck.prefetch(right.cover);
    trimStubs();
    updateTabStops();
    feedPending = true;
    if (!stripHeld() && !(script && script.ticket.kind === "strip")) runFeed();
  }

  function trimStubs() {
    while (stubs.length > MAX_STUBS) {
      const oldest = stubs.find((ticket) => world.hand.body !== ticket.body && !(script && script.ticket === ticket));
      if (!oldest) return;
      stubs.splice(stubs.indexOf(oldest), 1);
      leave(oldest);
    }
  }

  function leave(ticket) {
    if (ticket.leftSeam >= 0) detachSeam(ticket.leftSeam);
    if (ticket.rightSeam >= 0) detachSeam(ticket.rightSeam);
    removeBody(world, ticket.body);
    byBody[ticket.body] = null;
    const index = tickets.indexOf(ticket);
    if (index >= 0) tickets.splice(index, 1);
    ticket.leaving = true;
    ticket.inner.style.transform = "";
    ticket.inner.style.transformOrigin = "";
    ticket.inner.style.willChange = "";
    ticket.shadow.style.visibility = "hidden";
    if (reducedMotion) {
      ticket.el.remove();
      return;
    }
    ticket.el.dataset.leaving = "";
    leavingEls.add(ticket.el);
    later(() => {
      leavingEls.delete(ticket.el);
      ticket.el.remove();
    }, LEAVE_MS);
  }

  function onDeckStatus({ key, status }) {
    if (destroyed) return;
    const current = reader.current;
    if (key === null) {
      if (!current) announce("empty");
    } else if (current && current.id === key) {
      announce(status);
    } else {
      return;
    }
    pushTime();
    watchTime();
  }

  function announce(status) {
    if (!onDeck) return;
    const current = reader.current;
    if (!current) {
      onDeck({ id: null, cover: null, status: "empty" });
      return;
    }
    const { cover } = current;
    onDeck({ id: current.id, cover: { title: cover.title || "Untitled", artist: cover.artist || "", image: cover.image || "" }, status });
  }

  function pushTime() {
    if (!onTime) return;
    const { current, duration } = deck.time();
    onTime(current, duration);
  }

  function timeLoop() {
    timeFrame = 0;
    if (destroyed || !visible) return;
    pushTime();
    if (deck.status() === "playing") timeFrame = requestAnimationFrame(timeLoop);
  }

  function watchTime() {
    if (timeFrame || destroyed || !visible || deck.status() !== "playing") return;
    timeFrame = requestAnimationFrame(timeLoop);
  }

  function stopTime() {
    if (!timeFrame) return;
    cancelAnimationFrame(timeFrame);
    timeFrame = 0;
  }

  function setArmed(next) {
    if (reader.armed === next) return;
    reader.armed = next;
    if (mouthEl) {
      if (next) mouthEl.dataset.armed = "";
      else delete mouthEl.dataset.armed;
    }
    if (next) sound.detent();
  }

  function aimHand() {
    if (!pointer) return;
    if (pointer.ticket.kind !== "stub") {
      moveHand(world, pointer.x, pointer.y);
      return;
    }
    const { W, H } = layout;
    const body = pointer.ticket.body;
    const hand = world.hand;
    const angle = world.a[body];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const freeX = pointer.x - (hand.lx * cos - hand.ly * sin);
    const freeY = pointer.y - (hand.lx * sin + hand.ly * cos);
    const bodyReach = Math.hypot((freeX - mouth.x) / (W * MAGNET_RX), (freeY - dockY()) / (H * MAGNET_RY));
    const handReach = Math.hypot((pointer.x - hand.lx - mouth.x) / (W * MAGNET_RX), (pointer.y - hand.ly - dockY()) / (H * MAGNET_RY));
    const reach = Math.min(bodyReach, handReach);
    const gain = Math.min(1, pointer.travelled / MAGNET_TRAVEL);
    const closeness = clamp((1 - reach) / (1 - MAGNET_CORE), 0, 1);
    const magnet = closeness * closeness * (3 - 2 * closeness) * gain;
    pointer.magnet = magnet;
    const pull = magnet * MAGNET_PULL;
    const handX = pointer.x + (mouth.x + hand.lx - pointer.x) * pull;
    const handY = pointer.y + (dockY() + hand.ly - pointer.y) * pull;
    const overshoot = handY - (hand.lx * sin + hand.ly * cos) - world.bounds.maxY;
    moveHand(world, handX, overshoot > 0 ? handY - overshoot : handY);
    setArmed(gain >= 1 && reach < ARM_RADIUS);
  }

  function guideHeld(dt) {
    if (!pointer || pointer.ticket.kind !== "stub") {
      setArmed(false);
      return;
    }
    aimHand();
    const magnet = pointer.magnet;
    if (magnet <= 0) return;
    const body = pointer.ticket.body;
    const turn = Math.atan2(Math.sin(-world.a[body]), Math.cos(-world.a[body]));
    const share = 1 - Math.exp(-dt * MAGNET_TURN * magnet);
    world.a[body] += turn * share;
    world.va[body] *= 1 - share;
  }

  function setPose(ticket, x, y, a) {
    const body = ticket.body;
    world.x[body] = x;
    world.px[body] = x;
    world.y[body] = y;
    world.py[body] = y;
    world.a[body] = a;
    world.pa[body] = a;
    world.vx[body] = 0;
    world.vy[body] = 0;
    world.va[body] = 0;
    world.awake[body] = 0;
  }

  function clipTicket(ticket, y) {
    const { W, H } = layout;
    const shown = mouth.y - (y - H / 2);
    let clip = "";
    if (shown < H + CLIP_BLEED) {
      const edge = Math.max(0, shown).toFixed(2);
      clip = `polygon(${-CLIP_BLEED}px ${-CLIP_BLEED}px, ${W + CLIP_BLEED}px ${-CLIP_BLEED}px, ${W + CLIP_BLEED}px ${edge}px, ${-CLIP_BLEED}px ${edge}px)`;
    }
    if (clip === ticket.clip) return;
    ticket.clip = clip;
    ticket.el.style.clipPath = clip;
  }

  function clearClip(ticket) {
    if (!ticket.clip) return;
    ticket.clip = "";
    ticket.el.style.clipPath = "";
  }

  function markReader(ticket, phase) {
    ticket.reader.phase = phase;
    ticket.el.dataset.reader = phase;
  }

  function leaveReader(ticket) {
    ticket.reader = null;
    delete ticket.el.dataset.reader;
    clearClip(ticket);
    ticket.carry = 0;
  }

  function mouthBusy() {
    if (reader.inside) return true;
    const base = dockY();
    return reader.ejecting.some((ticket) => world.y[ticket.body] > base);
  }

  function tossSide(ticket) {
    if (!layout.small) return mouth.x > layout.width * 0.7 ? -1 : 1;
    return hashString(ticket.id) & 1 ? 1 : -1;
  }

  function returnToTable(ticket, vx, vy, va) {
    const body = ticket.body;
    world.awake[body] = 1;
    world.rest[body] = 0;
    world.vx[body] = vx;
    world.vy[body] = vy;
    world.va[body] = va;
    ticket.z = 100 + (stubSequence += 1);
    if (!stubs.includes(ticket)) stubs.push(ticket);
    labelTicket(ticket);
    trimStubs();
    updateTabStops();
    wake();
  }

  function forgetCurrent(ticket) {
    if (!reader.current || reader.current.id !== ticket.id) return;
    reader.current = null;
    deck.eject();
  }

  function feed(ticket) {
    if (destroyed || ticket.reader || ticket.kind !== "stub" || ticket.leaving) return;
    const body = ticket.body;
    if (!world.alive[body] || byBody[body] !== ticket) return;
    const index = stubs.indexOf(ticket);
    if (index >= 0) stubs.splice(index, 1);
    if (world.hand.body === body) release(world);
    const hadFocus = document.activeElement === ticket.el;
    const previous = reader.feeding;
    reader.feeding = null;
    if (previous) {
      const phase = previous.reader.phase;
      if (phase === "seat" || phase === "wait") setDown(previous);
      else startEject(previous, world.y[previous.body] - dockY(), SWAP_EJECT_MS);
    }
    if (reader.inside) ejectInside(SWAP_EJECT_MS);
    bodyPose(world, body, pose);
    const distance = Math.hypot(mouth.x - pose.x, dockY() - pose.y);
    ticket.reader = {
      phase: "seat",
      start: performance.now(),
      duration: reducedMotion || distance < 0.5 ? 0 : clamp(SEAT_MIN_MS + distance * SEAT_MS_PER_PX, SEAT_MIN_MS, SEAT_MAX_MS),
      fromX: pose.x,
      fromY: pose.y,
      fromA: pose.a,
      turn: -Math.atan2(Math.sin(pose.a), Math.cos(pose.a)),
      offset: mouthBusy() ? -WAIT_LIFT * layout.H : 0,
      catchFrom: 0,
    };
    ticket.el.dataset.reader = "seat";
    ticket.carry = reducedMotion ? 0 : clamp(distance / CARRY_DISTANCE, 0.12, 1) * CARRY_LIFT;
    ticket.z = 1000;
    setPose(ticket, pose.x, pose.y, pose.a);
    reader.feeding = ticket;
    reader.current = { id: ticket.id, cover: ticket.cover };
    deck.load(ticket.id, ticket.cover);
    if (stubStop === ticket) stubStop = null;
    updateTabStops();
    if (hadFocus) (stubStop ?? strip[strip.length - 1])?.el.focus({ preventScroll: true });
    wake();
  }

  function abortFeed(ticket) {
    if (reader.feeding === ticket) reader.feeding = null;
    leaveReader(ticket);
    world.awake[ticket.body] = 1;
    if (!stubs.includes(ticket)) stubs.push(ticket);
    forgetCurrent(ticket);
    updateTabStops();
  }

  function setDown(ticket) {
    if (reader.feeding === ticket) reader.feeding = null;
    leaveReader(ticket);
    const side = tossSide(ticket);
    returnToTable(ticket, side * SET_DOWN_X, -SET_DOWN_Y, side * TOSS_SPIN * 0.5);
  }

  function beginCatch(ticket, now) {
    const state = ticket.reader;
    state.catchFrom = state.offset;
    state.start = now;
    state.duration = reducedMotion ? 0 : state.offset < -1 ? WAIT_CATCH_MS : CATCH_MS;
    ticket.carry = 0;
    markReader(ticket, "catch");
  }

  function beginDraw(ticket, now) {
    const state = ticket.reader;
    state.start = now + (reducedMotion ? 0 : DRAW_DELAY_MS);
    state.duration = reducedMotion ? 0 : DRAW_MS;
    markReader(ticket, "draw");
    sound.clunk();
    sound.rollers(state.duration, reducedMotion ? 0 : DRAW_DELAY_MS);
  }

  function finishFeed(ticket) {
    if (reader.feeding === ticket) reader.feeding = null;
    ticket.reader = null;
    reader.inside = { id: ticket.id, coverIndex: ticket.coverIndex, number: ticket.number, left: ticket.leftEdge, right: ticket.rightEdge };
    discardTicket(ticket);
    deck.start(ticket.id);
    sound.seat();
    updateTabStops();
  }

  function stepFeed(ticket, now) {
    const state = ticket.reader;
    const { H } = layout;
    const base = dockY();
    const progress = state.duration > 0 ? clamp((now - state.start) / state.duration, 0, 1) : 1;
    let x = mouth.x;
    let y = base;
    let a = 0;
    if (state.phase === "seat") {
      const eased = easeOutQuint(progress);
      x = state.fromX + (mouth.x - state.fromX) * eased;
      y = state.fromY + (base + state.offset - state.fromY) * eased;
      a = progress >= 1 ? 0 : state.fromA + state.turn * eased;
      if (progress >= 1) {
        if (mouthBusy()) markReader(ticket, "wait");
        else beginCatch(ticket, now);
      }
    } else if (state.phase === "wait") {
      y = base + state.offset;
      if (!mouthBusy()) beginCatch(ticket, now);
    } else if (state.phase === "catch") {
      y = base + state.catchFrom + (CATCH_DEPTH * H - state.catchFrom) * easeOutQuad(progress);
      if (progress >= 1) beginDraw(ticket, now);
    } else {
      y = base + CATCH_DEPTH * H + (H + DRAW_OVERRUN - CATCH_DEPTH * H) * easeInOut(progress);
      if (progress >= 1) {
        finishFeed(ticket);
        return;
      }
    }
    setPose(ticket, x, y, a);
    clipTicket(ticket, y);
  }

  function ejectInside(pace = EJECT_MS) {
    const record = reader.inside;
    reader.inside = null;
    if (!record) return;
    forgetCurrent(record);
    const from = layout.H + DRAW_OVERRUN;
    const ticket = makeTicket({ coverIndex: record.coverIndex, number: record.number, x: mouth.x, y: dockY() + from, a: 0, mode: FREE, reuseId: record.id });
    if (!ticket) return;
    copyEdge(record.left, ticket.leftEdge);
    copyEdge(record.right, ticket.rightEdge);
    ticket.dirty = true;
    ticket.z = 100 + (stubSequence += 1);
    startEject(ticket, from, pace);
  }

  function startEject(ticket, fromOffset, pace = EJECT_MS) {
    const travel = fromOffset + EJECT_CLEAR;
    const full = layout.H + DRAW_OVERRUN + EJECT_CLEAR;
    ticket.reader = {
      phase: "eject",
      start: performance.now(),
      duration: reducedMotion ? 0 : Math.max(EJECT_MIN_MS, pace * clamp(travel / full, 0, 1)),
      fromOffset,
      side: tossSide(ticket),
    };
    ticket.el.dataset.reader = "eject";
    ticket.carry = 0;
    setPose(ticket, mouth.x, dockY() + fromOffset, 0);
    clipTicket(ticket, dockY() + fromOffset);
    if (!reader.ejecting.includes(ticket)) reader.ejecting.push(ticket);
    sound.rollers(ticket.reader.duration * 0.7);
    wake();
  }

  function stepEject(ticket, now) {
    const state = ticket.reader;
    const progress = state.duration > 0 ? clamp((now - state.start) / state.duration, 0, 1) : 1;
    const y = dockY() + state.fromOffset + (-EJECT_CLEAR - state.fromOffset) * easeOutCubic(progress);
    setPose(ticket, mouth.x, y, 0);
    clipTicket(ticket, y);
    if (progress >= 1) releaseEjected(ticket);
  }

  function releaseEjected(ticket) {
    const index = reader.ejecting.indexOf(ticket);
    if (index >= 0) reader.ejecting.splice(index, 1);
    const side = ticket.reader?.side ?? 1;
    leaveReader(ticket);
    const variation = hashString(`${ticket.id}:toss:${stubSequence}`);
    const spread = 0.85 + (((variation >>> 8) % 1000) / 1000) * 0.3;
    returnToTable(ticket, side * TOSS_X * spread, -TOSS_Y * spread, side * TOSS_SPIN * spread);
  }

  function updateReader(now) {
    for (let i = reader.ejecting.length - 1; i >= 0; i -= 1) stepEject(reader.ejecting[i], now);
    if (reader.feeding) stepFeed(reader.feeding, now);
  }

  function settleReader() {
    for (const ticket of [...reader.ejecting]) releaseEjected(ticket);
    if (reader.feeding) finishFeed(reader.feeding);
  }

  function ejectReader() {
    if (!ready || destroyed) return;
    const feeding = reader.feeding;
    if (feeding) {
      reader.feeding = null;
      const phase = feeding.reader.phase;
      if (phase === "seat" || phase === "wait") setDown(feeding);
      else startEject(feeding, world.y[feeding.body] - dockY());
      forgetCurrent(feeding);
    } else if (reader.inside) {
      ejectInside();
    }
    if (reader.current) {
      reader.current = null;
      deck.eject();
    }
    wake();
  }

  function togglePlayback() {
    if (destroyed || !reader.current) return;
    sound.unlock();
    deck.toggle();
    pushTime();
    watchTime();
  }

  function stripLevel(ticket, held) {
    const seam = ticket.leftSeam;
    if (seam < 0 || !world.seamAlive[seam]) return 0;
    let broken = 0;
    let strain = 0;
    for (let k = 0; k < BRIDGES; k += 1) {
      const q = seam * BRIDGES + k;
      if (world.bridgeBroken[q]) broken += 1;
      else strain = Math.max(strain, world.bridgeLoad[q]);
    }
    const torn = broken / BRIDGES;
    if (held) return Math.min(1, HELD_LIFT + STRAIN_LIFT * strain + TORN_LIFT * torn);
    return torn * RESTING_CURL;
  }

  function approach(current, target, dt) {
    const gap = target - current;
    if (Math.abs(gap) <= LIFT_EPSILON) return target;
    return current + gap * (1 - Math.exp(-dt / (gap > 0 ? LIFT_RISE_TAU : LIFT_FALL_TAU)));
  }

  function applyLift(ticket, angle) {
    const { lift, curlLevel, tilt, shadow, inner, curl } = ticket;
    ticket.liftApplied = lift;
    ticket.curlApplied = curlLevel;
    ticket.tiltApplied = tilt;
    if (lift > 0) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const worldX = LIFT_SHADOW_X * lift;
      const worldY = LIFT_SHADOW_Y * lift;
      const localX = worldX * cos + worldY * sin;
      const localY = -worldX * sin + worldY * cos;
      shadow.style.visibility = "visible";
      shadow.style.opacity = (LIFT_SHADOW_OPACITY * Math.min(1, lift * 1.4)).toFixed(3);
      shadow.style.transform = `translate(${localX.toFixed(2)}px, ${localY.toFixed(2)}px) scale(${(1 + LIFT_SHADOW_GROW * lift).toFixed(4)})`;
    } else {
      shadow.style.visibility = "hidden";
    }
    const degrees = reducedMotion ? 0 : tilt * LIFT_TILT;
    const scale = ticket.kind === "stub" ? 1 + STUB_LIFT_SCALE * lift : 1;
    let transform = "";
    if (degrees > 0.01) {
      if (ticket.kind === "strip") inner.style.transformOrigin = "0 50%";
      transform = `perspective(${LIFT_PERSPECTIVE}px) rotateY(${(-degrees).toFixed(3)}deg)`;
    }
    if (scale > 1.0005) transform += `${transform ? " " : ""}scale(${scale.toFixed(4)})`;
    inner.style.transform = transform;
    curl.style.opacity = curlLevel > 0 ? curlLevel.toFixed(3) : "0";
  }

  function setLayered(ticket, layered) {
    if (ticket.layered === layered) return;
    ticket.layered = layered;
    ticket.inner.style.willChange = layered ? "transform" : "";
  }

  function updateLift(ticket, dt, angle, moved) {
    const body = ticket.body;
    const held = world.hand.body === body;
    let liftTarget;
    let curlTarget;
    if (ticket.kind === "stub") {
      const speed = Math.hypot(world.vx[body], world.vy[body]);
      liftTarget = Math.max(ticket.carry, held ? 1 : world.awake[body] ? Math.min(FLIGHT_LIFT, speed / FLIGHT_SPEED) : 0);
      curlTarget = 0;
    } else {
      liftTarget = stripLevel(ticket, held);
      curlTarget = liftTarget;
    }
    const tiltTarget = held && ticket.rightSeam < 0 ? curlTarget : 0;
    ticket.lift = approach(ticket.lift, liftTarget, dt);
    ticket.curlLevel = approach(ticket.curlLevel, curlTarget, dt);
    ticket.tilt = approach(ticket.tilt, tiltTarget, dt);
    const changed =
      Math.abs(ticket.lift - ticket.liftApplied) > LIFT_EPSILON ||
      Math.abs(ticket.curlLevel - ticket.curlApplied) > LIFT_EPSILON ||
      Math.abs(ticket.tilt - ticket.tiltApplied) > LIFT_EPSILON ||
      (ticket.lift === 0 && ticket.liftApplied !== 0) ||
      (ticket.curlLevel === 0 && ticket.curlApplied !== 0) ||
      (ticket.tilt === 0 && ticket.tiltApplied !== 0) ||
      (moved && ticket.lift > 0);
    const settled = ticket.lift === liftTarget && ticket.curlLevel === curlTarget && ticket.tilt === tiltTarget;
    setLayered(ticket, !settled || held);
    if (changed) applyLift(ticket, angle);
    return settled;
  }

  function render(dt) {
    for (let seam = 0; seam < SEAM_CAPACITY; seam += 1) {
      if (!world.seamAlive[seam] || !world.seamDirty[seam]) continue;
      world.seamDirty[seam] = 0;
      const left = byBody[world.seamA[seam]];
      const right = byBody[world.seamB[seam]];
      if (left) left.dirty = true;
      if (right) right.dirty = true;
    }
    let anyMoving = false;
    const { W, H } = layout;
    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i];
      bodyPose(world, ticket.body, pose);
      const moved =
        Math.abs(pose.x - ticket.lastX) > 0.005 || Math.abs(pose.y - ticket.lastY) > 0.005 || Math.abs(pose.a - ticket.lastA) > 0.00002 || Number.isNaN(ticket.lastX);
      if (moved) {
        ticket.lastX = pose.x;
        ticket.lastY = pose.y;
        ticket.lastA = pose.a;
        ticket.el.style.transform = `translate3d(${(pose.x - W / 2).toFixed(2)}px, ${(pose.y - H / 2).toFixed(2)}px, 0) rotate(${pose.a.toFixed(5)}rad)`;
        ticket.still = 0;
        if (!ticket.moving) {
          ticket.moving = true;
          ticket.el.dataset.moving = "";
        }
      } else if (ticket.moving) {
        ticket.still += 1;
        if (ticket.still > STILL_FRAMES) {
          ticket.moving = false;
          delete ticket.el.dataset.moving;
        }
      }
      if (ticket.moving) anyMoving = true;
      if (!updateLift(ticket, dt, pose.a, moved)) anyMoving = true;
      if (ticket.z !== ticket.zApplied) {
        ticket.zApplied = ticket.z;
        ticket.el.style.zIndex = String(ticket.z);
      }
      if (ticket.dirty) {
        ticket.dirty = false;
        if (ticket.leftSeam >= 0) copySeam(ticket.leftEdge, ticket.leftSeam, false);
        if (ticket.rightSeam >= 0) copySeam(ticket.rightEdge, ticket.rightSeam, true);
        paperPaths(W, H, ticket.leftEdge, ticket.rightEdge, ticket.leftSeam >= 0, ticket.rightSeam >= 0, ticket.paperSeed, paths);
        ticket.outline.setAttribute("d", paths.fill);
        ticket.line.setAttribute("d", paths.line);
        ticket.core.setAttribute("d", paths.torn);
        ticket.torn.setAttribute("d", paths.torn);
        ticket.fibres.setAttribute("d", paths.fibres);
      }
    }
    spinRoll();
    return anyMoving;
  }

  function tick(now) {
    frame = 0;
    if (destroyed || !visible || !onscreen) return;
    const dt = clamp((now - last) / 1000, 1 / 240, 1 / 30);
    last = now;
    updateTween(now);
    updateScript(now, dt);
    guideHeld(dt);
    updateReader(now);
    const awake = step(world, dt);
    handleEvents();
    flushTicks();
    settleFollowers();
    maintainRoll();
    const moving = render(dt);
    const busy =
      awake ||
      moving ||
      world.hand.body >= 0 ||
      tween ||
      script ||
      pendingTicks > 0 ||
      feedPending ||
      reader.feeding ||
      reader.ejecting.length > 0 ||
      Math.abs(world.rail.v) > 0.01;
    if (busy) frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (frame || destroyed || !visible || !onscreen || !ready) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function stagePoint(event) {
    return { x: event.clientX - pointer.left, y: event.clientY - pointer.top };
  }

  function pushSample(time, x, y) {
    samples.copyWithin(3, 0, 45);
    samples[0] = time;
    samples[1] = x;
    samples[2] = y;
  }

  function releaseVelocity(now) {
    let oldest = -1;
    for (let i = 0; i < 16; i += 1) {
      const time = samples[i * 3];
      if (!time || now - time > RELEASE_WINDOW_MS) break;
      oldest = i;
    }
    if (oldest < 1) return { x: 0, y: 0 };
    const span = Math.max(16, samples[0] - samples[oldest * 3]);
    const vx = ((samples[1] - samples[oldest * 3 + 1]) / span) * 1000;
    const vy = ((samples[2] - samples[oldest * 3 + 2]) / span) * 1000;
    const speed = Math.hypot(vx, vy);
    const scale = speed > MAX_THROW ? MAX_THROW / speed : 1;
    return { x: vx * scale, y: vy * scale };
  }

  function onPointerDown(event) {
    if (pointer || !ready || event.button > 0) return;
    const el = event.target.closest?.("[data-ticket]");
    if (!el || !stage.contains(el)) return;
    const ticket = tickets.find((item) => item.el === el);
    if (!ticket || ticket.leaving) return;
    if (tween?.locked && ticket.kind === "strip") return;
    if (ticket.reader) {
      if (ticket.reader.phase !== "seat" && ticket.reader.phase !== "wait") return;
      abortFeed(ticket);
    }
    interacted = true;
    sound.unlock();
    deck.prime();
    if (script) {
      if (script.kind !== "tease") return;
      const teased = script.seam;
      endScript(false);
      if (teased >= 0 && world.seamAlive[teased]) world.seamCooldown[teased] = 0;
    }
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    pointer = {
      id: event.pointerId,
      ticket,
      left: rect.left,
      top: rect.top,
      downX: event.clientX,
      downY: event.clientY,
      downAt: event.timeStamp,
      travelled: 0,
      tore: count,
      preloaded: -1,
      x: 0,
      y: 0,
      magnet: 0,
    };
    const point = stagePoint(event);
    pointer.x = point.x;
    pointer.y = point.y;
    samples.fill(0);
    pushSample(event.timeStamp, point.x, point.y);
    if (ticket.el.dataset.enter !== undefined) delete ticket.el.dataset.enter;
    if (ticket.kind === "stub") {
      grab(world, ticket.body, point.x, point.y, STUB_HAND, false);
      ticket.z = 1000;
      bodyPose(world, ticket.body, pose);
      ticket.inner.style.transformOrigin = `${(world.hand.lx + layout.W / 2).toFixed(1)}px ${(world.hand.ly + layout.H / 2).toFixed(1)}px`;
      deck.prefetch(ticket.cover);
    } else {
      const index = strip.indexOf(ticket);
      if (tween) {
        world.rail.driven = false;
        tween = null;
      }
      if (index === 0) {
        grab(world, ticket.body, point.x, point.y, STRIP_HAND, false);
      } else {
        for (let i = index; i < strip.length; i += 1) setMode(world, strip[i].body, FOLLOW);
        grab(world, ticket.body, point.x, point.y, STRIP_HAND, true);
        ticket.z = 10 + MAX_STRIP + 1;
        pointer.preloaded = ticket.leftSeam;
        setPreload(world, ticket.leftSeam, PRESS_PRELOAD);
      }
      deck.prefetch(ticket.cover);
    }
    ticket.el.dataset.held = "";
    try {
      ticket.el.setPointerCapture(event.pointerId);
    } catch {
      pointer.captureFailed = true;
    }
    wake();
  }

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const point = stagePoint(event);
    pointer.travelled = Math.max(pointer.travelled, Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY));
    pushSample(event.timeStamp, point.x, point.y);
    pointer.x = point.x;
    pointer.y = point.y;
    aimHand();
    wake();
  }

  function onPointerUp(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    sound.unlock();
    deck.prime();
    const { ticket } = pointer;
    const tap = pointer.travelled < TAP_SLOP && event.timeStamp - pointer.downAt < 350 && pointer.tore === count;
    const armed = ticket.kind === "stub" && reader.armed;
    const velocity = releaseVelocity(event.timeStamp);
    if (pointer.preloaded >= 0) setPreload(world, pointer.preloaded, 0);
    pointer = null;
    setArmed(false);
    delete ticket.el.dataset.held;
    if (ticket.el.hasPointerCapture?.(event.pointerId)) ticket.el.releasePointerCapture(event.pointerId);
    const body = ticket.body;
    release(world);
    if (world.alive[body] && world.mode[body] === FREE && byBody[body] === ticket) {
      if (ticket.kind === "stub" && (armed || tap)) {
        feed(ticket);
      } else {
        if (!tap) {
          world.vx[body] = velocity.x;
          world.vy[body] = velocity.y;
          world.va[body] = clamp(world.va[body], -MAX_SPIN, MAX_SPIN);
        }
        world.awake[body] = 1;
        ticket.z = 100 + (stubSequence += 1);
      }
    } else if (ticket.kind === "strip") {
      ticket.z = 10 + MAX_STRIP;
      feedPending = true;
    }
    if (feedPending) runFeed();
    wake();
  }

  function onKeyDown(event) {
    const el = event.target.closest?.("[data-ticket]");
    if (!el || !ready) return;
    const ticket = tickets.find((item) => item.el === el);
    if (!ticket || ticket.reader) return;
    interacted = true;
    sound.unlock();
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      deck.prime();
      if (ticket.kind === "strip" && ticket === strip[strip.length - 1]) {
        focusAfterFeed = true;
        scriptedTear();
      } else if (ticket.kind === "stub") {
        feed(ticket);
      }
      return;
    }
    if (ticket.kind === "stub") {
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!direction || !stubs.length) return;
      event.preventDefault();
      const index = stubs.indexOf(ticket);
      const next = stubs[(Math.max(0, index) + direction + stubs.length) % stubs.length];
      stubStop = next;
      updateTabStops();
      next.el.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Backspace" || event.key === "ArrowLeft") {
      event.preventDefault();
      windBack();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      feedOne();
    }
  }

  function windBack() {
    if (script || pointer || !strip.length || tween?.locked) return;
    const current = endRight();
    const extended = current - layout.restEnd;
    let delta = extended > 4 ? -extended : -layout.W;
    if (current + delta < layout.W * 0.6) delta = layout.W * 0.6 - current;
    if (delta > -2) return;
    focusAfterFeed = document.activeElement === strip[strip.length - 1]?.el;
    startTween(world.rail.s + delta, "spring");
  }

  function feedOne() {
    if (script || pointer || !strip.length || tween?.locked) return;
    const current = endRight();
    const room = layout.width / Math.cos(layout.angle) - layout.mouthX - current;
    const delta = Math.min(layout.W, room - 8, railLimit() - world.rail.s);
    if (delta < 2) return;
    focusAfterFeed = document.activeElement === strip[strip.length - 1]?.el;
    startTween(world.rail.s + delta, "ease");
  }

  function newRoll() {
    if (!ready) return;
    const firstCover = maxCover + 1;
    settleReader();
    script = null;
    pointer = null;
    release(world);
    const leaving = [...stubs];
    stubs = [];
    leaving.forEach((ticket, index) => {
      if (reducedMotion || index === 0) {
        leave(ticket);
        return;
      }
      later(() => {
        if (!ticket.leaving && tickets.includes(ticket)) leave(ticket);
      }, index * 30);
    });
    for (const ticket of tickets) delete ticket.el.dataset.held;
    count = 0;
    onCount?.(0);
    const rebuild = () => {
      for (const ticket of [...strip]) discardTicket(ticket);
      strip = [];
      buildRoll({ withStubs: false, firstNumber: 1, firstCover, intro: true });
    };
    if (reducedMotion || !strip.length) {
      rebuild();
      return;
    }
    settleStrip();
    const delta = -(endRight() + layout.W * 0.3);
    tween = { kind: "ease", from: world.rail.s, to: world.rail.s + delta, start: performance.now(), duration: 620, wind: false, locked: true, done: rebuild };
    wake();
  }

  function reanchor(previous) {
    const along = layout.restEnd - previous.restEnd;
    const shiftX = layout.mouthX - previous.mouthX + layout.ux * along;
    const shiftY = layout.mouthY - previous.mouthY + layout.uy * along;
    for (const ticket of strip) {
      const body = ticket.body;
      if (world.mode[body] === RAIL) {
        world.railX[body] += shiftX;
        world.railY[body] += shiftY;
      } else {
        world.x[body] += shiftX;
        world.y[body] += shiftY;
        world.px[body] += shiftX;
        world.py[body] += shiftY;
      }
    }
    if (script && script.ticket.kind === "strip") {
      script.x += shiftX;
      script.y += shiftY;
    }
    const { bounds } = world;
    for (const ticket of stubs) {
      const body = ticket.body;
      const x = clamp(world.x[body], bounds.minX, bounds.maxX);
      const y = clamp(world.y[body], bounds.minY, bounds.maxY);
      world.x[body] = x;
      world.px[body] = x;
      world.y[body] = y;
      world.py[body] = y;
    }
    wake();
  }

  function keptStubs(previous) {
    const { bounds } = world;
    return stubs.map((ticket) => {
      if (ticket.leftSeam >= 0) detachSeam(ticket.leftSeam);
      if (ticket.rightSeam >= 0) detachSeam(ticket.rightSeam);
      bodyPose(world, ticket.body, pose);
      return {
        id: ticket.id,
        coverIndex: ticket.coverIndex,
        number: ticket.number,
        x: clamp((pose.x / previous.width) * layout.width, bounds.minX, bounds.maxX),
        y: clamp((pose.y / previous.height) * layout.height, bounds.minY, bounds.maxY),
        a: pose.a,
        z: ticket.z,
        left: ticket.leftEdge,
        right: ticket.rightEdge,
      };
    });
  }

  function rebuildKeeping(previous) {
    settleReader();
    const end = strip[strip.length - 1];
    const stopId = stubStop ? stubStop.id : null;
    const kept = keptStubs(previous);
    buildRoll({
      kept,
      endEdge: end ? end.rightEdge : null,
      firstNumber: end ? end.number : numberCursor,
      firstCover: end ? end.coverIndex : coverCursor,
      intro: false,
    });
    const restoredStop = stubs.find((ticket) => ticket.id === stopId);
    if (restoredStop) {
      stubStop = restoredStop;
      updateTabStops();
    }
  }

  function resize(width, height) {
    if (destroyed || width < 1 || height < 1) return;
    const widthChanged = Math.abs(width - layout.width) > 1;
    const heightChanged = Math.abs(height - layout.height) > 120;
    if (!widthChanged && !heightChanged) {
      layout.height = height;
      measureMouth();
      updateBounds();
      liftOffPlayer();
      wake();
      return;
    }
    const previous = { W: layout.W, mouthX: layout.mouthX, mouthY: layout.mouthY, restEnd: layout.restEnd, width: layout.width, height: layout.height };
    computeLayout(width, height);
    if (!ready) return;
    if (layout.W === previous.W) {
      reanchor(previous);
      return;
    }
    const untouched = !interacted && count === INITIAL_TORN && stubs.length === INITIAL_TORN && !reader.inside && !reader.feeding;
    if (untouched) {
      buildRoll({ withStubs: true, firstNumber: FIRST_NUMBER, firstCover: 0, intro: true });
      return;
    }
    rebuildKeeping(previous);
  }

  const resizeObserver = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect;
    clearTimeout(resizeTimer);
    if (!layout.width) {
      resize(box.width, box.height);
      return;
    }
    resizeTimer = setTimeout(() => resize(box.width, box.height), 140);
  });

  function pauseLoops() {
    stopTime();
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function resumeLoops() {
    wake();
    pushTime();
    watchTime();
  }

  const intersection = new IntersectionObserver((entries) => {
    onscreen = entries[entries.length - 1].isIntersecting;
    if (onscreen) resumeLoops();
    else pauseLoops();
  });

  function onVisibility() {
    visible = !document.hidden;
    if (visible) resumeLoops();
    else pauseLoops();
  }

  function onLostCapture(event) {
    if (pointer && event.pointerId === pointer.id && !pointer.captureFailed) onPointerUp(event);
  }

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);
  stage.addEventListener("lostpointercapture", onLostCapture);
  stage.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibility);
  resizeObserver.observe(stage);
  intersection.observe(stage);

  computeLayout(stage.clientWidth, stage.clientHeight);
  buildRoll({ withStubs: true, firstNumber: FIRST_NUMBER, firstCover: 0, intro: true });

  return {
    setSound(next) {
      sound.setEnabled(next);
      deck.setMuted(!next);
    },
    setReducedMotion(next) {
      reducedMotion = next;
    },
    newRoll,
    eject: ejectReader,
    togglePlayback,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      stopTime();
      clearTimeout(resizeTimer);
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      resizeObserver.disconnect();
      intersection.disconnect();
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      stage.removeEventListener("lostpointercapture", onLostCapture);
      stage.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      sound.destroy();
      deck.destroy();
      if (mouthEl) delete mouthEl.dataset.armed;
      queue.dispose();
      for (const ticket of tickets) ticket.el.remove();
      tickets.length = 0;
      leavingEls.forEach((el) => el.remove());
      leavingEls.clear();
      roll.remove();
      defsSvg.remove();
    },
  };
}
