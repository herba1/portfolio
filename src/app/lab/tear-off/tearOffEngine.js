import { createCoverQueue } from "./coverQueue";
import { easeEntrance, easeInOut, easeInQuad, springProgress } from "./motion";
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
const NARROW_AXIS = (-14 * Math.PI) / 180;
const MAX_STRIP = 6;
const MAX_STUBS = 8;
const BODY_CAPACITY = 16;
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
const TEASE_RELAX = 0.4;
const TEASE_RELAX_MS = 260;
const TEASE_HOLD_S = 0.32;
const PRESS_PRELOAD = 0.22;
const COVER_WAIT_MS = 600;
const FIRST_VISIBLE = 3;
const FLING_SPIN = 4;
const SCRIPT_FOLLOW_THROUGH_MS = 90;
const TEASE_BREAKS = 2;
const ROLL_LINES = 18;
const LEAVE_MS = 280;
const STILL_FRAMES = 8;
const FIRST_NUMBER = 14;
const INITIAL_TORN = 2;
const SPIN_LINE_INSET = 6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

function div(className, text) {
  const node = document.createElement("div");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createTearOff(stage, { covers, onCount, reducedMotion: initialReduced = false }) {
  const world = createWorld(BODY_CAPACITY, SEAM_CAPACITY);
  const queue = createCoverQueue(covers);
  const sound = createTearSound();
  const byBody = new Array(BODY_CAPACITY).fill(null);
  const tickets = [];
  const timers = new Set();
  const pose = { x: 0, y: 0, a: 0 };
  const samples = new Float64Array(48);
  const layout = { width: 0, height: 0, W: 0, H: 0, D: 0, mouthX: 0, mouthY: 0, restEnd: 0, small: false, angle: WIDE_AXIS, ux: 1, uy: 0 };
  const paths = { fill: "", line: "" };

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
  let soundOn = true;
  let reducedMotion = initialReduced;
  let playingTicket = null;
  let progressFrame = 0;
  let stubStop = null;
  let lastRollS = Number.NaN;
  let ticketId = 0;
  let generation = 0;
  let resizeTimer = 0;
  let pendingTicks = 0;
  let pendingSpeed = 0;

  const roll = div("to-roll");
  roll.setAttribute("aria-hidden", "true");
  const rollSvg = svg("svg", { class: "to-roll__svg" });
  const rollRect = svg("rect", { class: "to-roll__body" });
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
  rollSvg.append(rollDefs, rollRect, rollLineGroup);
  roll.appendChild(rollSvg);
  stage.appendChild(roll);

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
    const rawW = small ? clamp(width * 0.44, 168, 196) : clamp((width - 120) / 3.4, 220, 320);
    const W = Math.round(rawW / 2) * 2;
    const H = Math.round((W * 0.42) / 4) * 4;
    const D = Math.round(H * 1.12);
    const mouthX = Math.round(small ? Math.max(16, D * 0.36) : Math.min(width * 0.06 + 24, D * 0.55));
    const mouthY = Math.round(small ? Math.max(176 + H, height * 0.3) : Math.max(184 + H / 2, height * 0.42));
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
    updateBounds();
    stage.dataset.size = small ? "sm" : "lg";
    stage.style.setProperty("--to-w", `${W}px`);
    stage.style.setProperty("--to-h", `${H}px`);
    drawRoll();
  }

  function updateBounds() {
    world.bounds.minX = layout.W * 0.12;
    world.bounds.maxX = layout.width - layout.W * 0.12;
    world.bounds.minY = 64 + layout.H * 0.2;
    world.bounds.maxY = layout.height - layout.H * 0.4;
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

  function makeTicket({ coverIndex, number, x, y, a, mode }) {
    const entry = queue.get(coverIndex);
    const cover = entry?.cover ?? { id: `blank-${number}`, title: "Untitled", artist: "", image: "" };
    const { W, H, small } = layout;
    const body = addBody(world, { x, y, a, halfW: W / 2, halfH: H / 2, mode });
    if (body < 0) return null;
    const id = `t${(ticketId += 1)}`;
    const el = div("to-ticket");
    el.dataset.ticket = id;
    el.dataset.kind = mode === FREE ? "stub" : "strip";
    el.style.width = `${W}px`;
    el.style.height = `${H}px`;
    el.style.setProperty("--to-tint", entry?.tint ?? "rgb(246 246 243)");
    el.tabIndex = -1;
    el.setAttribute("role", "button");
    const inner = div("to-ticket__body");
    const paper = svg("svg", { class: "to-ticket__paper", width: String(W), height: String(H), viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    const path = svg("path", { class: "to-ticket__fill" });
    const line = svg("path", { class: "to-ticket__line" });
    paper.append(path, line);
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
    ink.appendChild(svg("path", { d: bars }));
    const play = svg("svg", { class: "to-ticket__bars to-ticket__bars--play", width: String(codeWidth), height: String(codeHeight), viewBox: `0 0 ${codeWidth} ${codeHeight}`, "aria-hidden": "true" });
    play.appendChild(svg("path", { d: bars }));
    code.append(ink, play);
    face.append(well, text, code);
    inner.append(paper, face);
    el.appendChild(inner);
    stage.appendChild(el);

    const ticket = {
      id,
      body,
      el,
      inner,
      path,
      line,
      code,
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
    };
    byBody[body] = ticket;
    tickets.push(ticket);
    maxCover = Math.max(maxCover, coverIndex);
    if (entry && !queue.isReady(coverIndex)) {
      const built = generation;
      queue.ensure(coverIndex).then((loaded) => {
        if (destroyed || built !== generation || !loaded) return;
        el.style.setProperty("--to-tint", loaded.tint);
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
      ticket.kind === "strip" ? `${name}. Enter tears it off, Backspace winds the roll back.` : `${name}. Torn stub. Enter plays a preview, arrow keys move through the pile.`,
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
    sound.stop();
    playingTicket = null;
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

  function buildRoll({ withStubs, firstNumber, firstCover, intro }) {
    clearScene();
    const { W, H, restEnd, small, width, height } = layout;
    let cover = queue.usable(firstCover);
    if (withStubs) {
      const piles = small
        ? [
            [width * 0.36, height - H * 1.7, -9],
            [width * 0.64, height - H * 1.35, 6],
          ]
        : [
            [width * 0.62, height - H * 1.05, -8],
            [width * 0.79, height - H * 0.8, 5],
          ];
      piles.forEach(([x, y, degrees], index) => {
        const stub = makeTicket({ coverIndex: cover, number: firstNumber - 2 + index, x, y, a: (degrees * Math.PI) / 180, mode: FREE });
        cover = queue.usable(cover + 1);
        if (!stub) return;
        tearEdge(stub.leftEdge, hashString(`${stub.cover.id}l`));
        tearEdge(stub.rightEdge, hashString(`${stub.cover.id}r`));
        stub.kind = "stub";
        stub.z = 100 + (stubSequence += 1);
        world.awake[stub.body] = 0;
        stubs.push(stub);
        if (intro && !reducedMotion) {
          stub.el.dataset.enter = "";
          stub.el.style.setProperty("--to-delay", `${60 + index * 90}ms`);
          stub.el.addEventListener("animationend", () => delete stub.el.dataset.enter, { once: true });
        }
      });
    }
    world.rail.s = 0;
    const built = [];
    let center = restEnd - W / 2;
    let number = firstNumber;
    while (built.length < MAX_STRIP) {
      const at = positionAt(center);
      const ticket = makeTicket({ coverIndex: cover, number, x: at.x, y: at.y, a: layout.angle, mode: RAIL });
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
    if (end && withStubs) tearEdge(end.rightEdge, hashString(`${end.cover.id}end`));
    coverCursor = cover;
    numberCursor = number;
    queue.ensure(coverCursor);
    queue.ensure(coverCursor + 1);
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
    const ticket = makeTicket({ coverIndex: cover, number: numberCursor, x: at.x, y: at.y, a: layout.angle, mode: RAIL });
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
    if (playingTicket === ticket) {
      sound.stop();
      playingTicket = null;
    }
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
    const delta = Math.min(layout.restEnd - endRight(), railLimit() - world.rail.s);
    if (delta > 2) startTween(world.rail.s + delta, "ease");
    else finishFeedFocus();
  }

  function startTween(to, kind) {
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
    if (index < 1) return false;
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
    if (!end || strip.length < 2 || script || pointer) return;
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
    const { width, height, H, W, small } = layout;
    const spread = stubs.length % 4;
    const jitterX = (((variation >>> 8) % 1000) / 1000 - 0.5) * W * 0.3;
    const jitterY = (((variation >>> 18) % 1000) / 1000 - 0.5) * H * 0.4;
    return {
      x: clamp(width * (small ? 0.5 : 0.7) + (spread - 1.5) * W * 0.16 + jitterX, W * 0.5, width - W * 0.5),
      y: clamp(height - H * ((small ? 1.5 : 1) + (spread % 2) * 0.2) + jitterY, layout.mouthY + H * 1.2, height - H * 0.6),
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
    startPreview(right);
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
    if (playingTicket === ticket) {
      sound.stop();
      playingTicket = null;
    }
    removeBody(world, ticket.body);
    byBody[ticket.body] = null;
    const index = tickets.indexOf(ticket);
    if (index >= 0) tickets.splice(index, 1);
    ticket.leaving = true;
    if (reducedMotion) {
      ticket.el.remove();
      return;
    }
    ticket.el.dataset.leaving = "";
    later(() => ticket.el.remove(), LEAVE_MS);
  }

  function startPreview(ticket) {
    if (!soundOn || !interacted) return;
    if (playingTicket && playingTicket !== ticket) delete playingTicket.el.dataset.playing;
    playingTicket = ticket;
    ticket.el.dataset.playing = "";
    ticket.code.style.setProperty("--to-play", "0");
    sound.play(ticket.id, ticket.cover, () => {
      delete ticket.el.dataset.playing;
      ticket.code.style.setProperty("--to-play", "0");
      if (playingTicket === ticket) playingTicket = null;
    });
    watchProgress();
  }

  function trackProgress() {
    progressFrame = 0;
    if (destroyed || !playingTicket || !visible || !onscreen) return;
    const progress = sound.progress(playingTicket.id);
    if (progress >= 0) playingTicket.code.style.setProperty("--to-play", progress.toFixed(4));
    progressFrame = requestAnimationFrame(trackProgress);
  }

  function watchProgress() {
    if (progressFrame || destroyed || !playingTicket || !visible || !onscreen) return;
    progressFrame = requestAnimationFrame(trackProgress);
  }

  function stopWatchingProgress() {
    if (!progressFrame) return;
    cancelAnimationFrame(progressFrame);
    progressFrame = 0;
  }

  function togglePreview(ticket) {
    if (playingTicket === ticket) {
      sound.stop();
      return;
    }
    startPreview(ticket);
  }

  function render() {
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
      if (ticket.z !== ticket.zApplied) {
        ticket.zApplied = ticket.z;
        ticket.el.style.zIndex = String(ticket.z);
      }
      if (ticket.dirty) {
        ticket.dirty = false;
        if (ticket.leftSeam >= 0) copySeam(ticket.leftEdge, ticket.leftSeam, false);
        if (ticket.rightSeam >= 0) copySeam(ticket.rightEdge, ticket.rightSeam, true);
        paperPaths(W, H, ticket.leftEdge, ticket.rightEdge, ticket.leftSeam >= 0, ticket.rightSeam >= 0, paths);
        ticket.path.setAttribute("d", paths.fill);
        ticket.line.setAttribute("d", paths.line);
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
    const awake = step(world, dt);
    handleEvents();
    flushTicks();
    settleFollowers();
    maintainRoll();
    const moving = render();
    const busy =
      awake || moving || world.hand.body >= 0 || tween || script || pendingTicks > 0 || feedPending || Math.abs(world.rail.v) > 0.01;
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
    interacted = true;
    sound.unlock();
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
    };
    const point = stagePoint(event);
    samples.fill(0);
    pushSample(event.timeStamp, point.x, point.y);
    if (ticket.el.dataset.enter !== undefined) delete ticket.el.dataset.enter;
    if (ticket.kind === "stub") {
      grab(world, ticket.body, point.x, point.y, STUB_HAND, false);
      ticket.z = 1000;
      bodyPose(world, ticket.body, pose);
      ticket.inner.style.transformOrigin = `${(world.hand.lx + layout.W / 2).toFixed(1)}px ${(world.hand.ly + layout.H / 2).toFixed(1)}px`;
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
      sound.prefetch(ticket.cover);
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
    moveHand(world, point.x, point.y);
    wake();
  }

  function onPointerUp(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { ticket } = pointer;
    const tap = pointer.travelled < TAP_SLOP && event.timeStamp - pointer.downAt < 350 && pointer.tore === count;
    const velocity = releaseVelocity(event.timeStamp);
    if (pointer.preloaded >= 0) setPreload(world, pointer.preloaded, 0);
    pointer = null;
    delete ticket.el.dataset.held;
    if (ticket.el.hasPointerCapture?.(event.pointerId)) ticket.el.releasePointerCapture(event.pointerId);
    const body = ticket.body;
    release(world);
    if (world.alive[body] && world.mode[body] === FREE && byBody[body] === ticket) {
      if (!tap) {
        world.vx[body] = velocity.x;
        world.vy[body] = velocity.y;
        world.va[body] = clamp(world.va[body], -MAX_SPIN, MAX_SPIN);
      }
      world.awake[body] = 1;
      ticket.z = 100 + (stubSequence += 1);
      if (tap && ticket.kind === "stub") togglePreview(ticket);
    } else if (ticket.kind === "strip") {
      ticket.z = 10 + MAX_STRIP;
      feedPending = true;
    }
    sound.resumePending();
    if (feedPending) runFeed();
    wake();
  }

  function onKeyDown(event) {
    const el = event.target.closest?.("[data-ticket]");
    if (!el || !ready) return;
    const ticket = tickets.find((item) => item.el === el);
    if (!ticket) return;
    interacted = true;
    sound.unlock();
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (ticket.kind === "strip" && ticket === strip[strip.length - 1]) {
        focusAfterFeed = true;
        scriptedTear();
      } else if (ticket.kind === "stub") {
        togglePreview(ticket);
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
    if (script || pointer || !strip.length) return;
    const current = endRight();
    const extended = current - layout.restEnd;
    let delta = extended > 4 ? -extended : -layout.W;
    if (current + delta < layout.W * 0.6) delta = layout.W * 0.6 - current;
    if (delta > -2) return;
    focusAfterFeed = document.activeElement === strip[strip.length - 1]?.el;
    startTween(world.rail.s + delta, "spring");
  }

  function feedOne() {
    if (script || pointer || !strip.length) return;
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
    sound.stop();
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
    tween = { kind: "ease", from: world.rail.s, to: world.rail.s + delta, start: performance.now(), duration: 620, wind: false, done: rebuild };
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

  function resize(width, height) {
    if (destroyed || width < 1 || height < 1) return;
    const widthChanged = Math.abs(width - layout.width) > 1;
    const heightChanged = Math.abs(height - layout.height) > 120;
    if (!widthChanged && !heightChanged) {
      layout.height = height;
      updateBounds();
      return;
    }
    const previous = { W: layout.W, mouthX: layout.mouthX, mouthY: layout.mouthY, restEnd: layout.restEnd };
    computeLayout(width, height);
    if (!ready) return;
    if (layout.W === previous.W) {
      reanchor(previous);
      return;
    }
    const firstCover = interacted ? Math.max(0, coverCursor - strip.length - 2) : 0;
    buildRoll({ withStubs: true, firstNumber: FIRST_NUMBER, firstCover, intro: !interacted });
    count = INITIAL_TORN;
    onCount?.(count);
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
    stopWatchingProgress();
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function resumeLoops() {
    wake();
    watchProgress();
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
      soundOn = next;
      sound.setEnabled(next);
      if (!next && playingTicket) {
        delete playingTicket.el.dataset.playing;
        playingTicket = null;
        stopWatchingProgress();
      }
    },
    setReducedMotion(next) {
      reducedMotion = next;
    },
    newRoll,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      stopWatchingProgress();
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
      queue.dispose();
      for (const ticket of tickets) ticket.el.remove();
      tickets.length = 0;
      roll.remove();
    },
  };
}
