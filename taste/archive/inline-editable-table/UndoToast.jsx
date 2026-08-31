"use client";

export default function UndoToast({ undo, secondsLeft, totalSeconds, onUndo }) {
  if (!undo) return null;

  return (
    <div className="iet__toast" role="status" aria-live="polite">
      <div className="iet__toast-inner">
        <div
          className="iet__toast-bar"
          style={{ "--iet-toast-progress": secondsLeft / totalSeconds }}
        />
        <div className="iet__toast-row">
          <p className="iet__toast-text text-ui-lg">
            {undo.label} for {undo.rowName} set to {undo.displayValue}
          </p>
          <button type="button" className="iet__toast-undo text-ui-lg" onClick={onUndo}>
            Undo
          </button>
          <span className="iet__toast-count text-ui tabular-nums">{secondsLeft}</span>
        </div>
      </div>
    </div>
  );
}
