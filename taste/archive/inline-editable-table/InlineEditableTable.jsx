"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TableCell from "./TableCell";
import UndoToast from "./UndoToast";

const PENDING_MS = 650;
const FLASH_MS = 450;
const UNDO_SECONDS = 5;

function cellKey(row, col) {
  return `${row}:${col}`;
}

export default function InlineEditableTable({ columns, initialRows, label }) {
  const [rows, setRows] = useState(initialRows);
  const [active, setActive] = useState({ row: 0, col: 0 });
  const [editing, setEditing] = useState(null);
  const [pendingKeys, setPendingKeys] = useState(() => new Set());
  const [flashKeys, setFlashKeys] = useState(() => new Set());
  const [undo, setUndo] = useState(null);
  const [liveMessage, setLiveMessage] = useState("");

  const cellRefs = useRef(new Map());
  const pendingTimeouts = useRef(new Map());
  const flashTimeouts = useRef(new Map());
  const skipNextBlurRef = useRef(false);
  const undoIdRef = useRef(0);

  const registerCell = useCallback((row, col, el) => {
    const key = cellKey(row, col);
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }, []);

  const moveActive = useCallback(
    (dRow, dCol, { wrap = false } = {}) => {
      setActive((current) => {
        let row = current.row + dRow;
        let col = current.col + dCol;
        if (wrap) {
          if (col >= columns.length) {
            col = 0;
            row += 1;
          } else if (col < 0) {
            col = columns.length - 1;
            row -= 1;
          }
        }
        row = Math.min(Math.max(row, 0), rows.length - 1);
        col = Math.min(Math.max(col, 0), columns.length - 1);
        return { row, col };
      });
    },
    [columns.length, rows.length],
  );

  const finalizeEdit = useCallback((row, col, column, previousValue, newValue) => {
    const key = cellKey(row, col);
    pendingTimeouts.current.delete(key);
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setFlashKeys((prev) => new Set(prev).add(key));
    const flashTimeout = setTimeout(() => {
      flashTimeouts.current.delete(key);
      setFlashKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, FLASH_MS);
    flashTimeouts.current.set(key, flashTimeout);

    const displayValue = column.format ? column.format(newValue) : String(newValue);
    setLiveMessage(`${column.label} for ${rows[row]?.name ?? "row"} set to ${displayValue}`);

    undoIdRef.current += 1;
    setUndo({
      id: undoIdRef.current,
      row,
      col,
      key: column.key,
      label: column.label,
      rowName: rows[row]?.name ?? "",
      displayValue,
      previousValue,
      secondsLeft: UNDO_SECONDS,
    });
  }, [rows]);

  const commitEdit = useCallback(
    (row, col, rawValue) => {
      const column = columns[col];
      const previousValue = rows[row][column.key];
      const parsed = column.parse ? column.parse(rawValue) : rawValue;
      setEditing(null);
      if (parsed === null || parsed === previousValue) return;

      setRows((current) => current.map((r, i) => (i === row ? { ...r, [column.key]: parsed } : r)));

      const key = cellKey(row, col);
      const existing = pendingTimeouts.current.get(key);
      if (existing) clearTimeout(existing);
      setPendingKeys((prev) => new Set(prev).add(key));
      const timeout = setTimeout(() => finalizeEdit(row, col, column, previousValue, parsed), PENDING_MS);
      pendingTimeouts.current.set(key, timeout);
    },
    [columns, rows, finalizeEdit],
  );

  const startEdit = useCallback(
    (row, col) => {
      if (pendingKeys.has(cellKey(row, col))) return;
      setActive({ row, col });
      setEditing({ row, col });
    },
    [pendingKeys],
  );

  const cancelEdit = useCallback(() => {
    skipNextBlurRef.current = true;
    setEditing(null);
  }, []);

  const handleUndo = useCallback(() => {
    if (!undo) return;
    const timeout = pendingTimeouts.current.get(cellKey(undo.row, undo.col));
    if (timeout) {
      clearTimeout(timeout);
      pendingTimeouts.current.delete(cellKey(undo.row, undo.col));
    }
    setRows((current) => current.map((r, i) => (i === undo.row ? { ...r, [undo.key]: undo.previousValue } : r)));
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(cellKey(undo.row, undo.col));
      return next;
    });
    setLiveMessage(`${undo.label} for ${undo.rowName} reverted`);
    setUndo(null);
  }, [undo]);

  const handleGridKeyDown = useCallback(
    (event) => {
      const { key } = event;
      if (editing) {
        if (key === "Enter") {
          event.preventDefault();
          skipNextBlurRef.current = true;
          commitEdit(editing.row, editing.col, event.target.value);
          moveActive(1, 0);
        } else if (key === "Escape") {
          event.preventDefault();
          cancelEdit();
        } else if (key === "Tab") {
          event.preventDefault();
          skipNextBlurRef.current = true;
          commitEdit(editing.row, editing.col, event.target.value);
          moveActive(0, event.shiftKey ? -1 : 1, { wrap: true });
        }
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        moveActive(-1, 0);
      } else if (key === "ArrowDown") {
        event.preventDefault();
        moveActive(1, 0);
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        moveActive(0, -1);
      } else if (key === "ArrowRight") {
        event.preventDefault();
        moveActive(0, 1);
      } else if (key === "Tab") {
        event.preventDefault();
        moveActive(0, event.shiftKey ? -1 : 1, { wrap: true });
      } else if (key === "Enter" || key === "F2") {
        event.preventDefault();
        startEdit(active.row, active.col);
      }
    },
    [editing, active, commitEdit, cancelEdit, moveActive, startEdit],
  );

  useEffect(() => {
    if (editing) return;
    const el = cellRefs.current.get(cellKey(active.row, active.col));
    el?.focus();
  }, [editing, active]);

  useEffect(() => {
    if (!undo) return undefined;
    const interval = setInterval(() => {
      setUndo((current) => {
        if (!current) return current;
        if (current.secondsLeft <= 1) {
          clearInterval(interval);
          return null;
        }
        return { ...current, secondsLeft: current.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [undo?.id]);

  useEffect(() => {
    const pending = pendingTimeouts.current;
    const flashes = flashTimeouts.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      flashes.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <div className="iet__wrap">
      <div
        className="iet__grid"
        role="grid"
        aria-label={label}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length}
        onKeyDown={handleGridKeyDown}
      >
        <div className="iet__row" role="row">
          {columns.map((column) => (
            <div
              key={column.key}
              className="iet__headcell text-ui-lg"
              role="columnheader"
              data-align={column.align}
            >
              {column.label}
            </div>
          ))}
        </div>

        {rows.map((row, rowIndex) => (
          <div key={row.id} className="iet__row" role="row">
            {columns.map((column, colIndex) => {
              const key = cellKey(rowIndex, colIndex);
              return (
                <TableCell
                  key={column.key}
                  row={rowIndex}
                  col={colIndex}
                  column={column}
                  value={row[column.key]}
                  isActive={active.row === rowIndex && active.col === colIndex}
                  isEditing={editing?.row === rowIndex && editing?.col === colIndex}
                  isPending={pendingKeys.has(key)}
                  isFlashing={flashKeys.has(key)}
                  registerCell={registerCell}
                  onActivate={() => setActive({ row: rowIndex, col: colIndex })}
                  onStartEdit={() => startEdit(rowIndex, colIndex)}
                  onCommit={(raw) => commitEdit(rowIndex, colIndex, raw)}
                  onBlurCommit={(raw) => {
                    if (skipNextBlurRef.current) {
                      skipNextBlurRef.current = false;
                      return;
                    }
                    commitEdit(rowIndex, colIndex, raw);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </div>

      <UndoToast undo={undo} secondsLeft={undo?.secondsLeft ?? 0} totalSeconds={UNDO_SECONDS} onUndo={handleUndo} />
    </div>
  );
}
