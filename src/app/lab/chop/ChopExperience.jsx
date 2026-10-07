"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preload } from "react-dom";

import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";

import { artLevels, coverSource, exportPattern, prepareArt } from "./chopArt";
import { createChopEngine } from "./chopEngine";
import { coverPalette } from "./chopPalette";
import { PADS } from "./chopSlicer";
import { clearTracks, loadTrack, lookupPreview, prefetchTrack } from "./chopTrack";
import { createChopVisuals } from "./chopVisuals";
import "./chop.css";

const DECK_SIZE = 8;
const PREFERRED_TITLE = /i want you back/i;
const PAD_CODES = [
  "Digit1", "Digit2", "Digit3", "Digit4",
  "KeyQ", "KeyW", "KeyE", "KeyR",
  "KeyA", "KeyS", "KeyD", "KeyF",
  "KeyZ", "KeyX", "KeyC", "KeyV",
];
const PAD_LABELS = ["1", "2", "3", "4", "Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V"];
const CUES = ["Hold stutters", "Shift reverses", "Enter loops", "← → change cover"];
const PAD_INDEXES = Array.from({ length: PADS }, (_, index) => index);
const GAP = 4;
const OUT_MS = 200;
const IN_MS = 440;
const RING_MS = 24;
const CHUNKY_LEVEL = 3;
const UNLOCK_EVENTS = ["pointerup", "touchend", "keydown"];
const FLIGHT_MS = 420;
const MIN_FLIGHT_MS = 180;
const CENTRE = { col: 1.5, row: 1.5 };
const DEFAULT_SETTINGS = { quantise: false, choke: true, swing: 0 };

function cleanTitle(title = "") {
  return title
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s*[([](feat|with|from|remaster)[^)\]]*[)\]]/gi, "")
    .trim() || title;
}

function buildDeck(covers) {
  const list = (covers ?? []).filter((cover) => cover?.image);
  const preferred = list.findIndex((cover) => PREFERRED_TITLE.test(cover.title ?? ""));
  if (preferred > 0) list.unshift(list.splice(preferred, 1)[0]);
  return list.slice(0, DECK_SIZE);
}

function fileName(cover) {
  return `${cleanTitle(cover?.title ?? "chop")} chopped`.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase();
}

function artStyle(levels) {
  const style = {};
  levels.forEach((url, level) => {
    style[`--chop-art-${level}`] = `url("${url}")`;
  });
  return style;
}

const PadGrid = memo(function PadGrid({ gridRef, status, levels }) {
  const style = useMemo(() => artStyle(levels), [levels]);
  return (
    <div
      ref={gridRef}
      className="chop__grid"
      data-status={status}
      style={style}
      role="group"
      tabIndex={0}
      aria-label="Sixteen pads cut from the cover. Keys 1 to 4, Q to R, A to F and Z to V play them."
    >
      {PAD_INDEXES.map((pad) => (
        <div key={pad} className="chop__tile" data-pad={pad} style={{ "--chop-col": pad % 4, "--chop-row": Math.floor(pad / 4) }}>
          <div className="chop__swap">
            <div className="chop__art" data-res={CHUNKY_LEVEL} />
          </div>
          <svg className="chop__ring" aria-hidden="true">
            <rect className="chop__halo" x="1" y="1" pathLength="1" />
            <rect className="chop__stroke" x="1" y="1" pathLength="1" />
          </svg>
        </div>
      ))}
      <svg className="chop__sweep" aria-hidden="true">
        <rect x="1" y="1" pathLength="1" />
      </svg>
    </div>
  );
});

function Switch({ label, on, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="chop__switch text-ui" onClick={onToggle}>
      <span className="chop__track" aria-hidden="true" />
      {label}
    </button>
  );
}

function PlayGlyph({ playing }) {
  return (
    <svg className="chop__glyph" data-playing={playing || undefined} viewBox="0 0 12 12" aria-hidden="true">
      <path className="chop__glyph-play" d="M3.5 2.2 L9.6 6 L3.5 9.8 Z" />
      <rect className="chop__glyph-stop" x="2.5" y="2.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

export default function ChopExperience({ covers = [], embedded = false }) {
  const deck = useMemo(() => buildDeck(covers), [covers]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState("loading");
  const [bpm, setBpm] = useState(0);
  const [mode, setMode] = useState("beats");
  const [playing, setPlaying] = useState(false);
  const [gone, setGone] = useState([]);
  const [moved, setMoved] = useState(0);
  const [stepMs, setStepMs] = useState(0);
  const [canSave, setCanSave] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const barRef = useRef(null);
  const keymapRef = useRef(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !deck.length) return undefined;
    const tiles = Array.from(grid.querySelectorAll("[data-pad]"));
    const swaps = tiles.map((tile) => tile.querySelector(".chop__swap"));
    const arts = tiles.map((tile) => tile.querySelector(".chop__art"));
    const rings = tiles.map((tile) => tile.querySelector(".chop__stroke"));
    const keys = keymapRef.current ? Array.from(keymapRef.current.querySelectorAll("[data-key]")) : [];
    const ticks = barRef.current ? Array.from(barRef.current.querySelectorAll("[data-tick]")) : [];
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = () => motionQuery.matches;
    const timers = new Set();
    const artCache = new Map();
    const pointers = new Map();
    const downCount = new Uint8Array(PADS);
    const landBeat = new Uint8Array(PADS);
    const incoming = new Uint8Array(PADS);
    const missing = new Set();
    let found = [];
    let current = -1;
    let token = 0;
    let currentArt = null;
    let gridRect = null;
    let hoverPad = -1;
    let disposed = false;

    const wait = (ms) =>
      new Promise((resolve) => {
        const id = setTimeout(() => {
          timers.delete(id);
          resolve();
        }, ms);
        timers.add(id);
      });

    const getArt = (cover) => {
      if (!artCache.has(cover.id)) {
        const pending = prepareArt(cover);
        pending.catch(() => artCache.delete(cover.id));
        artCache.set(cover.id, pending);
      }
      return artCache.get(cover.id);
    };

    const engine = createChopEngine({
      onVoice: (voice) => visuals.add(voice),
      onRecord: (step, slice, from, at) => fly(step, slice, from, at),
      onTransport: (mode) => {
        setPlaying(mode === "loop" || mode === "latch");
        if (mode === "loop") visuals.chunk();
        else if (mode === "stop") visuals.wave(CENTRE, reduced());
      },
    });
    const visuals = createChopVisuals({ tiles, arts, rings, keys, ticks, clock: () => engine.clock(), running: () => engine.live });

    function ringsFrom(origin) {
      let furthest = 0;
      swaps.forEach((swap, pad) => {
        const ring = Math.round(Math.hypot((pad % 4) - origin.col, Math.floor(pad / 4) - origin.row));
        swap.style.setProperty("--chop-ring", ring);
        if (ring > furthest) furthest = ring;
      });
      return furthest;
    }

    function originFromPoint(x, y) {
      const rect = grid.getBoundingClientRect();
      const pitch = (rect.width + GAP) / 4;
      return { col: (x - rect.left) / pitch - 0.5, row: (y - rect.top) / pitch - 0.5 };
    }

    function setSlice(step, slice) {
      if (slice === step) {
        arts[step].style.removeProperty("--chop-sx");
        arts[step].style.removeProperty("--chop-sy");
        ticks[step]?.removeAttribute("data-moved");
        return;
      }
      arts[step].style.setProperty("--chop-sx", slice % 4);
      arts[step].style.setProperty("--chop-sy", Math.floor(slice / 4));
      ticks[step]?.setAttribute("data-moved", "");
    }

    function syncMoved() {
      let count = 0;
      for (let step = 0; step < PADS; step += 1) if (engine.pattern[step] !== step) count += 1;
      setMoved(count);
    }

    function paintColour(palette) {
      const root = rootRef.current;
      if (!root) return;
      if (palette) root.style.setProperty("--chop-hue", palette.hue.toFixed(1));
      root.dataset.colour = "on";
      root.style.setProperty("--chop-c", palette ? palette.strength.toFixed(3) : "0");
    }

    function drainColour() {
      const root = rootRef.current;
      if (!root) return;
      delete root.dataset.colour;
      root.style.setProperty("--chop-c", "0");
    }

    function land(step) {
      landBeat[step] ^= 1;
      swaps[step].dataset.phase = landBeat[step] ? "land-a" : "land-b";
    }

    function removeGhosts() {
      grid.querySelectorAll(".chop__ghost").forEach((ghost) => ghost.remove());
      incoming.fill(0);
      swaps.forEach((swap) => swap.removeAttribute("data-incoming"));
    }

    function flightMs(at) {
      const until = (at - engine.clock()) * 1000;
      return Math.round(Math.min(FLIGHT_MS, Math.max(MIN_FLIGHT_MS, until)));
    }

    function fly(step, slice, from, at) {
      setSlice(step, slice);
      syncMoved();
      if (reduced() || from === step) {
        if (!reduced()) land(step);
        return;
      }
      const tile = (grid.clientWidth - GAP * 3) / 4;
      const pitch = tile + GAP;
      const fromX = (from % 4) * pitch;
      const fromY = Math.floor(from / 4) * pitch;
      const toX = (step % 4) * pitch;
      const toY = Math.floor(step / 4) * pitch;
      const ghost = document.createElement("div");
      ghost.className = "chop__ghost";
      ghost.style.width = `${tile}px`;
      ghost.style.height = `${tile}px`;
      ghost.style.setProperty("--chop-sx", slice % 4);
      ghost.style.setProperty("--chop-sy", Math.floor(slice / 4));
      grid.appendChild(ghost);
      incoming[step] += 1;
      swaps[step].setAttribute("data-incoming", "");
      const flight = token;
      const animation = ghost.animate(
        [
          { transform: `translate3d(${fromX}px, ${fromY}px, 0) scale(0.94)` },
          { transform: `translate3d(${(fromX + toX) / 2}px, ${(fromY + toY) / 2}px, 0) scale(1.08)`, offset: 0.45 },
          { transform: `translate3d(${toX}px, ${toY}px, 0) scale(1)` },
        ],
        { duration: flightMs(at), easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
      );
      const arrive = () => {
        ghost.remove();
        if (flight !== token || disposed) return;
        if (incoming[step] > 0) incoming[step] -= 1;
        if (incoming[step]) return;
        swaps[step].removeAttribute("data-incoming");
        land(step);
      };
      animation.finished.then(arrive, arrive);
    }

    function applyArt(art, cover) {
      const levels = art?.levels ?? artLevels(coverSource(cover));
      levels.forEach((url, level) => grid.style.setProperty(`--chop-art-${level}`, `url("${url}")`));
      currentArt = art;
      setCanSave(Boolean(art?.exportable));
      paintColour(art?.exportable ? coverPalette(art.image) : null);
    }

    function resetSlices() {
      for (let step = 0; step < PADS; step += 1) setSlice(step, step);
    }

    function playable(next, direction) {
      for (let tries = 0; tries < deck.length; tries += 1) {
        const position = (((next + direction * tries) % deck.length) + deck.length) % deck.length;
        if (!missing.has(position)) return position;
      }
      return -1;
    }

    async function select(next, origin = CENTRE, direction = 1) {
      if (disposed) return;
      const target = playable(next, direction);
      if (target < 0 || target === current) return;
      const first = current < 0;
      current = target;
      token += 1;
      const mine = token;
      const stale = () => mine !== token || disposed;
      const cover = deck[target];
      engine.setTrack(null);
      visuals.clear();
      prefetchTrack(cover);
      const artPending = getArt(cover);
      let settle = null;
      if (first) {
        artPending.then((art) => (stale() ? null : applyArt(art, cover))).catch(() => null);
        visuals.chunk();
      } else {
        setStatus("loading");
        drainColour();
        const furthest = ringsFrom(origin);
        swaps.forEach((swap) => {
          swap.dataset.phase = "out";
        });
        await wait(reduced() ? 0 : OUT_MS + furthest * RING_MS);
        if (stale()) return;
      }
      const trackPending = loadTrack(cover, stale);
      if (!first) {
        const art = await artPending.catch(() => null);
        if (stale()) return;
        removeGhosts();
        applyArt(art, cover);
        engine.resetPattern();
        resetSlices();
        visuals.chunk();
        setIndex(target);
        setMoved(0);
        const furthest = ringsFrom(origin);
        swaps.forEach((swap) => {
          swap.dataset.phase = "in";
        });
        settle = wait(reduced() ? 0 : IN_MS + furthest * RING_MS);
      }
      const track = await trackPending.catch(() => null);
      await settle;
      if (stale()) return;
      if (!track && missing.has(target)) {
        const rescue = await Promise.any(found).catch(() => -1);
        if (stale()) return;
        if (rescue >= 0) {
          select(rescue, CENTRE);
          return;
        }
      }
      engine.setTrack(track);
      setStatus(track ? "ready" : "error");
      if (track) {
        setBpm(Math.round(track.bpm));
        setStepMs(Math.round(track.stepSeconds * 1000));
        setMode(track.mode);
      }
      visuals.wave(first ? CENTRE : origin, reduced());
      const after = playable(target + 1, 1);
      if (after < 0 || after === target) return;
      const neighbour = deck[after];
      prefetchTrack(neighbour);
      getArt(neighbour).catch(() => null);
    }

    function lookAll() {
      found = deck.map((cover, position) =>
        lookupPreview(cover).then(
          () => position,
          (error) => {
            if (disposed) throw error;
            missing.add(position);
            setGone((previous) => (previous.includes(cover.id) ? previous : [...previous, cover.id]));
            throw error;
          },
        ),
      );
      found.forEach((pending) => pending.catch(() => null));
    }

    function toggle() {
      if (!engine.ready) return;
      if (engine.looping) engine.stop();
      else engine.play();
    }

    function restore() {
      const changed = [];
      for (let step = 0; step < PADS; step += 1) if (engine.pattern[step] !== step) changed.push(step);
      engine.resetPattern();
      setMoved(0);
      if (!changed.length) return;
      if (reduced()) {
        resetSlices();
        return;
      }
      ringsFrom(CENTRE);
      changed.forEach((step) => {
        swaps[step].dataset.phase = "out";
      });
      const mine = token;
      wait(OUT_MS + 3 * RING_MS).then(() => {
        if (mine !== token || disposed) return;
        changed.forEach((step) => {
          setSlice(step, engine.pattern[step]);
          swaps[step].dataset.phase = "in";
        });
      });
    }

    function save() {
      exportPattern(currentArt, engine.pattern, fileName(deck[current]));
    }

    function setHover(pad) {
      if (pad === hoverPad) return;
      if (hoverPad >= 0) {
        tiles[hoverPad].removeAttribute("data-hover");
        keys[hoverPad]?.removeAttribute("data-hover");
      }
      hoverPad = pad;
      if (pad >= 0) {
        tiles[pad].setAttribute("data-hover", "");
        keys[pad]?.setAttribute("data-hover", "");
      }
    }

    function padAt(x, y) {
      if (!gridRect) gridRect = grid.getBoundingClientRect();
      const localX = x - gridRect.left;
      const localY = y - gridRect.top;
      if (localX < 0 || localY < 0 || localX >= gridRect.width || localY >= gridRect.height) return null;
      const pitch = (gridRect.width + GAP) / 4;
      const tile = pitch - GAP;
      const col = Math.min(3, Math.floor(localX / pitch));
      const row = Math.min(3, Math.floor(localY / pitch));
      const insideX = localX - col * pitch;
      const insideY = localY - row * pitch;
      if (insideX > tile || insideY > tile) return null;
      return { pad: row * 4 + col, x: insideX / tile, y: insideY / tile };
    }

    function pressPad(key, pad, reverse, originX = 0.5, originY = 0.5) {
      const tile = tiles[pad];
      if (!downCount[pad]) {
        tile.style.setProperty("--chop-ox", `${(originX * 100).toFixed(1)}%`);
        tile.style.setProperty("--chop-oy", `${(originY * 100).toFixed(1)}%`);
      }
      downCount[pad] += 1;
      tile.setAttribute("data-down", "");
      keys[pad]?.setAttribute("data-down", "");
      engine.press(key, pad, reverse);
    }

    function releasePad(key, pad) {
      engine.release(key);
      if (downCount[pad] > 0) downCount[pad] -= 1;
      if (!downCount[pad]) {
        tiles[pad].removeAttribute("data-down");
        keys[pad]?.removeAttribute("data-down");
      }
    }

    function releaseEverything() {
      pointers.clear();
      engine.releaseAll();
      downCount.fill(0);
      tiles.forEach((tile) => tile.removeAttribute("data-down"));
      keys.forEach((key) => key.removeAttribute("data-down"));
    }

    function onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.pointerType === "mouse") {
        event.preventDefault();
        grid.focus({ preventScroll: true });
      }
      try {
        grid.setPointerCapture(event.pointerId);
      } catch {
        gridRect = null;
      }
      gridRect = grid.getBoundingClientRect();
      const hit = padAt(event.clientX, event.clientY);
      pointers.set(event.pointerId, hit ? hit.pad : -1);
      if (hit) pressPad(`p${event.pointerId}`, hit.pad, event.shiftKey, hit.x, hit.y);
      else engine.ensure();
    }

    function onPointerMove(event) {
      const held = pointers.get(event.pointerId);
      const hit = padAt(event.clientX, event.clientY);
      if (held === undefined) {
        if (event.pointerType === "mouse") setHover(hit ? hit.pad : -1);
        return;
      }
      if (event.pointerType === "mouse") setHover(hit ? hit.pad : -1);
      if (!hit || hit.pad === held) return;
      const key = `p${event.pointerId}`;
      if (held >= 0) releasePad(key, held);
      pointers.set(event.pointerId, hit.pad);
      pressPad(key, hit.pad, event.shiftKey, hit.x, hit.y);
    }

    function onPointerEnd(event) {
      const held = pointers.get(event.pointerId);
      if (held === undefined) return;
      pointers.delete(event.pointerId);
      if (held >= 0) releasePad(`p${event.pointerId}`, held);
      engine.ensure();
    }

    function onPointerLeave(event) {
      if (event.pointerType === "mouse" && !pointers.has(event.pointerId)) setHover(-1);
      gridRect = null;
    }

    function onKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      const typing = tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable || (tag === "INPUT" && target.type !== "range");
      const pad = PAD_CODES.indexOf(event.code);
      if (pad >= 0) {
        if (typing) return;
        event.preventDefault();
        if (event.repeat) return;
        pressPad(`k${event.code}`, pad, event.shiftKey);
        return;
      }
      if (typing || tag === "INPUT") return;
      if (event.key === "Enter") {
        if (tag === "BUTTON" || tag === "A") return;
        event.preventDefault();
        toggle();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        restore();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        select(current + 1, { col: 3.5, row: 1.5 }, 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        select(current - 1, { col: -0.5, row: 1.5 }, -1);
      }
    }

    function onKeyUp(event) {
      const pad = PAD_CODES.indexOf(event.code);
      if (pad >= 0) releasePad(`k${event.code}`, pad);
    }

    function onVisibility() {
      if (!document.hidden) return;
      releaseEverything();
      engine.suspend();
      visuals.clear();
    }

    function onScroll() {
      gridRect = null;
    }

    function unlockAudio() {
      if (engine.ensure()?.state !== "running") return;
      UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, unlockAudio, true));
    }

    const resizeObserver = new ResizeObserver(() => {
      gridRect = null;
    });
    resizeObserver.observe(grid);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) {
        releaseEverything();
        engine.stop();
      }
    });
    visibilityObserver.observe(grid);

    grid.addEventListener("pointerdown", onPointerDown);
    grid.addEventListener("pointermove", onPointerMove);
    grid.addEventListener("pointerup", onPointerEnd);
    grid.addEventListener("pointercancel", onPointerEnd);
    grid.addEventListener("lostpointercapture", onPointerEnd);
    grid.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseEverything);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    UNLOCK_EVENTS.forEach((type) => document.addEventListener(type, unlockAudio, { capture: true, passive: true }));

    controllerRef.current = {
      engine,
      toggle,
      restore,
      save,
      select: (next, x, y) => {
        engine.ensure();
        select(next, x === undefined ? CENTRE : originFromPoint(x, y));
      },
    };
    lookAll();
    select(0, CENTRE);

    return () => {
      disposed = true;
      token += 1;
      controllerRef.current = null;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      grid.removeEventListener("pointerdown", onPointerDown);
      grid.removeEventListener("pointermove", onPointerMove);
      grid.removeEventListener("pointerup", onPointerEnd);
      grid.removeEventListener("pointercancel", onPointerEnd);
      grid.removeEventListener("lostpointercapture", onPointerEnd);
      grid.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseEverything);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, unlockAudio, true));
      removeGhosts();
      visuals.destroy();
      engine.destroy();
      artCache.clear();
      clearTracks();
    };
  }, [deck]);

  useEffect(() => {
    const engine = controllerRef.current?.engine;
    if (engine) Object.assign(engine.settings, settings);
  }, [settings]);

  const toggleSetting = useCallback((key) => {
    setSettings((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  const onSwing = useCallback((event) => {
    const swing = Number(event.target.value) / 100;
    setSettings((previous) => ({ ...previous, swing }));
  }, []);

  const cover = deck[index];
  const firstLevels = useMemo(() => artLevels(coverSource(deck[0])), [deck]);
  if (firstLevels[CHUNKY_LEVEL]) preload(firstLevels[CHUNKY_LEVEL], { as: "image", fetchPriority: "high" });
  const Root = embedded ? "div" : "main";
  const ready = status === "ready";
  const showTempo = ready && mode === "beats";
  const note = status === "error" ? "This preview would not load, so the pads stay silent. Try another cover." : "";

  if (!cover) {
    return (
      <Root className="chop bg-surface text-ink">
        <p className="text-ui-lg">No covers to cut right now.</p>
      </Root>
    );
  }

  return (
    <Root ref={rootRef} className="chop bg-surface text-ink" data-embedded={embedded || undefined}>
      <div className="chop__stage">
        <div className="chop__pads">
          <PadGrid gridRef={gridRef} status={status} levels={firstLevels} />
        </div>

        <div className="chop__bar" ref={barRef} aria-hidden="true">
          {PAD_LABELS.map((label, step) => (
            <span key={label} className="chop__tick" data-tick={step}>
              <span className="chop__fill" />
            </span>
          ))}
        </div>

        <div className="chop__rail" role="group" aria-label="Covers">
          {deck.map((item, position) => {
            const hidden = position !== index && gone.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={position === index}
                aria-label={`${cleanTitle(item.title)} by ${item.artist}`}
                aria-hidden={hidden || undefined}
                tabIndex={hidden ? -1 : undefined}
                disabled={hidden}
                className="chop__thumb"
                data-active={position === index || undefined}
                data-gone={hidden || undefined}
                style={{ backgroundImage: `url("${item.image}")` }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  controllerRef.current?.select(position, rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
              />
            );
          })}
        </div>

        <section className="chop__panel">
          <header className="chop__head">
            <h1 className="text-title-sm">Chop</h1>
            <p className="chop__hint text-ui-lg text-ink-secondary">Tap a square and the song plays on from it. Tap others over it and the cover rearranges into your flip.</p>
          </header>

          <div className="chop__song">
            <div className="chop__title">
              <MorphText as="h2" text={cleanTitle(cover.title)} className="text-title" />
            </div>
            <div className="chop__artist text-ui-lg">
              <MorphText text={cover.artist ?? ""} />
            </div>
            <p className="chop__note text-ui text-ink-secondary" data-show={note ? "" : undefined}>
              <span>{note || " "}</span>
            </p>
          </div>

          <div className="chop__stats" data-show={ready || undefined} aria-hidden={!ready || undefined}>
            {showTempo ? (
              <div className="chop__stat">
                <span className="chop__label text-ui text-ink-secondary">Tempo</span>
                <span className="chop__value">
                  <SlotNumber value={bpm} pad={2} className="text-title-sm" label={`${bpm} beats per minute`} />
                  <span className="chop__unit text-ui">BPM</span>
                </span>
              </div>
            ) : null}
            <div className="chop__stat">
              <span className="chop__label text-ui text-ink-secondary">Slice</span>
              <span className="chop__value">
                <SlotNumber value={stepMs} pad={3} className="text-title-sm" label={`${stepMs} milliseconds per slice`} />
                <span className="chop__unit text-ui">ms</span>
              </span>
            </div>
            <div className="chop__stat">
              <span className="chop__label text-ui text-ink-secondary">Moved</span>
              <span className="chop__value">
                <SlotNumber value={moved} pad={2} className="text-title-sm" label={`${moved} of 16 squares moved`} />
                <span className="chop__unit text-ui">of 16</span>
              </span>
            </div>
          </div>

          <div className="chop__keyboard" aria-hidden="true">
            <div className="chop__keys font-mono text-ui-sm" ref={keymapRef}>
              {PAD_LABELS.map((label, pad) => (
                <span key={label} className="chop__key" data-key={pad}>
                  {label}
                </span>
              ))}
            </div>
            <p className="chop__legend font-mono text-ui-sm text-ink-secondary">
              Hold stutters
              <br />
              Shift reverses
              <br />
              Enter loops
              <br />
              ← → change cover
            </p>
          </div>

          <div className="chop__controls">
            <div className="chop__transport">
              <button
                type="button"
                className="chop__button chop__button--play text-ui"
                disabled={!ready}
                aria-pressed={playing}
                onClick={() => controllerRef.current?.toggle()}
              >
                <PlayGlyph playing={playing} />
                <MorphText text={playing ? "Stop" : "Loop"} />
              </button>
              <button type="button" className="chop__button text-ui" disabled={!moved} onClick={() => controllerRef.current?.restore()}>
                Restore
              </button>
              <button type="button" className="chop__button text-ui" disabled={!moved || !canSave} onClick={() => controllerRef.current?.save()}>
                Save PNG
              </button>
            </div>
            <div className="chop__settings">
              <Switch label="Quantise" on={settings.quantise} onToggle={() => toggleSetting("quantise")} />
              <Switch label="Choke" on={settings.choke} onToggle={() => toggleSetting("choke")} />
              <label className="chop__swing text-ui">
                Swing
                <input
                  className="chop__range"
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={Math.round(settings.swing * 100)}
                  onChange={onSwing}
                />
                <span className="chop__percent">{Math.round(settings.swing * 100)}%</span>
              </label>
            </div>
          </div>
        </section>
      </div>
    </Root>
  );
}
