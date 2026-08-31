"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

function CellEditor({ initial, align, onCommit, onCancel }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(initial);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const attempt = (move) => {
    const accepted = onCommit(draft, move);
    if (accepted) return true;
    setRejected(true);
    window.setTimeout(() => setRejected(false), 220);
    return false;
  };

  return (
    <input
      ref={inputRef}
      className="iet-editor"
      data-align={align}
      data-rejected={rejected ? "true" : undefined}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!attempt(null)) onCancel(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          attempt("down");
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel(true);
        } else if (event.key === "Tab") {
          event.preventDefault();
          attempt(event.shiftKey ? "left" : "right");
        }
      }}
    />
  );
}

export default function LedgerCell({
  cellId,
  align,
  display,
  raw,
  editing,
  pendingValue,
  failed,
  flash,
  locked,
  registerCell,
  onStart,
  onCommit,
  onCancel,
  onNavigate,
}) {
  const [refused, setRefused] = useState(false);

  const refuse = () => {
    setRefused(true);
    window.setTimeout(() => setRefused(false), 220);
  };

  if (editing) {
    return (
      <div className="iet-cell" data-align={align} data-editing="true">
        <CellEditor initial={raw} align={align} onCommit={onCommit} onCancel={onCancel} />
      </div>
    );
  }

  const shown = pendingValue ?? display;

  return (
    <div className="iet-cell" data-align={align} data-flash={flash} data-pending={pendingValue ? "true" : undefined} data-failed={failed ? "true" : undefined}>
      <button
        type="button"
        ref={(element) => registerCell(cellId, element)}
        className="iet-cell-button"
        data-align={align}
        data-locked={locked ? "true" : undefined}
        data-refused={refused ? "true" : undefined}
        aria-disabled={locked || undefined}
        onClick={() => (locked ? refuse() : onStart())}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onNavigate(event.key);
            return;
          }
          if (event.key === "Enter" || event.key === " ") return;
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            if (locked) refuse();
            else onStart(event.key);
          }
        }}
      >
        <span className="iet-cell-value">{shown}</span>
        {!locked ? <Pencil className="iet-cell-glyph" size={12} strokeWidth={2} aria-hidden="true" /> : null}
      </button>
      <span className="iet-cell-progress" aria-hidden="true" />
    </div>
  );
}
