"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";

import ThreadRow from "./ThreadRow";
import { createThreadEngine, listHeight } from "./threadEngine";
import { QUEUE_LENGTH, buildQueue, totalMinutes } from "./threadQueue";
import { createPluckSound } from "./threadSound";
import "./thread.css";

const TOAST_MS = 5200;

function dismissToast(current) {
  return current && !current.leaving ? { ...current, leaving: true } : current;
}

function moveItem(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function ThreadExperience({ covers }) {
  const tracks = useMemo(() => buildQueue(covers, QUEUE_LENGTH), [covers]);
  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const capacity = tracks.length;

  const [order, setOrder] = useState(() => tracks.map((track) => track.id));
  const [exiting, setExiting] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [toast, setToast] = useState(null);
  const [toastSeen, setToastSeen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [focusId, setFocusId] = useState(null);
  const [announcement, setAnnouncement] = useState("");

  const rootRef = useRef(null);
  const headRef = useRef(null);
  const listRef = useRef(null);
  const canvasRef = useRef(null);
  const sheetRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(null);
  const mutedRef = useRef(false);
  const orderRef = useRef(order);
  const pendingFocusRef = useRef(null);
  const refillRef = useRef(null);
  const refillFocusRef = useRef(false);
  const serialRef = useRef(0);

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = createThreadEngine();
    return engineRef.current;
  }, []);

  const registerRow = useCallback((id, node, image) => getEngine().registerRow(id, node, image), [getEngine]);

  const unlockSound = useCallback(() => {
    if (soundRef.current) soundRef.current.unlock();
  }, []);

  const removeTrack = useCallback(
    (id) => {
      const current = orderRef.current;
      const index = current.indexOf(id);
      if (index < 0) return;
      const next = current.filter((item) => item !== id);
      orderRef.current = next;
      serialRef.current += 1;
      const serial = serialRef.current;
      const track = byId.get(id);
      setOrder(next);
      setExiting((list) => (list.includes(id) ? list : [...list, id]));
      setRemoved((stack) => [...stack, { id, index }]);
      setToast({ id, title: track ? track.title : "Song", serial, leaving: false });
      setToastSeen(true);
      setAnnouncement(`Removed ${track ? track.title : "song"}. ${next.length} left.`);
    },
    [byId],
  );

  const undo = useCallback(() => {
    const last = removed[removed.length - 1];
    if (!last) return;
    unlockSound();
    const next = orderRef.current.slice();
    next.splice(Math.min(last.index, next.length), 0, last.id);
    orderRef.current = next;
    pendingFocusRef.current = last.id;
    setOrder(next);
    setRemoved(removed.slice(0, -1));
    setExiting((list) => list.filter((id) => id !== last.id));
    setToast(dismissToast);
    const track = byId.get(last.id);
    setAnnouncement(`Restored ${track ? track.title : "song"}.`);
  }, [removed, unlockSound, byId]);

  const refill = useCallback(() => {
    unlockSound();
    const next = tracks.map((track) => track.id);
    orderRef.current = next;
    pendingFocusRef.current = next[0] ?? null;
    setOrder(next);
    setRemoved([]);
    setExiting([]);
    setToast(dismissToast);
    setAnnouncement(`Queue refilled with ${next.length} songs.`);
  }, [tracks, unlockSound]);

  useEffect(() => {
    const sound = createPluckSound();
    soundRef.current = sound;
    return () => sound.destroy();
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useLayoutEffect(() => {
    getEngine().setHandlers({
      onRemove: removeTrack,
      onExited: (id) => setExiting((list) => list.filter((item) => item !== id)),
      onReorder: (next, id) => {
        orderRef.current = next;
        pendingFocusRef.current = id;
        setOrder(next);
      },
      onGesture: unlockSound,
      onTap: (id) => getEngine().focusRow(id),
      onPluck: (amplitude, length) => {
        if (!mutedRef.current && soundRef.current) soundRef.current.pluck(amplitude, length);
      },
    });
  }, [getEngine, removeTrack, unlockSound]);

  useLayoutEffect(() => {
    const engine = getEngine();
    engine.mount({
      root: rootRef.current,
      head: headRef.current,
      list: listRef.current,
      canvas: canvasRef.current,
      sheet: sheetRef.current,
      capacity,
    });
    return () => engine.destroy();
  }, [getEngine, capacity]);

  useLayoutEffect(() => {
    orderRef.current = order;
    const engine = getEngine();
    engine.setOrder(order);
    const pending = pendingFocusRef.current;
    if (pending) {
      pendingFocusRef.current = null;
      if (order.includes(pending)) engine.focusRow(pending);
    }
  }, [order, getEngine]);

  const toastSerial = toast && !toast.leaving ? toast.serial : 0;
  useEffect(() => {
    if (!toastSerial) return undefined;
    const timer = window.setTimeout(() => setToast((current) => (current && current.serial === toastSerial ? dismissToast(current) : current)), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastSerial]);

  const onToastAnimationEnd = useCallback((event) => {
    if (event.target !== event.currentTarget) return;
    setToast((current) => (current && current.leaving ? null : current));
  }, []);

  const onFocusRow = useCallback((id) => setFocusId(id), []);

  const onKeyDown = useCallback(
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      const li = event.target.closest ? event.target.closest("[data-thread-row]") : null;
      if (!li) return;
      const id = li.dataset.threadRow;
      const current = orderRef.current;
      const index = current.indexOf(id);
      if (index < 0) return;
      const engine = getEngine();
      unlockSound();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const target = Math.min(current.length - 1, Math.max(0, index + direction));
        if (target === index) return;
        if (event.altKey) {
          const next = moveItem(current, index, target);
          orderRef.current = next;
          pendingFocusRef.current = id;
          engine.nudge(id, direction);
          setOrder(next);
        } else engine.focusRow(current[target]);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        engine.focusRow(current[event.key === "Home" ? 0 : current.length - 1]);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const neighbour = current[index + 1] ?? current[index - 1] ?? null;
        if (!engine.remove(id)) return;
        if (neighbour) {
          pendingFocusRef.current = neighbour;
          engine.focusRow(neighbour);
        } else refillFocusRef.current = true;
      }
    },
    [getEngine, undo, unlockSound],
  );

  const queued = useMemo(() => order.map((id) => byId.get(id)).filter(Boolean), [order, byId]);
  const rows = useMemo(() => {
    const list = [];
    tracks.forEach((track, slot) => {
      const live = order.indexOf(track.id);
      if (live >= 0) {
        list.push({ track, slot, index: live, live: true });
        return;
      }
      if (!exiting.includes(track.id)) return;
      const entry = removed.findLast((item) => item.id === track.id);
      list.push({ track, slot, index: entry ? entry.index : slot, live: false });
    });
    return list;
  }, [tracks, order, exiting, removed]);
  const songs = queued.length;
  const minutes = totalMinutes(queued);
  const tabId = order.includes(focusId) ? focusId : order[0];
  const empty = songs === 0;

  useLayoutEffect(() => {
    if (!empty || !refillFocusRef.current) return;
    refillFocusRef.current = false;
    if (refillRef.current) refillRef.current.focus();
  }, [empty]);

  return (
    <main ref={rootRef} className="thread" onKeyDown={onKeyDown}>
      <noscript>
        <style>{".thread-bead__image{opacity:1;filter:none;transform:none}"}</style>
      </noscript>
      <section className="thread-card" aria-labelledby="thread-title">
        <div className="thread-sheet" aria-hidden="true">
          <div className="thread-sheet__cap" />
          <div className="thread-sheet__clip">
            <div ref={sheetRef} className="thread-sheet__body" />
          </div>
        </div>
        <header ref={headRef} className="thread-head">
          <div className="thread-head__top">
            <h1 id="thread-title" className="thread-head__title text-title-sm">
              Up next
            </h1>
            <button
              type="button"
              className="thread-sound text-ui-sm"
              aria-pressed={!muted}
              onClick={() => {
                unlockSound();
                setMuted((value) => !value);
              }}
            >
              <span className="thread-sound__dot" aria-hidden="true" />
              {muted ? "Sound off" : "Sound on"}
            </button>
          </div>
          <p className="thread-meta text-ui">
            <span className="thread-count" data-short={songs < 10 ? "true" : undefined}>
              <SlotNumber value={songs} pad={2} label={String(songs)} />
            </span>{" "}
            {songs === 1 ? "song" : "songs"} ·{" "}
            <span className="thread-count" data-short={minutes < 10 ? "true" : undefined}>
              <SlotNumber value={minutes} pad={2} label={String(minutes)} />
            </span>{" "}
            min
          </p>
        </header>
        <div ref={listRef} className="thread-list" style={{ height: `${listHeight(capacity)}px` }}>
          <canvas ref={canvasRef} className="thread-canvas" aria-hidden="true" />
          <ol className="thread-rows" aria-label="Up next">
            {rows.map(({ track, slot, index, live }) => (
              <ThreadRow
                key={track.id}
                track={track}
                slot={slot}
                index={index}
                total={songs}
                tabbable={live && track.id === tabId}
                register={registerRow}
                onFocusRow={onFocusRow}
              />
            ))}
          </ol>
          {empty ? (
            <div className="thread-empty">
              <p className="text-heading">Nothing up next</p>
              <p className="thread-empty__line text-ui">The thread is bare.</p>
              <button ref={refillRef} type="button" className="thread-button text-ui" onClick={refill}>
                Refill the queue
              </button>
            </div>
          ) : null}
        </div>
      </section>
      <div className="thread-dock">
        <p className="thread-sr" role="status" aria-live="polite">
          {announcement}
        </p>
        {toast ? (
          <div
            className="thread-toast text-ui"
            data-state={toast.leaving ? "leaving" : "shown"}
            onAnimationEnd={onToastAnimationEnd}
          >
            <span className="thread-toast__text">
              Removed{" "}
              <strong key={toast.serial} className="thread-toast__title">
                {toast.title}
              </strong>
            </span>
            <button type="button" className="thread-toast__undo text-ui" onClick={undo} tabIndex={toast.leaving ? -1 : 0}>
              Undo
            </button>
          </div>
        ) : (
          <p className="thread-hint text-ui-sm" data-return={toastSeen ? "true" : undefined}>
            <span className="thread-hint__long">Swipe a song right to remove it · hold to reorder</span>
            <span className="thread-hint__short">Swipe right to remove · hold to reorder</span>
          </p>
        )}
      </div>
    </main>
  );
}

