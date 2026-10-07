"use client";

import { useEffect, useRef } from "react";

import { EASE, createMarbleEngine, dropBloom } from "./marbleEngine";
import { OP_DROP, RECIPES, TOOLS, fitRecipe, introLanding, makeDrop, makeSwirl, makeTine } from "./marbleOps";

const TAP_SLOP_PX = 6;
const TAP_MS = 220;
const AIM_PX = 24;
const HOLD_BREAK_PX = 12;
const TOOTH_POOL = 16;
const PIPETTE_CAP = 0.32;
const LANDING_DELAY_MS = 500;
const DROP_MS = 520;
const SETTLE_BUMP_MS = 300;
const PULL_MS = 760;
const UNDO_MS = 240;
const LIFT_MS = 420;
const WIPE_MS = 300;
const FIELD_BEAT_MS = 30;
const FEATURE_BEAT_MS = 250;
const KEY_PULL = 0.1;
const KEY_COMB_SPACING = 0.045;
const REPLAY_CATCH_UP_MS = 32;
const FALLBACK_OP_LIMIT = 60;
const BATH_EASE = "cubic-bezier(0.7, 0, 0.3, 1)";

const ARROWS = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

const TEETH = Array.from({ length: TOOTH_POOL }, (_, index) => <span key={index} className="marble-tooth" />);

function plateHalf(width, height) {
  const aspect = width / Math.max(height, 1);
  return { halfW: Math.max(aspect, 1) * 0.5, halfH: Math.max(1 / aspect, 1) * 0.5, aspect };
}

export default function MarbleScene({
  items,
  params,
  tool,
  nextInk,
  highlight,
  reducedMotion,
  embedded,
  preset,
  onReady,
  onDropped,
  onUndoDrop,
  onCounts,
  onPainted,
  onError,
  onTool,
  onEmbeddedTap,
}) {
  const rootRef = useRef(null);
  const printRef = useRef(null);
  const cursorRef = useRef(null);
  const teethRef = useRef(null);
  const engineRef = useRef(null);
  const latest = useRef(null);

  useEffect(() => {
    latest.current = {
      items,
      params,
      tool,
      nextInk,
      reducedMotion,
      embedded,
      preset,
      onDropped,
      onUndoDrop,
      onCounts,
      onPainted,
      onError,
      onTool,
      onEmbeddedTap,
    };
  });

  useEffect(() => {
    const root = rootRef.current;
    const canvas = document.createElement("canvas");
    canvas.className = "marble-canvas";
    root.prepend(canvas);
    const print = printRef.current;
    const cursor = cursorRef.current;
    const teeth = Array.from(teethRef.current.children);
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const now = () => performance.now();
    let landingTimer = 0;
    let liftTimer = 0;
    let afterWipe = null;
    let printAnimation = null;
    let bathAnimation = null;

    let engine;
    try {
      engine = createMarbleEngine(canvas, {
        onPainted: () => {
          canvas.dataset.painted = "1";
          latest.current?.onPainted?.();
          if (!latest.current?.reducedMotion) landingTimer = setTimeout(landIntroDrop, LANDING_DELAY_MS);
        },
        onChange: (counts) => latest.current?.onCounts?.(counts),
        onError: (error) => latest.current?.onError?.(String(error?.message || error)),
      });
    } catch (error) {
      canvas.remove();
      latest.current?.onError?.(String(error?.message || error));
      return undefined;
    }
    engineRef.current = engine;

    let width = 1;
    let height = 1;
    let introduced = false;
    let replay = null;
    let stopReplay = null;
    let onscreen = true;
    const pointers = new Map();
    const gesture = { mode: "idle", id: -1, startX: 0, startY: 0, op: null, cover: 0, holdTimer: 0, stopGrow: null, locked: false, swirlAngle: 0, swirlTotal: 0, swirlRadius: 0, pairSpread: null };
    const motion = { x: 0, y: 0, t: 0, speed: 0 };

    const settings = () => latest.current.params;
    const reduced = () => latest.current.reducedMotion;
    const unitCss = () => Math.min(width, height);
    const toPlate = (x, y) => ({ x: (x - width / 2) / unitCss(), y: -(y - height / 2) / unitCss() });
    let rootRect = null;
    const measureRoot = () => {
      rootRect = root.getBoundingClientRect();
    };
    const forgetRect = () => {
      rootRect = null;
    };
    const local = (event) => {
      if (!rootRect) measureRoot();
      return { x: event.clientX - rootRect.left, y: event.clientY - rootRect.top };
    };
    const coverCount = () => Math.max(1, Math.min(latest.current.items.length, 16));

    function playDrop(op, duration = DROP_MS) {
      if (reduced()) {
        op.amount = 1;
        engine.touch(op);
        return;
      }
      op.amount = 0;
      engine.animate(op, duration, (progress) => {
        op.amount = dropBloom(progress);
      });
    }

    function playPull(op, duration = PULL_MS) {
      if (reduced()) {
        op.amount = 1;
        engine.touch(op);
        return;
      }
      op.amount = 0;
      engine.animate(op, duration, (progress) => {
        op.amount = EASE.inOut(progress);
      });
    }

    function dropAt(x, y, radius, cover, user = false) {
      const op = makeDrop(x, y, radius, cover);
      op.user = user;
      if (engine.push(op) < 0) return null;
      playDrop(op);
      latest.current.onDropped?.(cover);
      return op;
    }

    function landIntroDrop() {
      if (!engineRef.current) return;
      const landing = introLanding(width / Math.max(height, 1));
      dropAt(landing.x, landing.y, landing.radius, latest.current.nextInk % coverCount());
    }

    function recipeOps(name, seed) {
      const recipe = RECIPES[name] ?? RECIPES.bouquet;
      const ops = recipe({ seed, aspect: width / Math.max(height, 1), coverCount: coverCount() });
      return engine.floatTargets ? ops : fitRecipe(ops, FALLBACK_OP_LIMIT);
    }

    function intro() {
      introduced = true;
      const { preset: name, params: values } = latest.current;
      const ops = recipeOps(name, values.seed);
      for (const op of ops) op.amount = 1;
      engine.pushMany(ops);
    }

    function finishReplay() {
      if (!replay) return;
      const remaining = replay.ops.slice(replay.index);
      for (const op of remaining) op.amount = 1;
      engine.pushMany(remaining);
      replay = null;
      stopReplay?.();
      stopReplay = null;
    }

    function startReplay(ops) {
      finishReplay();
      if (reduced()) {
        for (const op of ops) op.amount = 1;
        engine.pushMany(ops);
        return;
      }
      replay = { ops, index: 0, nextAt: 0 };
      stopReplay = engine.grow((time) => {
        if (!replay) return;
        replay.nextAt = replay.nextAt ? Math.max(replay.nextAt, time - REPLAY_CATCH_UP_MS) : time;
        while (replay && replay.index < replay.ops.length && time >= replay.nextAt) {
          const op = replay.ops[replay.index];
          if (engine.push(op) < 0) break;
          replay.index += 1;
          if (op.type === OP_DROP) {
            playDrop(op, op.field ? 420 : DROP_MS);
            replay.nextAt += op.field ? FIELD_BEAT_MS : FEATURE_BEAT_MS;
          } else {
            playPull(op);
            replay.nextAt += PULL_MS;
          }
        }
        if (replay && replay.index >= replay.ops.length) {
          replay = null;
          stopReplay?.();
          stopReplay = null;
        }
      });
    }

    function runAfterWipe() {
      clearTimeout(liftTimer);
      liftTimer = 0;
      const then = afterWipe;
      afterWipe = null;
      then?.();
    }

    function settleChoreography() {
      runAfterWipe();
      finishReplay();
    }

    function slidePrint(duration, then) {
      clearTimeout(liftTimer);
      liftTimer = 0;
      afterWipe = null;
      printAnimation?.cancel();
      printAnimation = null;
      engine.snapshot(print);
      print.dataset.visible = "1";
      engine.clear();
      engine.renderNow();
      if (reduced()) {
        print.dataset.visible = "";
        then?.();
        return;
      }
      if (canvas.dataset.painted) {
        bathAnimation?.cancel();
        bathAnimation = canvas.animate([{ opacity: 0.96 }, { opacity: 1 }], { duration: LIFT_MS, easing: BATH_EASE });
      }
      const animation = print.animate(
        [
          { transform: "translate3d(0, 0, 0)" },
          { transform: "translate3d(0, -104%, 0)" },
        ],
        { duration, easing: BATH_EASE, fill: "forwards" },
      );
      printAnimation = animation;
      afterWipe = then ?? null;
      liftTimer = setTimeout(runAfterWipe, duration * 0.7);
      animation.onfinish = () => {
        if (animation !== printAnimation) return;
        printAnimation = null;
        print.dataset.visible = "";
        animation.cancel();
      };
    }

    function lift() {
      finishReplay();
      cancelGesture();
      slidePrint(LIFT_MS, () => {
        const cover = latest.current.nextInk % coverCount();
        dropAt(0, 0, Math.min(0.24, Math.max(0.16, settings().dropSize * 2)), cover);
      });
    }

    function playPreset(name, seed) {
      cancelGesture();
      finishReplay();
      const ops = recipeOps(name, seed);
      slidePrint(WIPE_MS, () => startReplay(ops));
    }

    function pullAcross(directionX, directionY) {
      settleChoreography();
      const { halfW, halfH } = plateHalf(width, height);
      const span = directionY !== 0 ? halfW * 2 + 0.3 : halfH * 2 + 0.3;
      const tines = Math.ceil(span / KEY_COMB_SPACING) | 1;
      const op = makeTine(0, 0, directionX, directionY, KEY_PULL, tines, KEY_COMB_SPACING);
      op.user = true;
      if (engine.push(op) < 0) return;
      playPull(op, 700);
    }

    function undo() {
      cancelGesture();
      settleChoreography();
      const op = engine.undo(reduced() ? 0 : UNDO_MS);
      if (op && op.type === OP_DROP) latest.current.onUndoDrop?.(op.cover);
    }

    function save() {
      const out = engine.capture();
      out.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "marble.png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    }

    function showTeeth(count) {
      for (let index = 0; index < teeth.length; index += 1) teeth[index].dataset.on = index < count ? "1" : "";
    }

    function placeTeeth() {
      const op = gesture.op;
      if (!op) return;
      const unit = unitCss();
      const target = op.follow ?? op;
      if (gesture.mode === "swirl") {
        const angle = Math.atan2(motion.y - gesture.startY, motion.x - gesture.startX) + Math.PI / 2;
        const stretch = 1 + Math.min(2.4, motion.speed * 2.2);
        teeth[0].style.transform = `translate3d(${motion.x}px, ${motion.y}px, 0) rotate(${angle}rad) scaleX(${stretch})`;
        teeth[1].style.transform = `translate3d(${gesture.startX}px, ${gesture.startY}px, 0) scale(0.6)`;
        return;
      }
      const directionX = op.dx;
      const directionY = -op.dy;
      const acrossX = -directionY;
      const acrossY = directionX;
      const reach = (target.alpha ?? 0) * unit;
      const middle = (op.tines - 1) / 2;
      const spacing = op.spacing * unit;
      const angle = Math.atan2(directionY, directionX);
      const stretch = 1 + Math.min(2.4, motion.speed * 2.2);
      const shown = Math.min(op.tines, TOOTH_POOL);
      const first = Math.floor((op.tines - shown) / 2);
      for (let index = 0; index < shown; index += 1) {
        const offset = (first + index - middle) * spacing;
        const x = gesture.startX + directionX * reach + acrossX * offset;
        const y = gesture.startY + directionY * reach + acrossY * offset;
        teeth[index].style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angle}rad) scaleX(${stretch})`;
      }
    }

    function trackMotion(x, y) {
      const time = now();
      const dt = Math.max(1, time - motion.t);
      const instant = Math.hypot(x - motion.x, y - motion.y) / dt;
      motion.speed = motion.t ? motion.speed + (Math.min(instant, 3) - motion.speed) * Math.min(1, dt / 60) : 0;
      motion.x = x;
      motion.y = y;
      motion.t = time;
    }

    function moveCursor(x, y) {
      if (!finePointer) return;
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    function startHold() {
      if (gesture.mode !== "pending") return;
      gesture.mode = "hold";
      root.dataset.gesture = "hold";
      const cover = latest.current.nextInk % coverCount();
      const base = settings().dropSize;
      const { x, y } = toPlate(gesture.startX, gesture.startY);
      const op = makeDrop(x, y, base, cover);
      op.amount = 0;
      op.animating = 1;
      op.user = true;
      engine.push(op);
      gesture.op = op;
      gesture.cover = cover;
      const started = now();
      const cap = PIPETTE_CAP / base;
      gesture.stopGrow = engine.grow((time) => {
        const held = Math.max(0, (time - started) / 1000);
        const appear = reduced() ? 1 : EASE.entrance(Math.min(1, held / 0.3));
        op.amount = Math.min(cap, Math.sqrt(appear) * Math.sqrt(1 + 3 * held));
        engine.touch(op);
        if (op.amount >= cap) {
          gesture.stopGrow?.();
          gesture.stopGrow = null;
        }
      });
    }

    function commitHold() {
      const op = gesture.op;
      gesture.stopGrow?.();
      gesture.stopGrow = null;
      if (!op) return;
      op.animating = Math.max(0, (op.animating || 1) - 1);
      const from = op.amount;
      if (!reduced()) {
        engine.animate(op, SETTLE_BUMP_MS, (progress) => {
          op.amount = from * (1 + 0.03 * Math.sin(Math.PI * progress));
        });
      } else {
        engine.touch(op);
      }
      latest.current.onDropped?.(gesture.cover);
      gesture.op = null;
    }

    function startStroke(x, y) {
      const definition = TOOLS.find((entry) => entry.id === latest.current.tool) ?? TOOLS[0];
      const start = toPlate(gesture.startX, gesture.startY);
      gesture.locked = false;
      if (definition.id === "swirl") {
        gesture.mode = "swirl";
        gesture.swirlAngle = Math.atan2(-(y - gesture.startY), x - gesture.startX);
        gesture.swirlTotal = 0;
        gesture.swirlRadius = Math.hypot(x - gesture.startX, y - gesture.startY) / unitCss();
        const op = makeSwirl(start.x, start.y, gesture.swirlRadius, 0);
        op.user = true;
        op.follow = { alpha: 0, radius: gesture.swirlRadius };
        engine.push(op);
        gesture.op = op;
        showTeeth(2);
      } else {
        gesture.mode = "tine";
        const op = makeTine(start.x, start.y, x - gesture.startX, -(y - gesture.startY), 0, definition.tines, definition.spacing);
        op.user = true;
        op.follow = { alpha: 0 };
        engine.push(op);
        gesture.op = op;
        showTeeth(Math.min(definition.tines, TOOTH_POOL));
      }
      root.dataset.gesture = "stroke";
      updateStroke(x, y);
    }

    function startPair() {
      const [first, second] = [...pointers.values()];
      if (gesture.op && gesture.mode !== "hold") engine.remove(gesture.op);
      if (gesture.mode === "hold") commitHold();
      clearTimeout(gesture.holdTimer);
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      gesture.mode = "pair";
      gesture.startX = midX;
      gesture.startY = midY;
      gesture.locked = false;
      gesture.pairSpread = { x: second.x - first.x, y: second.y - first.y };
      const start = toPlate(midX, midY);
      const op = makeTine(start.x, start.y, 0, -1, 0, 2, 0.12);
      op.user = true;
      op.follow = { alpha: 0 };
      engine.push(op);
      gesture.op = op;
      showTeeth(2);
      root.dataset.gesture = "stroke";
    }

    function setFollow(op, key, value) {
      if (!op.follow) return;
      op.follow[key] = value;
      if (reduced() || settings().lag <= 0) op[key] = value;
    }

    function updateSwirl(x, y) {
      const angle = Math.atan2(-(y - gesture.startY), x - gesture.startX);
      const distance = Math.hypot(x - gesture.startX, y - gesture.startY);
      let delta = angle - gesture.swirlAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      if (distance > 12) gesture.swirlTotal += delta;
      gesture.swirlAngle = angle;
      const reach = distance / unitCss();
      if (!gesture.locked) {
        setFollow(gesture.op, "radius", reach);
        gesture.swirlRadius = reach;
        if (distance >= AIM_PX) gesture.locked = true;
      } else if (Math.abs(reach - gesture.swirlRadius) > 2 * settings().lambda) {
        ringSwirl(reach);
      }
      setFollow(gesture.op, "alpha", gesture.swirlTotal);
    }

    function updateTine(x, y) {
      const op = gesture.op;
      const deltaX = x - gesture.startX;
      const deltaY = -(y - gesture.startY);
      const length = Math.hypot(deltaX, deltaY);
      if (!gesture.locked && length > 0.5) {
        op.dx = deltaX / length;
        op.dy = deltaY / length;
        if (gesture.mode === "pair" && gesture.pairSpread) {
          const across = Math.abs(-op.dy * gesture.pairSpread.x - op.dx * gesture.pairSpread.y) / unitCss();
          op.spacing = Math.min(0.5, Math.max(0.04, across));
        }
        if (length >= AIM_PX) gesture.locked = true;
      }
      setFollow(op, "alpha", (deltaX * op.dx + deltaY * op.dy) / unitCss());
    }

    function updateStroke(x, y) {
      if (!gesture.op) return;
      if (gesture.mode === "swirl") updateSwirl(x, y);
      else updateTine(x, y);
      engine.touch(gesture.op);
      placeTeeth();
    }

    function ringSwirl(reach) {
      const previous = gesture.op;
      const start = toPlate(gesture.startX, gesture.startY);
      const op = makeSwirl(start.x, start.y, reach, 0);
      op.user = true;
      op.follow = { alpha: 0 };
      if (engine.push(op) < 0) return;
      settleStroke(previous);
      gesture.op = op;
      gesture.swirlRadius = reach;
      gesture.swirlTotal = 0;
    }

    function commitStroke() {
      const op = gesture.op;
      gesture.op = null;
      showTeeth(0);
      settleStroke(op);
    }

    function settleStroke(op) {
      if (!op) return;
      if (Math.abs(op.follow?.alpha ?? op.alpha) < 1e-4) {
        engine.remove(op);
        return;
      }
      const settle = () => {
        if (reduced()) return;
        engine.animate(op, SETTLE_BUMP_MS, (progress) => {
          op.amount = 1 + 0.03 * EASE.entrance(progress);
        });
      };
      if (!op.follow) {
        settle();
        return;
      }
      if (reduced() || settings().lag <= 0) {
        for (const key of Object.keys(op.follow)) op[key] = op.follow[key];
        op.follow = null;
        engine.touch(op);
        return;
      }
      op.follow.release = settle;
      engine.touch(op);
    }

    function cancelGesture() {
      clearTimeout(gesture.holdTimer);
      if (gesture.mode === "hold") commitHold();
      if (gesture.mode === "tine" || gesture.mode === "swirl" || gesture.mode === "pair") commitStroke();
      gesture.mode = "idle";
      gesture.id = -1;
      pointers.clear();
      root.dataset.gesture = "";
      root.dataset.pressed = "";
    }

    function onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      measureRoot();
      const point = local(event);
      pointers.set(event.pointerId, point);
      if (gesture.mode !== "idle") {
        if (event.pointerType === "touch" && pointers.size === 2 && (gesture.mode === "pending" || gesture.mode === "hold" || !gesture.locked)) startPair();
        return;
      }
      settleChoreography();
      root.focus({ preventScroll: true });
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        gesture.id = event.pointerId;
      }
      gesture.mode = "pending";
      gesture.id = event.pointerId;
      gesture.startX = point.x;
      gesture.startY = point.y;
      gesture.op = null;
      motion.t = 0;
      trackMotion(point.x, point.y);
      root.dataset.pressed = "1";
      clearTimeout(gesture.holdTimer);
      gesture.holdTimer = setTimeout(startHold, TAP_MS);
    }

    function onPointerMove(event) {
      const point = local(event);
      moveCursor(point.x, point.y);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
      if (gesture.mode === "idle") return;
      if (gesture.mode === "pair") {
        const values = [...pointers.values()];
        if (values.length < 2) return;
        trackMotion((values[0].x + values[1].x) / 2, (values[0].y + values[1].y) / 2);
        updateStroke(motion.x, motion.y);
        return;
      }
      if (event.pointerId !== gesture.id) return;
      trackMotion(point.x, point.y);
      const travelled = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
      if (gesture.mode === "pending" && travelled >= TAP_SLOP_PX) {
        clearTimeout(gesture.holdTimer);
        startStroke(point.x, point.y);
      } else if (gesture.mode === "hold" && travelled >= HOLD_BREAK_PX) {
        commitHold();
        startStroke(point.x, point.y);
      } else if (gesture.mode === "tine" || gesture.mode === "swirl") {
        updateStroke(point.x, point.y);
      }
    }

    function onPointerUp(event) {
      const wasTracked = pointers.delete(event.pointerId);
      if (!wasTracked && event.pointerId !== gesture.id) return;
      if (gesture.mode === "pair") {
        commitStroke();
        gesture.mode = pointers.size ? "spent" : "idle";
      } else if (event.pointerId === gesture.id) {
        clearTimeout(gesture.holdTimer);
        if (gesture.mode === "pending") {
          if (event.type === "pointerup") {
            if (latest.current.embedded) latest.current.onEmbeddedTap?.();
            else {
              const { x, y } = toPlate(gesture.startX, gesture.startY);
              dropAt(x, y, settings().dropSize, latest.current.nextInk % coverCount(), true);
            }
          }
        } else if (gesture.mode === "hold") {
          commitHold();
        } else if (gesture.mode === "tine" || gesture.mode === "swirl") {
          commitStroke();
        }
        gesture.mode = pointers.size ? "spent" : "idle";
      }
      if (!pointers.size) {
        gesture.mode = "idle";
        gesture.id = -1;
        root.dataset.gesture = "";
        root.dataset.pressed = "";
      }
    }

    function onPointerEnter(event) {
      if (event.pointerType !== "mouse") return;
      measureRoot();
      const point = local(event);
      moveCursor(point.x, point.y);
      root.dataset.hover = "1";
    }

    function onPointerLeave(event) {
      if (event.pointerType !== "mouse") return;
      root.dataset.hover = "";
    }

    function onKeyDown(event) {
      if (event.target !== root) return;
      const key = event.key;
      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const busy = gesture.mode !== "idle";
      if (key === " " || key === "Enter") {
        event.preventDefault();
        if (busy) return;
        settleChoreography();
        dropAt(0, 0, settings().dropSize, latest.current.nextInk % coverCount(), true);
        return;
      }
      if (ARROWS[key]) {
        event.preventDefault();
        if (busy) return;
        pullAcross(ARROWS[key][0], ARROWS[key][1]);
        return;
      }
      const picked = TOOLS.find((entry) => entry.key === key);
      if (picked) {
        event.preventDefault();
        latest.current.onTool?.(picked.id);
      }
    }

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerUp);
    root.addEventListener("pointerenter", onPointerEnter);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("keydown", onKeyDown);

    const dprCap = () => (latest.current.embedded || coarse ? 1.5 : 2);
    const resizeObserver = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      if (box.width < 2 || box.height < 2) return;
      width = box.width;
      height = box.height;
      measureRoot();
      engine.resize(width, height, dprCap());
      if (!introduced) intro();
    });
    resizeObserver.observe(root);

    const syncPaused = () => engine.setPaused(document.hidden || !onscreen);
    const intersection = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      syncPaused();
    });
    intersection.observe(root);
    document.addEventListener("visibilitychange", syncPaused);
    window.addEventListener("scroll", forgetRect, { capture: true, passive: true });
    window.addEventListener("resize", forgetRect);

    const api = { undo, lift, playPreset, pullAcross, save };
    onReady?.(api);

    return () => {
      onReady?.(null);
      clearTimeout(landingTimer);
      clearTimeout(liftTimer);
      clearTimeout(gesture.holdTimer);
      printAnimation?.cancel();
      bathAnimation?.cancel();
      gesture.stopGrow?.();
      stopReplay?.();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", syncPaused);
      window.removeEventListener("scroll", forgetRect, { capture: true });
      window.removeEventListener("resize", forgetRect);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("pointerenter", onPointerEnter);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("keydown", onKeyDown);
      engine.destroy();
      engineRef.current = null;
      canvas.remove();
    };
  }, [onReady]);

  useEffect(() => {
    engineRef.current?.setCovers(items);
  }, [items]);

  useEffect(() => {
    engineRef.current?.setSettings({
      lambda: params.lambda,
      rimPx: params.rimWeight,
      rimDark: params.rimDark,
      grain: params.grain,
      paper: params.paper,
      seed: params.seed,
      followMs: reducedMotion ? 0 : params.lag,
    });
  }, [params, reducedMotion]);

  useEffect(() => {
    engineRef.current?.setHighlight(highlight);
  }, [highlight]);

  useEffect(() => {
    const cursor = cursorRef.current;
    const item = items[nextInk % Math.max(1, items.length)];
    if (cursor && item) cursor.style.setProperty("--ink-image", `url("${item.image}")`);
  }, [items, nextInk]);

  return (
    <div
      ref={rootRef}
      className="marble-surface"
      tabIndex={0}
      role="application"
      aria-label="Marbling bath. Tap to drop the next cover, drag to pull a tine, arrow keys comb the whole tray, Command Z undoes."
    >
      <canvas ref={printRef} className="marble-print" aria-hidden="true" />
      <div ref={teethRef} className="marble-teeth" aria-hidden="true">
        {TEETH}
      </div>
      <span ref={cursorRef} className="marble-cursor" aria-hidden="true" />
    </div>
  );
}
