"use client";

import { useEffect } from "react";

import { muteTile } from "@/lib/sound/tileGate";

// A piece nobody is using plays itself, as if someone just out of frame had
// a hand on it: the film is pulled, a cover pressed, the ring spun. The
// gesture (demos.js, on the tile as data-demo) goes in through the piece's
// own pointer handlers, so what moves is the real thing. It waits until the
// tile has settled on screen and its piece is live, stops the instant a
// visitor touches, moves over or types into the tile, and comes back once
// they have left it alone for a while. A demo is never heard: the tile stays
// muted until a visitor plays it themselves.
const DEMO_POINTER = 9999; // never a real pointer's id
const FIRST_AFTER_MS = 900;
const EVERY_MS = 4200;
const IDLE_MS = 8000;
const DRAG_MS = 1100;
const HOVER_MS = 2200;
const HOLD_MS = 750;
const TAP_MS = 90;
// On screen enough to be watched: this much of the tile, or of the viewport
// when the tile is taller.
const SEEN = 0.6;

// Where `seek` feels for a canvas piece's object: the given point, then a
// grid over the middle of the tile, nearest first.
const probes = ([fx, fy]) => {
  const grid = [];
  for (let gy = 0.15; gy < 0.9; gy += 0.1) for (let gx = 0.1; gx < 0.95; gx += 0.08) grid.push([gx, gy]);
  grid.sort((a, b) => Math.hypot(a[0] - fx, a[1] - fy) - Math.hypot(b[0] - fx, b[1] - fy));
  return [[fx, fy], ...grid];
};
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export default function TileDemos() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const root = document.querySelector(".xl-bento");
    if (!root) return undefined;

    // A piece may capture the demo's pointer; there is no such pointer for
    // the browser to capture, so the capture is kept here instead.
    const proto = Element.prototype;
    const native = { set: proto.setPointerCapture, release: proto.releasePointerCapture, has: proto.hasPointerCapture };
    let captured = null;
    proto.setPointerCapture = function (id) {
      if (id !== DEMO_POINTER) return native.set.call(this, id);
      captured = this;
    };
    proto.releasePointerCapture = function (id) {
      if (id !== DEMO_POINTER) return native.release.call(this, id);
      if (captured === this) captured = null;
    };
    proto.hasPointerCapture = function (id) {
      return id === DEMO_POINTER ? captured === this : native.has.call(this, id);
    };

    const fire = (target, type, x, y, buttons, compat) => {
      const pointer = type.startsWith("pointer");
      const init = {
        bubbles: type !== "pointerenter" && type !== "mouseenter",
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: /move|over|enter/.test(type) ? -1 : 0,
        buttons,
      };
      const event = pointer ? new PointerEvent(type, { ...init, pointerId: DEMO_POINTER, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, { ...init, button: Math.max(0, init.button) });
      const to = pointer && captured && type !== "pointerdown" ? captured : target;
      const kept = to.dispatchEvent(event);
      if (pointer && compat.mouse) {
        const mouse = { pointerdown: "mousedown", pointermove: "mousemove", pointerup: "mouseup", pointerover: "mouseover" }[type];
        if (mouse) fire(to, mouse, x, y, buttons, compat);
      }
      return kept;
    };

    const tiles = new Map();
    const stateOf = (tile) => {
      let state = tiles.get(tile);
      if (!state) {
        state = { demo: null, seen: false, lastReal: 0, timer: 0, run: null, muted: false };
        try {
          state.demo = JSON.parse(tile.dataset.demo);
        } catch {
          state.demo = null;
        }
        tiles.set(tile, state);
      }
      return state;
    };

    // Where a step starts and ends, as fractions of the tile: given outright,
    // or from the centre of one of the piece's own elements (`on`, picked at
    // random among those on screen) moved by `by`.
    const aim = (tile, step) => {
      if (!step.on) return { from: step.from, to: step.to ?? step.from };
      const rect = tile.getBoundingClientRect();
      const options = [...tile.querySelectorAll(step.on)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
      });
      if (!options.length) return null;
      const r = options[Math.floor(Math.random() * options.length)].getBoundingClientRect();
      const from = [(r.left + r.width / 2 - rect.left) / rect.width, (r.top + r.height / 2 - rect.top) / rect.height];
      const [bx, by] = step.by ?? [0, 0];
      return { from, to: [from[0] + bx, from[1] + by] };
    };

    const play = async (tile, state, step = state.demo) => {
      const gesture = step.gesture;
      const aimed = aim(tile, step);
      if (!aimed) return;
      const { from, to } = aimed;
      const run = { stopped: false, down: false, x: 0, y: 0, target: null, compat: { mouse: true } };
      state.run = run;
      if (!state.muted) {
        state.muted = true;
        muteTile(tile, true);
      }
      const at = ([fx, fy]) => {
        const rect = tile.getBoundingClientRect();
        return [rect.left + fx * rect.width, rect.top + fy * rect.height];
      };
      const move = (x, y) => {
        run.x = x;
        run.y = y;
        fire(run.target, "pointermove", x, y, run.down ? 1 : 0, run.compat);
      };
      const glide = async (a, b, ms) => {
        const start = performance.now();
        for (;;) {
          await frame();
          if (run.stopped) return;
          const u = Math.min(1, (performance.now() - start) / ms);
          const k = ease(u);
          const [x0, y0] = at(a);
          const [x1, y1] = at(b);
          move(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
          if (u >= 1) return;
        }
      };
      const inside = (target) => target && tile.contains(target) && !target.closest("[data-tile-focus]");
      let [x, y] = at(from);
      let target = document.elementFromPoint(x, y);
      if (!inside(target)) return;
      run.target = target;
      run.x = x;
      run.y = y;
      fire(target, "pointerover", x, y, 0, run.compat);
      fire(target, "pointerenter", x, y, 0, { mouse: false });
      if (gesture === "hover") {
        await glide(from, to, HOVER_MS / 2);
        if (!run.stopped) await glide(to, from, HOVER_MS / 2);
        return;
      }
      run.down = true;
      // A piece drawn on a canvas only says where its object is by taking
      // the press: `seek` feels for it, nearest the given point first, and
      // lets go (cancelled, never a tap) of every press it doesn't take.
      let start = from;
      let pressed = false;
      for (const point of step.seek ? probes(from) : [from]) {
        if (run.stopped) return;
        [x, y] = at(point);
        target = document.elementFromPoint(x, y);
        if (!inside(target)) continue;
        captured = null;
        run.target = target;
        run.x = x;
        run.y = y;
        // A piece that cancels the press has asked for no compatibility
        // mouse events, as a browser would honour.
        run.compat.mouse = fire(target, "pointerdown", x, y, 1, { mouse: false });
        if (!step.seek || captured || !run.compat.mouse) {
          start = point;
          pressed = true;
          break;
        }
        fire(target, "pointercancel", x, y, 0, { mouse: false });
      }
      if (!pressed) {
        run.down = false;
        return;
      }
      if (run.compat.mouse) fire(target, "mousedown", x, y, 1, { mouse: false });
      const end = [start[0] + to[0] - from[0], start[1] + to[1] - from[1]];
      if (gesture === "drag") {
        await glide(start, end, DRAG_MS);
        // `back`: and home again before letting go, for a piece with stops at
        // either end, so the next demo has somewhere to go.
        if (step.back && !run.stopped) await glide(end, start, DRAG_MS);
      }
      else await wait(gesture === "hold" ? HOLD_MS : TAP_MS);
      if (run.stopped) return;
      run.down = false;
      fire(run.target, "pointerup", run.x, run.y, 0, run.compat);
      if (gesture === "tap") fire(target, "click", run.x, run.y, 0, { mouse: false });
      // A second step, such as closing the menu the first one opened.
      if (step.then) {
        await wait(step.then.after ?? 1600);
        if (!run.stopped && state.run === run) await play(tile, state, step.then);
      }
    };

    // End a demo mid-gesture cleanly, as if the hand had let go.
    const stop = (state) => {
      const run = state.run;
      state.run = null;
      if (!run || run.stopped) return;
      run.stopped = true;
      if (run.down) {
        run.down = false;
        fire(run.target, "pointerup", run.x, run.y, 0, run.compat);
      }
      captured = null;
    };

    const schedule = (tile, state, ms) => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => tick(tile, state), ms);
    };
    const tick = async (tile, state) => {
      if (!state.seen || state.run) return;
      const quiet = performance.now() - state.lastReal;
      if (quiet < IDLE_MS) return schedule(tile, state, IDLE_MS - quiet);
      // Wait for the piece itself, not its still.
      if (!tile.querySelector(".xl-live[data-live]")) return schedule(tile, state, 800);
      await play(tile, state);
      state.run = null;
      if (state.seen) schedule(tile, state, EVERY_MS);
    };

    const onReal = (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const tile = event.target.closest(".xl-tile[data-demo]");
      if (!tile) return;
      const state = stateOf(tile);
      state.lastReal = performance.now();
      stop(state);
      if (state.muted) {
        state.muted = false;
        muteTile(tile, false);
      }
      if (state.seen) schedule(tile, state, IDLE_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const tile = entry.target;
          const state = stateOf(tile);
          const tall = Math.min(entry.boundingClientRect.height, window.innerHeight) || 1;
          const seen = entry.isIntersecting && entry.intersectionRect.height / tall >= SEEN;
          if (seen === state.seen) continue;
          state.seen = seen;
          if (seen) schedule(tile, state, FIRST_AFTER_MS);
          else {
            clearTimeout(state.timer);
            stop(state);
          }
        }
      },
      { threshold: [0, 0.3, 0.6, 0.9, 1] },
    );
    for (const tile of root.querySelectorAll(".xl-tile[data-demo]")) {
      if (stateOf(tile).demo) observer.observe(tile);
    }

    root.addEventListener("pointerdown", onReal, { capture: true, passive: true });
    root.addEventListener("pointermove", onReal, { capture: true, passive: true });
    root.addEventListener("keydown", onReal, { capture: true });
    return () => {
      observer.disconnect();
      for (const [tile, state] of tiles) {
        clearTimeout(state.timer);
        stop(state);
        if (state.muted) muteTile(tile, false);
      }
      root.removeEventListener("pointerdown", onReal, { capture: true });
      root.removeEventListener("pointermove", onReal, { capture: true });
      root.removeEventListener("keydown", onReal, { capture: true });
      proto.setPointerCapture = native.set;
      proto.releasePointerCapture = native.release;
      proto.hasPointerCapture = native.has;
    };
  }, []);
  return null;
}
