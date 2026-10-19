"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { pop, swish, wakeAudio } from "./foley";

import "./now-toasts.css";

const LIFE = 5000;
const GAP = 8;
const HEIGHT = 64;
const PEEK = 10;
const VISIBLE = 3;
const MAX = 5;
const FLIGHT = 480;

function Heart({ on }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M10 16.6s-6.1-3.7-6.1-8.2A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6.1 2.1c0 4.5-6.1 8.2-6.1 8.2z"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M3.5 5.5h9M3.5 10h9M3.5 14.5h5M14.5 12v6M11.5 15h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M4.5 5v10l7-5zM14 5v10" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const ICONS = { like: <Heart on />, unlike: <Heart />, next: <NextIcon />, queue: <QueueIcon /> };

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Toast({ toast, index, expanded, onDismiss, onUndo, thumbRef }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const hidden = index >= (expanded ? MAX : VISIBLE);
  const y = expanded ? -index * (HEIGHT + GAP) : -index * PEEK;
  const s = expanded ? 1 : 1 - index * 0.05;

  const onPointerDown = (event) => {
    if (event.button > 0 || event.target.closest("button")) return;
    drag.current = { id: event.pointerId, x: event.clientX, t: event.timeStamp, dx: 0, v: 0 };
    ref.current.setAttribute("data-dragging", "");
    try {
      ref.current.setPointerCapture(event.pointerId);
    } catch {}
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dt = Math.max(1, event.timeStamp - d.t);
    d.v = d.v * 0.4 + ((dx - d.dx) / dt) * 0.6;
    d.dx = dx;
    d.t = event.timeStamp;
    ref.current.style.setProperty("--dx", `${dx}px`);
    ref.current.style.setProperty("--fade", String(Math.max(0, 1 - Math.abs(dx) / 320)));
  };
  const onPointerUp = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    const el = ref.current;
    el.removeAttribute("data-dragging");
    const fling = Math.abs(d.v) > 0.5 && Math.sign(d.v) === Math.sign(d.dx);
    if (Math.abs(d.dx) > 112 || fling) {
      const dir = Math.sign(d.dx || d.v);
      el.style.setProperty("--dx", `${dir * (el.offsetWidth + 48)}px`);
      el.style.setProperty("--fade", "0");
      el.setAttribute("data-swiped", "");
      onDismiss(toast.id, true);
    } else {
      el.style.setProperty("--dx", "0px");
      el.style.setProperty("--fade", "1");
    }
  };

  return (
    <li
      ref={ref}
      className="nt-toast"
      data-kind={toast.kind}
      data-leaving={toast.leaving ? "" : undefined}
      data-hidden={hidden ? "" : undefined}
      data-front={index === 0 ? "" : undefined}
      data-fresh={toast.rev === 0 ? "" : undefined}
      style={{ "--y": `${y}px`, "--s": s, zIndex: 50 - index }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="nt-thumb">
        <img ref={thumbRef} src={toast.track.image} alt="" draggable={false} />
        <span className="nt-badge" key={toast.rev}>
          {ICONS[toast.kind]}
        </span>
      </span>
      <span className="nt-text" key={toast.rev}>
        <span className="nt-title">{toast.title}</span>
        <span className="nt-sub">{toast.sub}</span>
      </span>
      <button type="button" className="nt-undo" tabIndex={index === 0 || expanded ? 0 : -1} onClick={() => onUndo(toast)}>
        Undo
      </button>
    </li>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(8);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const toasterRef = useRef(null);
  const coverEls = useRef(new Map());
  const thumbEls = useRef(new Map());
  const flights = useRef(new Map());
  const timers = useRef(new Map());
  const pending = useRef([]);
  const seq = useRef(0);
  const toastsRef = useRef([]);
  const pausedRef = useRef(false);
  const [liked, setLiked] = useState(() => new Set());
  const [queue, setQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [hover, setHover] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const live = toasts.filter((t) => !t.leaving);
  const expanded = (hover || focusIn || touchOpen) && live.length > 0;

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const remove = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    thumbEls.current.delete(id);
    flights.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id, swiped = false) => {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer.handle);
      timers.current.delete(id);
      if (swiped) swish();
      setToasts((ts) => {
        let k = 0;
        return ts.map((t) => {
          if (t.leaving) return t;
          const slot = k++;
          return t.id === id ? { ...t, leaving: true, slot, swiped } : t;
        });
      });
      if (!toastsRef.current.some((t) => !t.leaving && t.id !== id)) setTouchOpen(false);
      setTimeout(() => remove(id), swiped ? 280 : 360);
    },
    [remove, setTouchOpen],
  );

  const arm = useCallback(
    (id, ms) => {
      const timer = timers.current.get(id) || { remaining: ms };
      clearTimeout(timer.handle);
      timer.remaining = ms;
      timer.start = performance.now();
      timer.handle = pausedRef.current ? null : setTimeout(() => dismiss(id), ms);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const pause = () => {
      timers.current.forEach((timer) => {
        if (!timer.handle) return;
        clearTimeout(timer.handle);
        timer.handle = null;
        timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.start));
      });
    };
    const resume = () => {
      timers.current.forEach((timer, id) => {
        if (timer.handle) return;
        timer.start = performance.now();
        timer.handle = setTimeout(() => dismiss(id), Math.max(1200, timer.remaining));
      });
    };
    const sync = () => {
      pausedRef.current = expanded || document.hidden;
      if (pausedRef.current) pause();
      else resume();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [expanded, dismiss]);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((timer) => clearTimeout(timer.handle));
  }, []);

  const push = (kind, track, title, sub, undo) => {
    wakeAudio();
    const family = kind === "unlike" ? "like" : kind;
    const same = family === "like" ? toastsRef.current.find((t) => !t.leaving && t.track.id === track.id && (t.kind === "like" || t.kind === "unlike")) : null;
    if (same) {
      setToasts((ts) => [{ ...same, kind, title, sub, undo, rev: same.rev + 1 }, ...ts.filter((t) => t.id !== same.id)]);
      arm(same.id, LIFE);
      return;
    }
    seq.current += 1;
    const id = seq.current;
    const toast = { id, kind, track, title, sub, undo, rev: 0, leaving: false };
    pending.current.push({ id, from: coverEls.current.get(track.id) });
    setToasts((ts) => [toast, ...ts]);
    toastsRef.current.filter((t) => !t.leaving).slice(MAX - 1).forEach((t) => dismiss(t.id));
    arm(id, LIFE);
  };

  useLayoutEffect(() => {
    if (!pending.current.length) return;
    const jobs = pending.current.splice(0);
    const dock = toasterRef.current?.getBoundingClientRect();
    const view = scrollRef.current?.getBoundingClientRect();
    jobs.forEach(({ id, from }) => {
      const img = thumbEls.current.get(id);
      if (!img || !dock) return;
      const tx = dock.left + GAP;
      const ty = dock.bottom - HEIGHT + GAP;
      const done = () => {
        flights.current.delete(id);
        pop();
      };
      if (!from || !view) {
        const anim = img.animate([{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        anim.onfinish = done;
        return;
      }
      const a = from.getBoundingClientRect();
      const top = Math.min(Math.max(a.top, view.top - a.height * 0.5), view.bottom - a.height * 0.5);
      const dx = a.left - tx;
      const dy = top - ty;
      const lift = Math.min(1, Math.abs(dy) / 400);
      const anim = img.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, boxShadow: "0 0 0 0 rgb(0 0 0 / 0)" },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${1 + 0.06 * lift})`, boxShadow: "0 12px 24px -8px rgb(0 0 0 / 0.28)", offset: 0.5 },
          { transform: "none", boxShadow: "0 0 0 0 rgb(0 0 0 / 0)" },
        ],
        { duration: FLIGHT, easing: "cubic-bezier(0.45, 0, 0.15, 1)" },
      );
      img.closest(".nt-toast")?.setAttribute("data-flying", "");
      flights.current.set(id, anim);
      anim.onfinish = () => {
        img.closest(".nt-toast")?.removeAttribute("data-flying");
        done();
      };
      anim.oncancel = () => img.closest(".nt-toast")?.removeAttribute("data-flying");
    });
  });

  const toggleLike = (track) => {
    const was = liked.has(track.id);
    setLiked((s) => {
      const next = new Set(s);
      if (was) next.delete(track.id);
      else next.add(track.id);
      return next;
    });
    push(was ? "unlike" : "like", track, was ? "Removed from Liked Songs" : "Added to Liked Songs", `${track.title} · ${track.artist}`, { liked: was });
  };

  const addQueue = (track, next) => {
    const position = next ? 1 : queue.length + 1;
    setQueue((q) => (next ? [track.id, ...q] : [...q, track.id]));
    push(next ? "next" : "queue", track, next ? "Playing next" : "Added to queue", next ? `${track.title} · after this song` : position === 1 ? `${track.title} · next in queue` : `${track.title} · ${ordinal(position)} in queue`, {});
  };

  const undo = (toast) => {
    if (toast.kind === "like" || toast.kind === "unlike") {
      setLiked((s) => {
        const next = new Set(s);
        if (toast.undo.liked) next.add(toast.track.id);
        else next.delete(toast.track.id);
        return next;
      });
    } else {
      setQueue((q) => {
        const i = toast.kind === "next" ? q.indexOf(toast.track.id) : q.lastIndexOf(toast.track.id);
        return i < 0 ? q : [...q.slice(0, i), ...q.slice(i + 1)];
      });
    }
    dismiss(toast.id);
  };

  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    const front = toasts.find((t) => !t.leaving);
    if (front) dismiss(front.id);
  };

  const Root = embedded ? "div" : "main";
  let k = 0;

  return (
    <Root ref={rootRef} className="nt-root" data-embedded={embedded ? "" : undefined} onKeyDown={onKeyDown}>
      <div ref={scrollRef} className="nt-scroll" data-scroll-contain="">
        <div className="nt-column">
          {embedded ? null : (
            <header className="nt-head">
              <h1 className="nt-h1">Now Toasts</h1>
            </header>
          )}
          <ol className="nt-list">
            {tracks.map((t) => (
              <li key={t.id} className="nt-row">
                <span
                  className="nt-cover"
                  ref={(el) => {
                    if (el) coverEls.current.set(t.id, el);
                    else coverEls.current.delete(t.id);
                  }}
                >
                  <img src={t.image} alt="" draggable={false} />
                </span>
                <span className="nt-row-text">
                  <span className="nt-row-title">{t.title}</span>
                  <span className="nt-row-sub">
                    {t.artist} · {t.album}
                  </span>
                </span>
                <span className="nt-actions">
                  <button
                    type="button"
                    className="nt-act"
                    data-on={liked.has(t.id) ? "" : undefined}
                    aria-pressed={liked.has(t.id)}
                    aria-label={liked.has(t.id) ? `Remove ${t.title} from Liked Songs` : `Like ${t.title}`}
                    onClick={() => toggleLike(t)}
                  >
                    <Heart on={liked.has(t.id)} />
                  </button>
                  <button type="button" className="nt-act" aria-label={`Play ${t.title} next`} onClick={() => addQueue(t, true)}>
                    <NextIcon />
                  </button>
                  <button type="button" className="nt-act" aria-label={`Add ${t.title} to queue`} onClick={() => addQueue(t, false)}>
                    <QueueIcon />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="nt-veil" aria-hidden="true" data-on={expanded ? "" : undefined} style={{ "--count": Math.max(1, Math.min(live.length, MAX)) }} />
      <section
        ref={toasterRef}
        className="nt-toaster"
        aria-label="Notifications"
        aria-live="polite"
        data-expanded={expanded ? "" : undefined}
        style={{ "--count": Math.max(1, Math.min(live.length, MAX)) }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
        onPointerDown={(e) => e.pointerType !== "mouse" && live.length > 1 && setTouchOpen(true)}
        onFocus={() => setFocusIn(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocusIn(false)}
      >
        <ol className="nt-stack">
          {toasts.map((t) => {
            const index = t.leaving ? t.slot : k++;
            return (
              <Toast
                key={t.id}
                toast={t}
                index={index}
                expanded={expanded}
                onDismiss={dismiss}
                onUndo={undo}
                thumbRef={(el) => {
                  if (el) thumbEls.current.set(t.id, el);
                }}
              />
            );
          })}
        </ol>
      </section>
      {touchOpen && expanded ? <div className="nt-catch" aria-hidden="true" onPointerDown={() => setTouchOpen(false)} /> : null}
    </Root>
  );
}
