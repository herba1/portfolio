"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { pop, swish, wakeAudio } from "./foley";

import "./now-toasts.css";

const LIFE = 5000;
const ROW = 72;
const VISIBLE = 3;
const MAX = 6;

function Heart({ on }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M10 16.6s-6.1-3.7-6.1-8.2A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6.1 2.1c0 4.5-6.1 8.2-6.1 8.2z"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M3.5 5.5h9M3.5 10h9M3.5 14.5h5M14.5 12v6M11.5 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M4.5 5v10l7-5zM14 5v10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function Toast({ toast, index, expanded, onDismiss, onUndo, thumbRef }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const hidden = index >= (expanded ? MAX : VISIBLE);
  const y = expanded ? -index * ROW : -index * 12;
  const s = expanded ? 1 : 1 - index * 0.055;

  const onPointerDown = (event) => {
    if (event.button > 0 || event.target.closest("button")) return;
    drag.current = { id: event.pointerId, x: event.clientX, t: event.timeStamp, dx: 0, v: 0 };
    ref.current.setAttribute("data-dragging", "");
    try {
      ref.current.setPointerCapture(event.pointerId);
    } catch {
      drag.current.free = true;
    }
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dt = Math.max(1, event.timeStamp - d.t);
    d.v = (dx - d.dx) / dt;
    d.dx = dx;
    d.t = event.timeStamp;
    ref.current.style.setProperty("--dx", `${dx}px`);
    ref.current.style.setProperty("--fade", String(Math.max(0, 1 - Math.abs(dx) / 260)));
  };
  const onPointerUp = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    const el = ref.current;
    el.removeAttribute("data-dragging");
    if (Math.abs(d.dx) > 96 || Math.abs(d.v) > 0.6) {
      const dir = Math.sign(d.dx || d.v);
      el.style.setProperty("--dx", `${dir * (el.offsetWidth + 80)}px`);
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
      style={{ "--y": `${y}px`, "--s": s, zIndex: 50 - index }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="nt-thumb" ref={thumbRef} data-landed={toast.landed ? "" : undefined}>
        <img src={toast.track.image} alt="" draggable={false} crossOrigin="anonymous" />
        <span className="nt-badge">{toast.kind === "like" ? <Heart on /> : toast.kind === "next" ? <NextIcon /> : <QueueIcon />}</span>
        {toast.kind === "like" && toast.landed ? (
          <span className="nt-burst" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ "--a": `${i * 45}deg` }} />
            ))}
          </span>
        ) : null}
      </span>
      <span className="nt-text">
        <span className="nt-title">{toast.title}</span>
        <span className="nt-sub">{toast.sub}</span>
      </span>
      <button type="button" className="nt-undo" onClick={() => onUndo(toast)}>
        Undo
      </button>
    </li>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(8);
  const rootRef = useRef(null);
  const toasterRef = useRef(null);
  const coverEls = useRef(new Map());
  const thumbEls = useRef(new Map());
  const pending = useRef([]);
  const seq = useRef(0);
  const [liked, setLiked] = useState(() => new Set());
  const [queue, setQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [hover, setHover] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const expanded = hover || focusIn || touchOpen;
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = expanded;
  }, [expanded]);

  const dismiss = useCallback((id, swiped = false) => {
    if (swiped) swish();
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), swiped ? 260 : 360);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      setToasts((ts) => {
        let changed = false;
        const next = ts.map((t, i) => {
          if (t.leaving || i >= VISIBLE) return t;
          changed = true;
          return { ...t, left: t.left - 100 };
        });
        if (!changed) return ts;
        next.filter((t) => t.left <= 0 && !t.leaving).forEach((t) => setTimeout(() => dismiss(t.id), 0));
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [dismiss]);

  const push = (kind, track, title, sub) => {
    wakeAudio();
    seq.current += 1;
    const id = seq.current;
    const toast = { id, kind, track, title, sub, left: LIFE, leaving: false, landed: false };
    pending.current.push({ id, from: coverEls.current.get(track.id) });
    setToasts((ts) => {
      const next = [toast, ...ts];
      next.slice(MAX).forEach((t) => setTimeout(() => dismiss(t.id), 0));
      return next;
    });
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !pending.current.length) return;
    const jobs = pending.current.splice(0);
    const origin = root.getBoundingClientRect();
    jobs.forEach(({ id, from }) => {
      const thumb = thumbEls.current.get(id);
      const markLanded = () => setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, landed: true } : t)));
      if (!thumb || !from) {
        markLanded();
        return;
      }
      const a = from.getBoundingClientRect();
      const dock = toasterRef.current.getBoundingClientRect();
      const fly = document.createElement("img");
      fly.src = from.querySelector("img")?.src || "";
      fly.className = "nt-fly";
      root.appendChild(fly);
      const x0 = a.left - origin.left;
      const y0 = a.top - origin.top;
      const x1 = dock.left - origin.left + 12;
      const y1 = dock.bottom - origin.top - 52;
      const s0 = a.width / 40;
      const cx = (x0 + x1) / 2 + (x1 - x0) * 0.2;
      const cy = Math.min(y0, y1) - Math.min(220, Math.max(80, Math.abs(y1 - y0) * 0.45));
      const frames = Array.from({ length: 13 }, (_, k) => {
        const e = k / 12;
        const m = 1 - e;
        const x = m * m * x0 + 2 * m * e * cx + e * e * x1;
        const y = m * m * y0 + 2 * m * e * cy + e * e * y1;
        const s = s0 + (1 - s0) * e;
        const r = Math.sin(Math.PI * e) * -14;
        return { transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`, offset: e };
      });
      const anim = fly.animate(frames, { duration: 640, easing: "cubic-bezier(0.3, 0.6, 0.25, 1)", fill: "forwards" });
      anim.onfinish = () => {
        fly.remove();
        markLanded();
        pop();
      };
    });
  });

  const toggleLike = (track) => {
    const on = !liked.has(track.id);
    setLiked((s) => {
      const next = new Set(s);
      if (on) next.add(track.id);
      else next.delete(track.id);
      return next;
    });
    push("like", track, on ? "Added to Liked Songs" : "Removed from Liked Songs", `${track.title} · ${track.artist}`);
  };

  const addQueue = (track, next) => {
    setQueue((q) => (next ? [track.id, ...q] : [...q, track.id]));
    const position = next ? 1 : queue.length + 1;
    push(next ? "next" : "queue", track, `${next ? "Playing next" : "Queued"}: ${track.title}`, position === 1 ? "Up next after this song" : `Number ${position} in your queue`);
  };

  const undo = (toast) => {
    if (toast.kind === "like") {
      setLiked((s) => {
        const next = new Set(s);
        if (toast.title.startsWith("Added")) next.delete(toast.track.id);
        else next.add(toast.track.id);
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

  const live = toasts.filter((t) => !t.leaving);
  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="nt-root" data-embedded={embedded ? "" : undefined} onKeyDown={onKeyDown}>
      <div className="nt-scroll" data-scroll-contain="">
        <div className="nt-column">
          {embedded ? null : (
            <header className="nt-head">
              <h1 className="text-title-sm">Now Toasts</h1>
              <p className="nt-hint text-ui-lg">Like or queue a song and its cover flies down into a toast. Hover or tap the stack to fan it out, swipe a toast away.</p>
            </header>
          )}
          <ol className="nt-list">
            {tracks.map((t, i) => (
              <li key={t.id} className="nt-row">
                <span className="nt-n">{i + 1}</span>
                <span
                  className="nt-cover"
                  ref={(el) => {
                    if (el) coverEls.current.set(t.id, el);
                    else coverEls.current.delete(t.id);
                  }}
                >
                  <img src={t.image} alt="" draggable={false} crossOrigin="anonymous" />
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
      <section
        ref={toasterRef}
        className="nt-toaster"
        aria-label="Notifications"
        aria-live="polite"
        data-expanded={expanded ? "" : undefined}
        style={{ "--count": Math.max(1, Math.min(live.length, MAX)) }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
        onPointerDown={(e) => e.pointerType !== "mouse" && setTouchOpen(true)}
        onFocus={() => setFocusIn(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocusIn(false)}
      >
        <ol className="nt-stack">
          {(() => {
            let k = 0;
            return toasts.map((t) => {
              const index = t.leaving ? k : k++;
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
                    else thumbEls.current.delete(t.id);
                  }}
                />
              );
            });
          })()}
        </ol>
      </section>
      {touchOpen ? <div className="nt-catch" aria-hidden="true" onPointerDown={() => setTouchOpen(false)} /> : null}
    </Root>
  );
}
