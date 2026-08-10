"use client";

import { useEffect, useRef, useState } from "react";

const CAST_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#a05ac8",
  "#c2761a",
  "#0f766e",
  "#be185d",
  "#4338ca",
];

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

export default function CastBar({
  cast,
  activeId,
  onSelect,
  onAdd,
  onRemove,
  mode,
  onMode,
  onSave,
  onRevert,
  onRestoreSource,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  dirty,
  savedAt,
  pendingRemove,
  stats,
  playing,
  clockMs,
  durationMs,
  onToggle,
  onView,
}) {
  const [name, setName] = useState("");
  const [stuck, setStuck] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setStuck(entry.intersectionRatio < 1), {
      rootMargin: "-78px 0px 0px 0px",
      threshold: [1],
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const clock = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = slug(trimmed);
    if (!id || cast.some((m) => m.id === id)) return;
    onAdd({ id, name: trimmed, color: CAST_COLORS[cast.length % CAST_COLORS.length] });
    setName("");
  };

  return (
    <section className="cast" ref={barRef} data-stuck={stuck}>
      <div className="cast-row">
        <span className="cast-transport">
          <button className="cast-play" onClick={onToggle}>
            {playing ? "Pause" : "Play"}
          </button>
          <span className="cast-clock">
            {clock(clockMs)} / {clock(durationMs)}
          </span>
        </span>
        <h2 className="amw-h2">Cast</h2>

        <div className="cast-chips">
          {cast.map((member, i) => (
            <span key={member.id} className="cast-chip" style={{ "--agent": member.color }}>
              <button
                className="cast-pick"
                data-on={activeId === member.id}
                onClick={() => onSelect(member.id)}
              >
                <span className="cast-swatch" />
                {member.name}
                <span className="cast-key">{i + 1}</span>
              </button>
              <button
                className="cast-x"
                data-arm={pendingRemove === member.id}
                onClick={() => onRemove(member.id)}
                onBlur={() => pendingRemove === member.id && onRemove(null)}
              >
                {pendingRemove === member.id ? "Remove?" : "×"}
              </button>
            </span>
          ))}

          <span className="cast-add">
            <input
              className="cast-input"
              value={name}
              placeholder="Add a name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button className="cast-addbtn" onClick={add}>
              Add
            </button>
          </span>
        </div>
      </div>

      <div className="cast-row cast-row--modes">
        <span className="cast-seg">
          <button
            className="cast-segbtn"
            data-on={mode === "browse"}
            onClick={() => onMode("browse")}
          >
            Navigate
            <span className="cast-key">n</span>
          </button>
          <button className="cast-segbtn" data-on={mode === "line"} onClick={() => onMode("line")}>
            Whole line
            <span className="cast-key">l</span>
          </button>
          <button className="cast-segbtn" data-on={mode === "word"} onClick={() => onMode("word")}>
            Word by word
            <span className="cast-key">w</span>
          </button>
        </span>

        <p className="cast-guide">
          {mode === "browse" ? (
            <>
              <strong>Navigating.</strong> Click a line or a single word to jump there. Nothing gets
              edited. Pick someone from the cast to start assigning again.
            </>
          ) : activeId ? (
            <>
              <strong>{cast.find((m) => m.id === activeId)?.name}</strong> is selected.{" "}
              {mode === "line"
                ? "Click any line to add or remove them from it. Click their chip again to go back to navigating."
                : "Click a word to add or remove them. Drag across words to paint a run. Alt-click a word to make it follow the line again."}
            </>
          ) : (
            <>Add someone to the cast to start assigning.</>
          )}
        </p>
      </div>

      <div className="cast-row cast-row--tools">
        <span className="cast-history">
          <button className="cast-hbtn" onClick={onUndo} disabled={!canUndo} title="Undo">
            Undo
            <span className="cast-key">⌘Z</span>
          </button>
          <button className="cast-hbtn" onClick={onRedo} disabled={!canRedo} title="Redo">
            Redo
          </button>
        </span>

        <span className="cast-stats">
          {stats.attributed} lines · {stats.detailed} detailed · {stats.extras} secondary
        </span>

        <span className="cast-flex" />

        <button className="cast-hbtn" onClick={onView}>
          View mode
          <span className="cast-key">v</span>
        </button>

        <button className="cast-hbtn" onClick={onRestoreSource} title="Discard local edits">
          Reload from file
        </button>

        <span className="cast-state" data-dirty={dirty}>
          <span className="cast-tick" />
          {dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : "No changes"}
        </span>

        <button className="cast-save" onClick={onSave} data-dirty={dirty} disabled={!dirty}>
          Save
          <span className="cast-key">⌘S</span>
        </button>
      </div>
    </section>
  );
}
