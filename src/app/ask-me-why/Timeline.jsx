"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

const VIEWS = [
  { label: "All", ms: null },
  { label: "30s", ms: 30000 },
  { label: "10s", ms: 10000 },
  { label: "4s", ms: 4000 },
];

const MIN_MS = 120;

const clock = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const Timeline = forwardRef(function Timeline(
  {
    cast,
    segments,
    durationMs,
    lineOnsets,
    selectedId,
    onSelect,
    onCreate,
    onChange,
    onRemove,
    onSeek,
  },
  ref,
) {
  const [viewMs, setViewMs] = useState(null);
  const [follow, setFollow] = useState(true);
  const [drag, setDrag] = useState(null);
  const boxRef = useRef(null);
  const headRef = useRef(null);
  const posRef = useRef(0);
  const startRef = useRef(0);

  const span = viewMs || durationMs || 1;
  const viewStart = viewMs
    ? Math.min(Math.max(0, posRef.current - viewMs / 2), Math.max(0, durationMs - viewMs))
    : 0;

  const place = useCallback(
    (ms) => `${((ms - startRef.current) / span) * 100}%`,
    [span],
  );

  const msAt = useCallback(
    (clientX) => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(durationMs, startRef.current + ratio * span));
    },
    [durationMs, span],
  );

  const paint = useCallback(
    (ms) => {
      posRef.current = ms;
      const next = viewMs
        ? Math.min(Math.max(0, ms - viewMs / 2), Math.max(0, durationMs - viewMs))
        : 0;
      if (follow || !viewMs) startRef.current = next;
      const box = boxRef.current;
      if (box) box.style.setProperty("--view-start", `${startRef.current}`);
      const head = headRef.current;
      if (head) {
        head.style.left = `${((ms - startRef.current) / span) * 100}%`;
      }
    },
    [viewMs, durationMs, follow, span],
  );

  useImperativeHandle(ref, () => ({ paint }), [paint]);

  useEffect(() => {
    startRef.current = viewStart;
    paint(posRef.current);
  }, [viewMs, viewStart, paint]);

  const onLaneDown = (e, singer) => {
    if (e.button !== 0) return;
    const at = msAt(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", singer, anchor: at, id: null });
  };

  const onMove = (e) => {
    if (!drag) return;
    const at = msAt(e.clientX);

    if (drag.kind === "create") {
      const start = Math.min(drag.anchor, at);
      const end = Math.max(drag.anchor, at);
      if (end - start < 60) return;
      if (!drag.id) {
        const id = `s${Math.round(start)}-${drag.singer || "any"}`;
        onCreate({ id, singer: drag.singer, text: "", start, end });
        setDrag({ ...drag, id });
      } else {
        onChange(drag.id, { start, end });
      }
      return;
    }

    const seg = segments.find((x) => x.id === drag.id);
    if (!seg) return;
    const delta = at - drag.anchor;

    if (drag.kind === "move") {
      const width = drag.end - drag.start;
      const start = Math.max(0, Math.min(durationMs - width, drag.start + delta));
      onChange(seg.id, { start, end: start + width });
    } else if (drag.kind === "left") {
      onChange(seg.id, { start: Math.max(0, Math.min(drag.end - MIN_MS, drag.start + delta)) });
    } else if (drag.kind === "right") {
      onChange(seg.id, {
        end: Math.max(drag.start + MIN_MS, Math.min(durationMs, drag.end + delta)),
      });
    }
  };

  const endDrag = () => setDrag(null);

  useEffect(() => {
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const grab = (e, seg, kind) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelect(seg.id);
    setDrag({ kind, id: seg.id, anchor: msAt(e.clientX), start: seg.start, end: seg.end });
  };

  return (
    <section className="tl">
      <div className="tl-head">
        <h2 className="amw-h2">Secondary timeline</h2>
        <span className="tl-hint">Drag inside a lane to lay down a part</span>
        <span className="tl-views">
          {VIEWS.map((v) => (
            <button
              key={v.label}
              className="amw-zoom"
              data-on={viewMs === v.ms}
              onClick={() => setViewMs(v.ms)}
            >
              {v.label}
            </button>
          ))}
          <button className="amw-zoom" data-on={follow} onClick={() => setFollow((f) => !f)}>
            Follow
          </button>
        </span>
      </div>

      <div className="tl-box" ref={boxRef} onPointerMove={onMove}>
        <div className="tl-ruler" onPointerDown={(e) => onSeek(msAt(e.clientX))}>
          {(lineOnsets || []).map((ms, i) => (
            <span key={i} className="tl-tick" style={{ left: place(ms) }} />
          ))}
        </div>

        {cast.map((member) => (
          <div key={member.id} className="tl-lane" style={{ "--agent": member.color }}>
            <span className="tl-label">{member.name}</span>
            <div
              className="tl-track"
              onPointerDown={(e) => onLaneDown(e, member.id)}
              onPointerMove={onMove}
            >
              {segments
                .filter((seg) => seg.singer === member.id)
                .map((seg) => (
                  <span
                    key={seg.id}
                    className="tl-seg"
                    data-on={selectedId === seg.id}
                    style={{ left: place(seg.start), width: `${((seg.end - seg.start) / span) * 100}%` }}
                    onPointerDown={(e) => grab(e, seg, "move")}
                  >
                    <span
                      className="tl-handle tl-handle--l"
                      onPointerDown={(e) => grab(e, seg, "left")}
                    />
                    <span className="tl-text">{seg.text || "ooh"}</span>
                    <span
                      className="tl-handle tl-handle--r"
                      onPointerDown={(e) => grab(e, seg, "right")}
                    />
                  </span>
                ))}
            </div>
          </div>
        ))}

        <span className="tl-head-line" ref={headRef} />
      </div>

      <SelectedBar
        segment={segments.find((s) => s.id === selectedId)}
        onChange={onChange}
        onRemove={onRemove}
        onSeek={onSeek}
      />
    </section>
  );
});

function SelectedBar({ segment, onChange, onRemove, onSeek }) {
  if (!segment) return <p className="tl-none">Nothing selected. Drag in a lane to add a part.</p>;
  return (
    <div className="tl-sel">
      <input
        className="tl-input"
        value={segment.text}
        placeholder="ooh"
        onChange={(e) => onChange(segment.id, { text: e.target.value })}
      />
      <button className="extra-btn" onClick={() => onSeek(segment.start)}>
        {clock(segment.start)}
      </button>
      <span className="extra-dur">{((segment.end - segment.start) / 1000).toFixed(2)}s</span>
      <button className="extra-btn extra-btn--kill" onClick={() => onRemove(segment.id)}>
        Delete
      </button>
    </div>
  );
}

export default Timeline;
