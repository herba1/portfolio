import {
  CALM_WAVE_DAMPING,
  SETTLE_WAVE_DAMPING,
  WAVE_DAMPING,
  WAVE_SPEED,
  addBump,
  addPin,
  addPulse,
  clearPins,
  clearString,
  createString,
  nodeY,
  sampleString,
  stepString,
} from "./threadPhysics";

export const ROW_HEIGHT = 56;
export const LIST_PAD_TOP = 12;
export const LIST_PAD_BOTTOM = 20;
export const EMPTY_HEIGHT = 112;

const THREAD_X = 36;
const BEAD_CENTER = ROW_HEIGHT / 2;
const TOP_ANCHOR = 4;
const BOTTOM_ANCHOR_GAP = 8;
const NODES_PER_ROW = 4;

const SPRING_STIFFNESS = 380;
const SPRING_DAMPING = 24;
const CALM_SPRING_DAMPING = 39;
const SPRING_SUBSTEPS = 4;

const SWAY = 0.6;
const SWAY_CAP = 14;
const PULL_CAP = 14;
const LEFT_REACH = 52;
const TENT_HALF = 28;
const TENT_GROWTH = 0.4;
const TENT_HALF_MAX = 80;
const MAX_PLUCK = 42;

const REMOVE_FRACTION = 0.35;
const FLICK_SPEED = 0.55;
const RETRACT_SPEED = -0.15;
const RELEASE_WINDOW_MS = 90;
const FLY_MS = 260;
const CALM_FLY_MS = 180;
const FLY_SCALE = 0.88;
const CLOSE_DELAY_MS = 70;
const CLOSE_STAGGER_MS = ((1000 * ROW_HEIGHT) / WAVE_SPEED) * 0.6;

const LONG_PRESS_MS = 220;
const TOUCH_LONG_PRESS_MS = 380;
const AXIS_LOCK_PX = 8;
const LIFT_X = 16;
const LIFT_SCALE = 1.02;
const PRESS_SCALE = 0.985;
const LIFT_OVERSCROLL = 20;
const EDGE_SCROLL_ZONE = 72;

const HOVER_REACH = 48;
const HOVER_BOW = 6;
const HOVER_SIGMA = 60;
const BEAD_PROXIMITY = 26;

const REVEAL_MS = 520;
const INTRO_PULSE = 12;
const INTRO_PULSE_WIDTH = 34;
const FLY_PULSE_OFFSET = 20;
const FLY_PULSE_WIDTH = 34;
const FLY_PULSE_MIN = 14;
const FLY_PULSE_MAX = 24;
const INTRO_ROW_DELAY_MS = 80;
const INTRO_CATCH_UP = 0.25;
const REFILL_STAGGER_MS = 40;
const ENTER_DISTANCE = 0.42;

const REST_DISPLACEMENT = 0.05;
const REST_SPEED = 2;
const SETTLE_PEAK = 1;
const SHEET_OVERSHOOT = 24;
const SAMPLE_SLOTS = 8;
const MAX_BEADS = 32;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutQuart(t) {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse * inverse;
}

function easeOutCubic(t) {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

function rubber(distance, reach) {
  return reach * (1 - Math.exp(-distance / reach));
}

function approach(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function springTowards(row, key, velocityKey, target, dt, damping) {
  let position = row[key];
  let velocity = row[velocityKey];
  if (position === target && velocity === 0) return false;
  const step = dt / SPRING_SUBSTEPS;
  for (let pass = 0; pass < SPRING_SUBSTEPS; pass += 1) {
    velocity += (-SPRING_STIFFNESS * (position - target) - damping * velocity) * step;
    position += velocity * step;
  }
  if (Math.abs(position - target) < 0.03 && Math.abs(velocity) < 0.3) {
    position = target;
    velocity = 0;
  }
  row[key] = position;
  row[velocityKey] = velocity;
  return true;
}

export function listHeight(capacity) {
  return LIST_PAD_TOP + Math.max(1, capacity) * ROW_HEIGHT + LIST_PAD_BOTTOM;
}

function rowTop(index) {
  return LIST_PAD_TOP + index * ROW_HEIGHT;
}

function now() {
  return performance.now();
}

export function createThreadEngine() {
  const rows = new Map();
  const beadYs = new Float64Array(MAX_BEADS);
  let pointX = new Float64Array(64);
  let pointY = new Float64Array(64);

  let handlers = {};
  let string = createString(NODES_PER_ROW * 10 + 1);
  let order = [];
  let root = null;
  let list = null;
  let canvas = null;
  let context = null;
  let sheet = null;
  let head = null;
  let mounted = false;
  let introStarted = false;
  let introFrames = 0;
  let revealStart = -1;
  let revealProgress = 0;
  let introPulsePending = false;
  let calm = false;
  let calmQuery = null;
  let resizeObserver = null;
  let intersectionObserver = null;
  let onscreen = true;
  let frame = 0;
  let lastTime = 0;
  let stringAwake = false;
  let pendingClose = 0;
  let pendingCloseIndex = -1;
  let tail = 0;
  let tailVelocity = 0;
  let tailTarget = 0;
  let tailDelayUntil = 0;
  let width = 400;
  let height = 600;
  let listPageX = 0;
  let listPageY = 0;
  let pageScrollX = 0;
  let pageScrollY = 0;
  let stringPeak = Infinity;
  let dpr = 1;
  let threadInk = "#1a1a1a";
  let gesture = null;
  const hover = { active: false, x: 0, y: 0 };
  let bow = 0;
  let bowY = 0;
  let lastSheetOffset = NaN;
  let tailPrimed = false;
  const tailState = { tail: 0, tailVelocity: 0 };

  function damping() {
    return calm ? CALM_SPRING_DAMPING : SPRING_DAMPING;
  }

  function bowAt(y) {
    if (bow === 0) return 0;
    const offset = y - bowY;
    return bow * Math.exp(-(offset * offset) / (2 * HOVER_SIGMA * HOVER_SIGMA));
  }

  function emit(name, ...values) {
    const handler = handlers[name];
    if (handler) handler(...values);
  }

  function pluckSound(amplitude) {
    emit("onPluck", amplitude, string.bottom - string.top);
  }

  function excite() {
    stringAwake = true;
    stringPeak = Infinity;
  }

  function wake() {
    if (frame || !mounted || !onscreen) return;
    if (typeof document !== "undefined" && document.hidden) return;
    lastTime = now();
    frame = requestAnimationFrame(tick);
  }

  function createRow(id, li, image) {
    const row = {
      id,
      li,
      body: li.querySelector("[data-part='body']"),
      bead: li.querySelector("[data-part='bead']"),
      main: li.querySelector("[data-part='main']"),
      reveal: li.querySelector("[data-part='reveal']"),
      label: li.querySelector("[data-part='label']"),
      index: -1,
      y: 0,
      vy: 0,
      ty: 0,
      x: 0,
      vx: 0,
      slide: 0,
      slideVelocity: 0,
      scale: 1,
      opacity: 1,
      attach: 0,
      tent: 0,
      mode: introStarted ? "enter" : "intro",
      threaded: !introStarted,
      fresh: true,
      pinned: false,
      coverWant: 0,
      pinTarget: 0,
      gestureDx: 0,
      liftX: 0,
      liftTarget: 0,
      flyStart: 0,
      flyVelocity: 0,
      coverX: 0,
      textX: 0,
      frozenCover: 0,
      frozenText: 0,
      beadScale: 1,
      armed: false,
      settling: false,
      delayUntil: 0,
      dead: false,
      image: null,
      written: { y: NaN, slide: NaN, scale: NaN, opacity: NaN, cover: NaN, beadScale: NaN, text: NaN, exposed: -1, revealOpacity: NaN, label: NaN, armed: false },
    };
    if (row.mode === "enter") {
      li.dataset.late = "true";
      row.opacity = 0;
      row.scale = calm ? 0.98 : FLY_SCALE;
      row.slide = calm ? 0 : width * ENTER_DISTANCE;
    }
    loadImage(row, image);
    return row;
  }

  function loadImage(row, src) {
    if (!src || !row.bead) return;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    row.image = image;
    const apply = (ok) => {
      if (row.dead || row.image !== image) return;
      row.bead.dataset.state = ok ? "loaded" : "failed";
    };
    const settle = (ok) => {
      if (row.dead || row.image !== image) return;
      requestAnimationFrame(() => requestAnimationFrame(() => apply(ok)));
    };
    if (image.decode) image.decode().then(() => settle(true), () => settle(image.complete && image.naturalWidth > 0));
    else {
      image.onload = () => settle(true);
      image.onerror = () => settle(false);
    }
  }

  function registerRow(id, li, image) {
    const row = createRow(id, li, image);
    rows.set(id, row);
    return () => {
      row.dead = true;
      row.image = null;
      if (rows.get(id) === row) rows.delete(id);
      if (gesture && gesture.row === row) endGesture();
    };
  }

  function setOrder(ids) {
    order = ids;
    const time = now();
    const delay = pendingClose;
    const gapIndex = pendingCloseIndex;
    pendingClose = 0;
    pendingCloseIndex = -1;
    let lastDelay = delay;
    let freshCount = 0;
    ids.forEach((id, index) => {
      const row = rows.get(id);
      if (!row) return;
      row.index = index;
      const target = rowTop(index);
      if (row.fresh) {
        row.fresh = false;
        row.ty = target;
        row.y = target;
        if (row.mode !== "intro") {
          row.delayUntil = time + freshCount * REFILL_STAGGER_MS;
          freshCount += 1;
        }
        writeRow(row, 0, 0);
        return;
      }
      if (row.mode === "fly" || row.mode === "gone") {
        row.slide += row.frozenCover;
        row.mode = "enter";
        row.threaded = false;
        row.coverX = 0;
        row.textX = 0;
        row.y = target;
        row.vy = 0;
      }
      if (row.ty !== target) {
        row.ty = target;
        if (delay && row.mode !== "lift" && row.vy === 0) {
          const rowsBelowGap = gapIndex >= 0 ? Math.max(0, index - gapIndex) : 0;
          const rowDelay = delay + (calm ? 0 : rowsBelowGap * CLOSE_STAGGER_MS);
          row.delayUntil = time + rowDelay;
          if (rowDelay > lastDelay) lastDelay = rowDelay;
        }
      }
    });
    tailTarget = ids.length ? ids.length * ROW_HEIGHT : EMPTY_HEIGHT;
    if (!tailPrimed) {
      tail = tailTarget;
      tailVelocity = 0;
      tailPrimed = true;
    } else if (delay) tailDelayUntil = time + lastDelay;
    wake();
  }

  function measure() {
    if (!list || !canvas) return;
    width = list.clientWidth;
    height = list.clientHeight;
    pageScrollX = window.scrollX;
    pageScrollY = window.scrollY;
    const rect = list.getBoundingClientRect();
    listPageX = rect.left + pageScrollX;
    listPageY = rect.top + pageScrollY;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    lastSheetOffset = NaN;
    for (const row of rows.values()) row.written.exposed = -1;
    draw();
    wake();
  }

  function readInk() {
    if (!root) return;
    const value = getComputedStyle(root).getPropertyValue("--thread-ink").trim();
    if (value) threadInk = value;
  }

  function onVisibility() {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    wake();
  }

  function onCalmChange(event) {
    calm = event.matches;
  }

  function onScroll() {
    pageScrollX = window.scrollX;
    pageScrollY = window.scrollY;
  }

  function introClock() {
    if (!list) return 0;
    const body = list.querySelector(".thread-row__body");
    if (!body || !body.getAnimations) return 0;
    for (const animation of body.getAnimations()) {
      if (animation.animationName !== "thread-row-drop") continue;
      const elapsed = Number(animation.currentTime);
      return Number.isFinite(elapsed) ? elapsed : 0;
    }
    return 0;
  }

  function startIntro() {
    introFrames = requestAnimationFrame(() => {
      introFrames = requestAnimationFrame(() => {
        introFrames = 0;
        if (!mounted) return;
        introStarted = true;
        for (const row of rows.values()) if (row.mode === "intro") row.mode = "rest";
        const behind = clamp(introClock() - INTRO_ROW_DELAY_MS, 0, REVEAL_MS * INTRO_CATCH_UP);
        revealStart = now() - behind;
        revealProgress = calm ? 1 : 0;
        introPulsePending = !calm;
        wake();
      });
    });
  }

  function mount(elements) {
    root = elements.root;
    list = elements.list;
    canvas = elements.canvas;
    sheet = elements.sheet;
    head = elements.head;
    if (!root || !list || !canvas) return;
    string = createString(NODES_PER_ROW * Math.max(1, elements.capacity) + 1);
    context = canvas.getContext("2d");
    mounted = true;
    calmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    calm = calmQuery.matches;
    calmQuery.addEventListener("change", onCalmChange);
    readInk();
    list.addEventListener("pointerdown", onPointerDown);
    list.addEventListener("pointermove", onPointerMove);
    list.addEventListener("pointerup", onPointerUp);
    list.addEventListener("pointercancel", onPointerCancel);
    list.addEventListener("pointerleave", onPointerLeave);
    list.addEventListener("touchmove", onTouchMove, { passive: false });
    list.addEventListener("contextmenu", onContextMenu);
    list.addEventListener("mousedown", onMouseDown);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("scroll", onScroll, { passive: true });
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(list);
    resizeObserver.observe(root);
    if (head) resizeObserver.observe(head);
    intersectionObserver = new IntersectionObserver((entries) => {
      onscreen = entries[entries.length - 1].isIntersecting;
      if (onscreen) wake();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    intersectionObserver.observe(root);
    measure();
    startIntro();
  }

  function destroy() {
    mounted = false;
    introStarted = false;
    if (frame) cancelAnimationFrame(frame);
    if (introFrames) cancelAnimationFrame(introFrames);
    frame = 0;
    introFrames = 0;
    introPulsePending = false;
    revealStart = -1;
    revealProgress = 0;
    if (gesture) window.clearTimeout(gesture.timer);
    gesture = null;
    if (calmQuery) calmQuery.removeEventListener("change", onCalmChange);
    if (list) {
      list.removeEventListener("pointerdown", onPointerDown);
      list.removeEventListener("pointermove", onPointerMove);
      list.removeEventListener("pointerup", onPointerUp);
      list.removeEventListener("pointercancel", onPointerCancel);
      list.removeEventListener("pointerleave", onPointerLeave);
      list.removeEventListener("touchmove", onTouchMove);
      list.removeEventListener("contextmenu", onContextMenu);
      list.removeEventListener("mousedown", onMouseDown);
    }
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("scroll", onScroll);
    if (resizeObserver) resizeObserver.disconnect();
    if (intersectionObserver) intersectionObserver.disconnect();
    resizeObserver = null;
    intersectionObserver = null;
    if (root) delete root.dataset.gesture;
    context = null;
  }

  function rowFromEvent(event) {
    const target = event.target;
    if (!target || !target.closest) return null;
    const li = target.closest("[data-thread-row]");
    if (!li || !list.contains(li)) return null;
    return rows.get(li.dataset.threadRow) || null;
  }

  function isGrabbable(row) {
    return row && (row.mode === "rest" || row.mode === "intro") && row.threaded;
  }

  function onPointerDown(event) {
    if (gesture) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const row = rowFromEvent(event);
    if (!isGrabbable(row)) return;
    emit("onGesture", row.id);
    const onHandle = Boolean(event.target.closest("[data-thread-handle]"));
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      row,
      kind: "pending",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      grabX: row.coverX,
      sampleTime: new Float64Array(SAMPLE_SLOTS),
      sampleValue: new Float64Array(SAMPLE_SLOTS),
      sampleCount: 0,
      timer: 0,
      rowStart: 0,
      docStart: 0,
      slot: row.index,
    };
    if (event.pointerType !== "touch") {
      try {
        list.setPointerCapture(event.pointerId);
      } catch {}
    }
    hover.active = false;
    if (onHandle) {
      event.preventDefault();
      startLift(gesture);
    } else {
      const pending = gesture;
      pending.timer = window.setTimeout(() => {
        if (gesture === pending && pending.kind === "pending") startLift(pending);
      }, event.pointerType === "touch" ? TOUCH_LONG_PRESS_MS : LONG_PRESS_MS);
    }
    wake();
  }

  function pushSample(active, time, value) {
    const slot = active.sampleCount % SAMPLE_SLOTS;
    active.sampleTime[slot] = time;
    active.sampleValue[slot] = value;
    active.sampleCount += 1;
  }

  function releaseVelocity(active) {
    const count = Math.min(active.sampleCount, SAMPLE_SLOTS);
    if (count < 2) return 0;
    const newest = (active.sampleCount - 1) % SAMPLE_SLOTS;
    const newestTime = active.sampleTime[newest];
    let oldest = newest;
    for (let back = 1; back < count; back += 1) {
      const slot = (newest - back + SAMPLE_SLOTS) % SAMPLE_SLOTS;
      if (newestTime - active.sampleTime[slot] > RELEASE_WINDOW_MS) break;
      oldest = slot;
    }
    if (oldest === newest) return 0;
    const span = Math.max(16, newestTime - active.sampleTime[oldest]);
    return (active.sampleValue[newest] - active.sampleValue[oldest]) / span;
  }

  function swipeOffset(total) {
    return total >= 0 ? total : -rubber(-total, LEFT_REACH);
  }

  function onPointerMove(event) {
    if (!gesture && event.pointerType === "mouse") {
      hover.active = true;
      hover.x = event.clientX + pageScrollX - listPageX;
      hover.y = event.clientY + pageScrollY - listPageY;
      wake();
      return;
    }
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId) return;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.kind === "pending") {
      if (dx * dx + dy * dy < AXIS_LOCK_PX * AXIS_LOCK_PX) return;
      window.clearTimeout(active.timer);
      if (Math.abs(dx) > Math.abs(dy)) startSwipe(active);
      else {
        endGesture();
        return;
      }
    }
    if (active.kind === "swipe") {
      const total = active.grabX + dx;
      active.row.gestureDx = swipeOffset(total);
      pushSample(active, event.timeStamp, total);
      wake();
    } else if (active.kind === "lift") wake();
  }

  function startSwipe(active) {
    active.kind = "swipe";
    const row = active.row;
    row.mode = "swipe";
    row.pinned = true;
    row.gestureDx = row.coverX;
    root.dataset.gesture = "swipe";
  }

  function startLift(active) {
    window.clearTimeout(active.timer);
    active.kind = "lift";
    const row = active.row;
    row.mode = "lift";
    row.pinned = true;
    row.liftX = row.coverX;
    row.liftTarget = LIFT_X;
    row.vy = 0;
    active.rowStart = row.y;
    active.docStart = active.lastY + window.scrollY;
    active.slot = row.index;
    row.li.dataset.lifted = "true";
    row.li.dataset.settling = "true";
    root.dataset.gesture = "lift";
    if (navigator.vibrate) navigator.vibrate(8);
    wake();
  }

  function endGesture() {
    if (!gesture) return;
    window.clearTimeout(gesture.timer);
    try {
      if (list && list.hasPointerCapture(gesture.pointerId)) list.releasePointerCapture(gesture.pointerId);
    } catch {}
    gesture = null;
    if (root) delete root.dataset.gesture;
  }

  function onPointerUp(event) {
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId) return;
    emit("onGesture", active.row.id);
    if (active.kind === "swipe") releaseSwipe(active, releaseVelocity(active));
    else if (active.kind === "lift") dropLift(active);
    else emit("onTap", active.row.id);
    endGesture();
    wake();
  }

  function onPointerCancel(event) {
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "swipe") releaseSwipe(active, 0, true);
    else if (active.kind === "lift") dropLift(active);
    endGesture();
    wake();
  }

  function onPointerLeave(event) {
    if (event.pointerType !== "mouse") return;
    hover.active = false;
    wake();
  }

  function onTouchMove(event) {
    if (gesture && gesture.kind !== "pending" && event.cancelable) event.preventDefault();
  }

  function onMouseDown(event) {
    if (rowFromEvent(event)) event.preventDefault();
  }

  function onContextMenu(event) {
    if (gesture) event.preventDefault();
  }

  function releaseSwipe(active, velocity, cancelled = false) {
    const row = active.row;
    const reach = row.gestureDx;
    const pull = sampleString(string, row.y + BEAD_CENTER);
    row.pinned = false;
    excite();
    const thrown = reach > width * REMOVE_FRACTION && velocity > RETRACT_SPEED;
    const flicked = velocity > FLICK_SPEED && reach > 16;
    if (!cancelled && (thrown || flicked)) {
      fly(row, Math.max(velocity, 0.7), pull);
      return;
    }
    row.mode = "rest";
    row.vx = clamp(velocity, -3, 3) * 1000;
    pluckSound(Math.abs(pull) * 0.7 + Math.min(12, Math.abs(row.x) * 0.05));
  }

  function fly(row, velocity, pull) {
    const beadY = row.y + BEAD_CENTER;
    const flick = clamp(FLY_PULSE_MIN + velocity * 8, FLY_PULSE_MIN, FLY_PULSE_MAX);
    const room = Math.max(0, MAX_PLUCK - Math.abs(pull));
    addPulse(string, beadY + FLY_PULSE_OFFSET, Math.min(flick, room), FLY_PULSE_WIDTH);
    excite();
    row.frozenCover = row.coverX;
    row.frozenText = row.textX;
    row.tent = row.threaded ? row.x : 0;
    row.mode = "fly";
    row.threaded = false;
    row.pinned = false;
    row.flyStart = now();
    row.flyVelocity = velocity;
    row.armed = false;
    pendingClose = CLOSE_DELAY_MS;
    pendingCloseIndex = row.index;
    if (navigator.vibrate) navigator.vibrate(6);
    pluckSound(Math.abs(pull) + flick);
    emit("onRemove", row.id);
  }

  function dropLift(active) {
    const row = active.row;
    row.mode = "rest";
    row.pinned = false;
    row.ty = rowTop(active.slot);
    row.vy = 0;
    const beadY = row.y + BEAD_CENTER;
    row.x = row.coverX - sampleString(string, beadY) - bowAt(beadY) - tentsAt(beadY, row);
    row.vx = 0;
    row.settling = true;
    delete row.li.dataset.lifted;
    excite();
    pluckSound(Math.abs(row.liftX) + 6);
    if (active.slot !== row.index) {
      const next = order.filter((id) => id !== row.id);
      next.splice(active.slot, 0, row.id);
      emit("onReorder", next, row.id);
    }
  }

  function updateLift(active, dt) {
    const row = active.row;
    const viewport = window.innerHeight;
    if (active.lastY < EDGE_SCROLL_ZONE) window.scrollBy(0, -Math.ceil((EDGE_SCROLL_ZONE - active.lastY) * 0.2));
    else if (active.lastY > viewport - EDGE_SCROLL_ZONE) window.scrollBy(0, Math.ceil((active.lastY - viewport + EDGE_SCROLL_ZONE) * 0.2));
    const count = order.length;
    const lowest = rowTop(0);
    const highest = rowTop(Math.max(0, count - 1));
    let y = active.rowStart + (active.lastY + window.scrollY - active.docStart);
    if (y < lowest) y = lowest - rubber(lowest - y, LIFT_OVERSCROLL);
    if (y > highest) y = highest + rubber(y - highest, LIFT_OVERSCROLL);
    row.y = y;
    row.liftTarget = LIFT_X + clamp((active.lastX - active.startX) * 0.3, -12, 24);
    row.liftX = approach(row.liftX, row.liftTarget, 20, dt);
    const slot = clamp(Math.round((y - LIST_PAD_TOP) / ROW_HEIGHT), 0, Math.max(0, count - 1));
    if (slot !== active.slot) {
      active.slot = slot;
      let position = 0;
      for (const id of order) {
        if (id === row.id) continue;
        if (position === slot) position += 1;
        const other = rows.get(id);
        if (other) other.ty = rowTop(position);
        position += 1;
      }
      if (navigator.vibrate) navigator.vibrate(3);
    }
  }

  function updateFly(row, time) {
    const duration = calm ? CALM_FLY_MS : FLY_MS;
    const t = clamp((time - row.flyStart) / duration, 0, 1);
    if (calm) {
      row.slide = 0;
      row.scale = 1 - 0.03 * t;
      row.opacity = 1 - t;
    } else {
      const distance = width + 24;
      const start = Math.min(row.flyVelocity, (1.9 * distance) / duration);
      const accel = (2 * (distance - start * duration)) / (duration * duration);
      const elapsed = t * duration;
      row.slide = start * elapsed + 0.5 * accel * elapsed * elapsed;
      row.scale = 1 - (1 - FLY_SCALE) * easeOutCubic(t);
      row.opacity = 1 - smoothstep(0.45, 1, t);
    }
    if (t >= 1) {
      row.mode = "gone";
      row.opacity = 0;
      emit("onExited", row.id);
    }
  }

  function updateEnter(row, time, dt) {
    if (time < row.delayUntil) return;
    row.opacity = approach(row.opacity, 1, 14, dt);
    row.scale = approach(row.scale, 1, 16, dt);
    if (calm) {
      row.slide = 0;
      if (row.opacity > 0.995) {
        row.opacity = 1;
        row.scale = 1;
        row.mode = "rest";
        row.threaded = true;
      }
      return;
    }
    springTowards(row, "slide", "slideVelocity", 0, dt, SPRING_DAMPING);
    if (row.slide <= 1.5) {
      row.mode = "rest";
      row.threaded = true;
      row.x = row.slide;
      row.vx = row.slideVelocity;
      row.slide = 0;
      row.slideVelocity = 0;
      addBump(string, row.y + BEAD_CENTER, 16, 42);
      excite();
      pluckSound(16);
    }
  }

  function tick(time) {
    frame = 0;
    if (!mounted) return;
    const dt = clamp(time - lastTime, 0, 48) / 1000;
    lastTime = time;
    let busy = false;

    if (revealStart >= 0 && revealProgress < 1) {
      busy = true;
      const elapsed = clamp((time - revealStart) / REVEAL_MS, 0, 1);
      revealProgress = elapsed >= 1 ? 1 : easeOutQuart(elapsed);
    }
    if (introPulsePending) {
      busy = true;
      const firstBead = LIST_PAD_TOP + BEAD_CENTER;
      const tip = string.top + (string.bottom - string.top) * revealProgress;
      if (tip >= firstBead) {
        introPulsePending = false;
        addPulse(string, firstBead, INTRO_PULSE, INTRO_PULSE_WIDTH);
        excite();
      }
    }

    const active = gesture;
    if (active && active.kind === "lift") updateLift(active, dt);
    if (active) busy = true;

    if (time >= tailDelayUntil) {
      tailState.tail = tail;
      tailState.tailVelocity = tailVelocity;
      if (springTowards(tailState, "tail", "tailVelocity", tailTarget, dt, damping())) busy = true;
      tail = tailState.tail;
      tailVelocity = tailState.tailVelocity;
    } else busy = true;
    string.top = TOP_ANCHOR;
    string.bottom = LIST_PAD_TOP + tail + BOTTOM_ANCHOR_GAP;

    clearPins(string);
    for (const row of rows.values()) {
      if (row.mode === "gone") continue;
      if (row.mode !== "lift") {
        if (time < row.delayUntil) busy = true;
        else if (springTowards(row, "y", "vy", row.ty, dt, damping())) busy = true;
      }
      if (row.mode === "fly") {
        updateFly(row, time);
        row.tent *= Math.exp(-dt / 0.035);
        busy = true;
        continue;
      }
      if (row.mode === "enter") {
        updateEnter(row, time, dt);
        busy = true;
        continue;
      }
      if (row.mode === "swipe") {
        row.coverWant = row.gestureDx;
        row.pinTarget = PULL_CAP * Math.tanh(row.gestureDx / PULL_CAP);
      } else if (row.mode === "lift") {
        row.coverWant = row.liftX;
        row.pinTarget = row.liftX;
      } else if (springTowards(row, "x", "vx", 0, dt, damping())) busy = true;
      if (row.pinned) addPin(string, row.y + BEAD_CENTER, row.pinTarget);
      const attachTarget = row.pinned ? 1 : 0;
      if (row.attach !== attachTarget) {
        row.attach = approach(row.attach, attachTarget, row.pinned ? 30 : 9, dt);
        if (Math.abs(row.attach - attachTarget) < 0.002) row.attach = attachTarget;
        busy = true;
      }
      const pressing = active && active.row === row && active.kind === "pending";
      const scaleTarget = row.mode === "lift" ? LIFT_SCALE : pressing ? PRESS_SCALE : 1;
      if (row.scale !== scaleTarget) {
        row.scale = approach(row.scale, scaleTarget, pressing ? 10 : 18, dt);
        if (Math.abs(row.scale - scaleTarget) < 0.0005) row.scale = scaleTarget;
        busy = true;
      }
      if (row.settling && row.mode === "rest" && row.y === row.ty && row.vy === 0) {
        row.settling = false;
        delete row.li.dataset.settling;
      }
    }

    if (stringAwake || string.pinCount) {
      const waveDamping = calm ? CALM_WAVE_DAMPING : stringPeak < SETTLE_PEAK && !string.pinCount ? SETTLE_WAVE_DAMPING : WAVE_DAMPING;
      stringPeak = stepString(string, dt, waveDamping);
      if (stringPeak < REST_DISPLACEMENT && string.peakSpeed < REST_SPEED && !string.pinCount) {
        clearString(string);
        stringPeak = Infinity;
        stringAwake = false;
      } else {
        stringAwake = true;
        busy = true;
      }
    }

    let bowTarget = 0;
    if (hover.active && !active) {
      const offset = hover.x - THREAD_X;
      const reach = Math.abs(offset);
      if (reach < HOVER_REACH) bowTarget = Math.sign(offset) * HOVER_BOW * Math.min(1, reach / 20) * (1 - smoothstep(HOVER_REACH * 0.6, HOVER_REACH, reach));
      bowY = bow === 0 ? hover.y : approach(bowY, hover.y, 20, dt);
    }
    if (bow !== bowTarget) {
      bow = approach(bow, bowTarget, 14, dt);
      if (Math.abs(bow - bowTarget) < 0.01) bow = bowTarget;
      busy = true;
    }

    for (const row of rows.values()) {
      if (!row.pinned || !row.threaded || row.mode === "fly" || row.mode === "gone") continue;
      const beadY = row.y + BEAD_CENTER;
      row.x = row.coverWant - (sampleString(string, beadY) + bowAt(beadY) + tentsAt(beadY, row));
    }

    for (const row of rows.values()) {
      if (row.mode === "gone") {
        writeRow(row, row.frozenCover, row.frozenText);
        continue;
      }
      if (row.mode === "fly") {
        writeRow(row, row.frozenCover, row.frozenText);
        continue;
      }
      if (!row.threaded) {
        row.coverX = 0;
        row.textX = 0;
        writeRow(row, 0, 0);
        continue;
      }
      const beadY = row.y + BEAD_CENTER;
      const ride = sampleString(string, beadY) + bowAt(beadY) + tentsAt(beadY, row);
      const sway = calm ? 0 : clamp(ride * SWAY, -SWAY_CAP, SWAY_CAP);
      row.coverX = ride + row.x;
      row.textX = row.x + sway + (ride - sway) * row.attach;
      let proximity = 1;
      if (hover.active && !active) {
        const dx = hover.x - (THREAD_X + row.coverX);
        const dy = hover.y - beadY;
        proximity = 1 + 0.06 * Math.exp(-(dx * dx + dy * dy) / (2 * BEAD_PROXIMITY * BEAD_PROXIMITY));
      }
      if (row.beadScale !== proximity) {
        row.beadScale = approach(row.beadScale, proximity, 16, dt);
        if (Math.abs(row.beadScale - proximity) < 0.0005) row.beadScale = proximity;
        else busy = true;
      }
      if (row.mode === "swipe") {
        const armed = row.gestureDx > width * REMOVE_FRACTION;
        if (armed !== row.armed) {
          row.armed = armed;
          if (armed && navigator.vibrate) navigator.vibrate(4);
        }
      } else row.armed = false;
      writeRow(row, row.coverX, row.textX);
    }

    writeSheet();
    draw();

    if (busy || stringAwake || gesture) wake();
  }

  function writeSheet() {
    if (!sheet) return;
    const offset = Math.min(SHEET_OVERSHOOT, LIST_PAD_TOP + tail + LIST_PAD_BOTTOM - height);
    const next = Math.round(offset * 10) / 10;
    if (next === lastSheetOffset) return;
    lastSheetOffset = next;
    sheet.style.transform = `translate3d(0, ${next}px, 0)`;
  }

  function writeRow(row, cover, text) {
    const written = row.written;
    const y = Math.round(row.y * 100) / 100;
    const slide = Math.round(row.slide * 100) / 100;
    const scale = Math.round(row.scale * 10000) / 10000;
    const opacity = Math.round(row.opacity * 1000) / 1000;
    const coverX = Math.round(cover * 100) / 100;
    const beadScale = Math.round(row.beadScale * 10000) / 10000;
    const textX = Math.round(text * 100) / 100;
    const moved = y !== written.y;
    if (row.body && (moved || slide !== written.slide || scale !== written.scale)) {
      written.slide = slide;
      written.scale = scale;
      row.body.style.transform = `translate3d(${slide}px, ${y}px, 0) scale(${scale})`;
    }
    if (row.body && opacity !== written.opacity) {
      written.opacity = opacity;
      row.body.style.opacity = String(opacity);
    }
    if (row.bead && (coverX !== written.cover || beadScale !== written.beadScale)) {
      written.cover = coverX;
      written.beadScale = beadScale;
      row.bead.style.transform = `translate3d(${coverX}px, 0, 0) scale(${beadScale})`;
    }
    if (row.main && textX !== written.text) {
      written.text = textX;
      row.main.style.transform = `translate3d(${textX}px, 0, 0)`;
    }
    written.y = y;
    if (!row.reveal) return;
    if (moved) row.reveal.style.transform = `translate3d(0, ${y}px, 0)`;
    const revealBox = Math.max(0, width - 16);
    const opened = row.mode === "fly" || row.mode === "gone" || row.x > 0.5;
    const exposed = opened ? clamp(Math.round(cover + row.slide + 4), 0, revealBox) : 0;
    if (exposed !== written.exposed) {
      if (exposed <= 0) row.reveal.style.visibility = "hidden";
      else {
        if (written.exposed <= 0) row.reveal.style.visibility = "visible";
        row.reveal.style.clipPath = `inset(0 ${revealBox - exposed}px 0 0 round 12px)`;
      }
      written.exposed = exposed;
    }
    const revealOpacity = row.mode === "fly" || row.mode === "gone" ? opacity : 1;
    if (revealOpacity !== written.revealOpacity) {
      written.revealOpacity = revealOpacity;
      row.reveal.style.opacity = String(revealOpacity);
    }
    const reach = row.mode === "swipe" ? row.gestureDx : cover;
    const label = Math.round(smoothstep(28, 96, reach) * 1000) / 1000;
    if (row.label && label !== written.label) {
      written.label = label;
      row.label.style.opacity = String(label);
    }
    if (row.armed !== written.armed) {
      written.armed = row.armed;
      row.reveal.dataset.armed = row.armed ? "true" : "false";
    }
  }

  function tentsAt(y, skip = null) {
    let total = 0;
    for (const row of rows.values()) {
      if (row === skip) continue;
      const amplitude = row.mode === "fly" ? row.tent : row.threaded && row.mode !== "gone" ? row.x : 0;
      if (amplitude > -0.01 && amplitude < 0.01) continue;
      const half = clamp(TENT_HALF + TENT_GROWTH * Math.abs(amplitude), TENT_HALF, TENT_HALF_MAX);
      const distance = Math.abs(y - (row.y + BEAD_CENTER));
      if (distance >= half) continue;
      total += amplitude * (0.5 + 0.5 * Math.cos((Math.PI * distance) / half));
    }
    return total;
  }

  function threadXAt(y) {
    return THREAD_X + sampleString(string, y) + bowAt(y) + tentsAt(y);
  }

  function ensurePoints(size) {
    if (pointX.length >= size) return;
    pointX = new Float64Array(size * 2);
    pointY = new Float64Array(size * 2);
  }

  function draw() {
    if (!context || !canvas) return;
    const top = string.top;
    const bottom = string.bottom;
    let beadCount = 0;
    for (const row of rows.values()) {
      if (!row.threaded || row.mode === "gone" || row.mode === "fly" || beadCount >= MAX_BEADS) continue;
      const y = row.y + BEAD_CENTER;
      if (y <= top + 3 || y >= bottom - 3) continue;
      let slot = beadCount;
      while (slot > 0 && beadYs[slot - 1] > y) {
        beadYs[slot] = beadYs[slot - 1];
        slot -= 1;
      }
      beadYs[slot] = y;
      beadCount += 1;
    }
    for (const row of rows.values()) {
      if (row.mode !== "fly" || Math.abs(row.tent) < 0.01 || beadCount >= MAX_BEADS) continue;
      const y = row.y + BEAD_CENTER;
      if (y <= top + 3 || y >= bottom - 3) continue;
      let slot = beadCount;
      while (slot > 0 && beadYs[slot - 1] > y) {
        beadYs[slot] = beadYs[slot - 1];
        slot -= 1;
      }
      beadYs[slot] = y;
      beadCount += 1;
    }
    ensurePoints(string.count + beadCount + 2);
    let count = 0;
    let bead = 0;
    let lastY = -Infinity;
    for (let index = 0; index < string.count; index += 1) {
      const y = nodeY(string, index);
      const isEnd = index === 0 || index === string.count - 1;
      while (index > 0 && bead < beadCount && beadYs[bead] <= y + 3) {
        const beadY = beadYs[bead];
        if (beadY > lastY + 0.5 && beadY < bottom) {
          pointY[count] = beadY;
          pointX[count] = threadXAt(beadY);
          lastY = beadY;
          count += 1;
        }
        bead += 1;
      }
      if (isEnd || y - lastY > 3) {
        pointY[count] = y;
        pointX[count] = isEnd ? THREAD_X : threadXAt(y);
        lastY = y;
        count += 1;
      }
    }

    const ratio = dpr;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (revealProgress <= 0) return;
    if (revealProgress < 1) {
      const tipY = top + (bottom - top) * revealProgress;
      for (let index = 1; index < count; index += 1) {
        if (pointY[index] < tipY) continue;
        pointY[index] = tipY;
        pointX[index] = threadXAt(tipY);
        count = index + 1;
        break;
      }
    }
    if (count < 2) return;

    let length = 0;
    for (let index = 1; index < count; index += 1) length += Math.hypot(pointX[index] - pointX[index - 1], pointY[index] - pointY[index - 1]);
    const stretch = length / Math.max(1, bottom - top);
    context.lineWidth = clamp(2 / Math.sqrt(stretch), 1.25, 2);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = threadInk;
    context.fillStyle = threadInk;
    context.beginPath();
    context.moveTo(pointX[0], pointY[0]);
    for (let index = 0; index < count - 1; index += 1) {
      const previous = index > 0 ? index - 1 : index;
      const following = index + 2 < count ? index + 2 : index + 1;
      const c1x = pointX[index] + (pointX[index + 1] - pointX[previous]) / 6;
      const c1y = pointY[index] + (pointY[index + 1] - pointY[previous]) / 6;
      const c2x = pointX[index + 1] - (pointX[following] - pointX[index]) / 6;
      const c2y = pointY[index + 1] - (pointY[following] - pointY[index]) / 6;
      context.bezierCurveTo(c1x, c1y, c2x, c2y, pointX[index + 1], pointY[index + 1]);
    }
    context.stroke();
    const topKnot = 3 * Math.min(1, revealProgress * 6);
    const bottomKnot = 3 * smoothstep(0.82, 1, revealProgress);
    context.beginPath();
    context.arc(THREAD_X, top, topKnot, 0, Math.PI * 2);
    if (bottomKnot > 0.05) {
      context.moveTo(THREAD_X + bottomKnot, bottom);
      context.arc(THREAD_X, bottom, bottomKnot, 0, Math.PI * 2);
    }
    context.fill();
  }

  function remove(id) {
    const row = rows.get(id);
    if (!isGrabbable(row) || gesture) return false;
    fly(row, 1.1, sampleString(string, row.y + BEAD_CENTER));
    wake();
    return true;
  }

  function nudge(id, direction) {
    const row = rows.get(id);
    if (!row || !row.threaded) return;
    addBump(string, row.y + BEAD_CENTER, 12 * (direction < 0 ? -1 : 1), 42);
    row.settling = true;
    row.li.dataset.settling = "true";
    excite();
    pluckSound(12);
    wake();
  }

  function focusRow(id) {
    const row = rows.get(id);
    if (!row) return;
    row.li.focus({ preventScroll: true });
    if (row.body) row.body.scrollIntoView({ block: "nearest" });
  }

  function setHandlers(next) {
    handlers = next;
  }

  return { registerRow, setOrder, mount, destroy, remove, nudge, focusRow, setHandlers };
}
