"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function UndoToast({ entry, duration, exiting, onUndo, onExpire }) {
  const [remaining, setRemaining] = useState(duration);

  useEffect(() => {
    const started = performance.now();
    const tick = window.setInterval(() => {
      const left = duration - (performance.now() - started);
      setRemaining(left > 0 ? left : 0);
    }, 100);
    const end = window.setTimeout(onExpire, duration);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [duration, onExpire]);

  const seconds = Math.max(1, Math.ceil(remaining / 1000));

  return (
    <div className="iet-toast" role="status" data-exiting={exiting ? "true" : undefined}>
      <svg className="iet-toast-ring" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <circle cx="12" cy="12" r={RADIUS} className="iet-toast-track" fill="none" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          className="iet-toast-sweep"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{ "--iet-ring": CIRCUMFERENCE, animationDuration: `${duration}ms` }}
        />
      </svg>
      <span className="iet-toast-text text-ui-lg">
        {entry.label} <span className="iet-toast-seconds">{seconds}s</span>
      </span>
      <button type="button" className="iet-toast-undo text-ui" onClick={onUndo} disabled={exiting}>
        <Undo2 size={13} strokeWidth={2} aria-hidden="true" />
        Undo
      </button>
    </div>
  );
}
