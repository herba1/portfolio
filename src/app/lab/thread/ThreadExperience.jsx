"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";

import ThreadRow from "./ThreadRow";
import { createThreadEngine, listHeight } from "./threadEngine";
import { QUEUE_LENGTH, buildQueue, totalMinutes } from "./threadQueue";
import { createPluckSound } from "./threadSound";
import "./thread.css";

const TOAST_MS = 5200;
const ROLL_STAGGER_MS = 1400;

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
  const [ready, setReady] = useState(false);
  const [rollStagger, setRollStagger] = useState(true);
  const [muted, setMuted] = useState(false);
  const [focusId, setFocusId] = useState(null);

  const rootRef = useRef(null);
  const listRef = useRef(null);
  const canvasRef = useRef(null);
  const sheetRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(null);
  const mutedRef = useRef(false);
  const orderRef = useRef(order);
  const pendingFocusRef = useRef(null);
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
      setToast({ id, title: track ? track.title : "Song", serial });
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
    setOrder(next);
    setRemoved(removed.slice(0, -1));
    setExiting((list) => list.filter((id) => id !== last.id));
    setToast(null);
  }, [removed, unlockSound]);

  const refill = useCallback(() => {
    unlockSound();
    const next = tracks.map((track) => track.id);
    orderRef.current = next;
    setOrder(next);
    setRemoved([]);
    setExiting([]);
    setToast(null);
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
      onIntro: () => setReady(true),
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

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setTimeout(() => setRollStagger(false), ROLL_STAGGER_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

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
        if (engine.remove(id) && neighbour) {
          pendingFocusRef.current = neighbour;
          engine.focusRow(neighbour);
        }
      }
    },
    [getEngine, undo, unlockSound],
  );

  const queued = useMemo(() => order.map((id) => byId.get(id)).filter(Boolean), [order, byId]);
  const rows = useMemo(() => {
    const list = queued.map((track, index) => ({ track, index, live: true }));
    for (const id of exiting) {
      if (order.includes(id)) continue;
      const track = byId.get(id);
      if (!track) continue;
      const entry = removed.findLast((item) => item.id === id);
      list.push({ track, index: entry ? entry.index : 0, live: false });
    }
    return list;
  }, [queued, exiting, order, byId, removed]);
  const songs = queued.length;
  const minutes = totalMinutes(queued);
  const tabId = order.includes(focusId) ? focusId : order[0];
  const empty = songs === 0;

  return (
    <main
      ref={rootRef}
      className="thread"
      onKeyDown={onKeyDown}
      data-roll-stagger={rollStagger ? "true" : undefined}
    >
      <noscript>
        <style>{".thread-row{opacity:1!important;filter:none!important}"}</style>
      </noscript>
      <section className="thread-card" aria-labelledby="thread-title">
        <div ref={sheetRef} className="thread-sheet" aria-hidden="true" />
        <header className="thread-head">
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
            <span className="thread-count" data-short={(ready ? songs : 0) < 10 ? "true" : undefined}>
              <SlotNumber value={ready ? songs : 0} pad={2} label={String(songs)} />
            </span>{" "}
            {songs === 1 ? "song" : "songs"} ·{" "}
            <span className="thread-count" data-short={(ready ? minutes : 0) < 10 ? "true" : undefined}>
              <SlotNumber value={ready ? minutes : 0} pad={2} label={String(minutes)} />
            </span>{" "}
            min
          </p>
        </header>
        <div ref={listRef} className="thread-list" style={{ height: `${listHeight(capacity)}px` }}>
          <canvas ref={canvasRef} className="thread-canvas" aria-hidden="true" />
          <ol className="thread-rows" aria-label="Up next">
            {rows.map(({ track, index, live }) => (
              <ThreadRow
                key={track.id}
                track={track}
                index={index}
                total={songs}
                numbered={ready}
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
              <button type="button" className="thread-button text-ui" onClick={refill}>
                Refill the queue
              </button>
            </div>
          ) : null}
        </div>
      </section>
      <div className="thread-dock" aria-live="polite">
        {toast ? (
          <div key={toast.serial} className="thread-toast text-ui">
            <span className="thread-toast__text">
              Removed <strong>{toast.title}</strong>
            </span>
            <button type="button" className="thread-toast__undo text-ui" onClick={undo}>
              Undo
            </button>
          </div>
        ) : (
          <p key="hint" className="thread-hint text-ui-sm">
            Swipe a song right to remove it · hold to reorder
          </p>
        )}
      </div>
    </main>
  );
}
