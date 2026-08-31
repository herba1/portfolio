"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import LedgerRow from "./LedgerRow";
import LedgerSkeleton from "./LedgerSkeleton";
import RollingNumber from "./RollingNumber";
import UndoToast from "./UndoToast";
import {
  EDITABLE_FIELDS,
  FLAKY_ROW,
  LEDGER_ROWS,
  cellKey,
  displayValue,
  fieldLabel,
  formatPayout,
  parseField,
  payoutOf,
} from "./ledgerRows";
import "./inline-editable-table.css";

const PENDING_MS = 900;
const UNDO_MS = 6000;
const FLASH_MS = 900;
const LOAD_MS = 620;
const TOAST_EXIT_MS = 200;

const omit = (map, key) => {
  const next = { ...map };
  delete next[key];
  return next;
};

const payoutDirection = (field, prev, next) => (field === "track" ? null : next >= prev ? "up" : "down");

const isTypingTarget = (node) =>
  node instanceof HTMLElement && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);

export default function InlineEditableTableB572Experience() {
  const [rows, setRows] = useState(LEDGER_ROWS);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [pending, setPending] = useState({});
  const [failed, setFailed] = useState({});
  const [flash, setFlash] = useState({});
  const [rowFlash, setRowFlash] = useState({});
  const [payoutMove, setPayoutMove] = useState({});
  const [totalMove, setTotalMove] = useState(null);
  const [undo, setUndo] = useState(null);
  const [undoExiting, setUndoExiting] = useState(false);

  const cells = useRef(new Map());
  const timers = useRef(new Set());
  const retried = useRef(new Set());
  const token = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), LOAD_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const pool = timers.current;
    return () => {
      for (const id of pool) window.clearTimeout(id);
      pool.clear();
    };
  }, []);

  const schedule = useCallback((fn, ms) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);

  const registerCell = useCallback((id, element) => {
    if (element) cells.current.set(id, element);
    else cells.current.delete(id);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.artist} ${row.track} ${row.territory}`.toLowerCase().includes(needle));
  }, [rows, query]);

  const order = useMemo(
    () => visible.flatMap((row) => EDITABLE_FIELDS.map((field) => cellKey(row.id, field))),
    [visible],
  );

  const total = useMemo(() => visible.reduce((sum, row) => sum + payoutOf(row), 0), [visible]);

  const focusCell = useCallback((id) => {
    const element = cells.current.get(id);
    if (element) element.focus();
  }, []);

  const restoreFocus = useCallback(
    (id) => {
      window.requestAnimationFrame(() => focusCell(id));
    },
    [focusCell],
  );

  const navigate = useCallback(
    (id, key) => {
      const index = order.indexOf(id);
      if (index < 0) return;
      const width = EDITABLE_FIELDS.length;
      const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? width : -width;
      const next = order[index + step];
      if (next) focusCell(next);
    },
    [order, focusCell],
  );

  const moveFrom = useCallback(
    (id, move) => {
      if (!move) return;
      const index = order.indexOf(id);
      if (index < 0) return;
      const width = EDITABLE_FIELDS.length;
      const step = move === "right" ? 1 : move === "left" ? -1 : width;
      restoreFocus(order[index + step] ?? order[index]);
    },
    [order, restoreFocus],
  );

  const closeUndo = useCallback(
    (stamp) => {
      setUndoExiting(true);
      schedule(() => {
        setUndo((state) => (state && state.token === stamp ? null : state));
        setUndoExiting((state) => (token.current === stamp ? false : state));
      }, TOAST_EXIT_MS);
    },
    [schedule],
  );

  const land = useCallback(
    (rowId, field, next, prev) => {
      const id = cellKey(rowId, field);
      const willFail = rowId === FLAKY_ROW && !retried.current.has(id);
      setPending((state) => omit(state, id));
      if (willFail) {
        retried.current.add(id);
        setFailed((state) => ({ ...state, [id]: { next, prev } }));
        setRowFlash((state) => ({ ...state, [rowId]: "error" }));
        schedule(() => setRowFlash((state) => omit(state, rowId)), FLASH_MS);
        return;
      }
      setFailed((state) => omit(state, id));
      setRows((state) => state.map((row) => (row.id === rowId ? { ...row, [field]: next } : row)));
      const direction = payoutDirection(field, prev, next);
      setPayoutMove((state) => ({ ...state, [rowId]: direction }));
      setTotalMove(direction);
      setFlash((state) => ({ ...state, [id]: "commit" }));
      setRowFlash((state) => ({ ...state, [rowId]: "commit" }));
      schedule(() => setFlash((state) => omit(state, id)), FLASH_MS);
      schedule(() => setRowFlash((state) => omit(state, rowId)), FLASH_MS);
      schedule(() => setPayoutMove((state) => omit(state, rowId)), FLASH_MS);
      schedule(() => setTotalMove(null), FLASH_MS);
      token.current += 1;
      setUndoExiting(false);
      setUndo({ token: token.current, rowId, field, prev, next });
    },
    [schedule],
  );

  const start = useCallback((id, seed) => setEditing({ id, seed }), []);

  const cancel = useCallback(
    (id, restore) => {
      setEditing(null);
      if (restore) restoreFocus(id);
    },
    [restoreFocus],
  );

  const commit = useCallback(
    (rowId, field, draft, move) => {
      const row = rows.find((item) => item.id === rowId);
      if (!row) return true;
      const next = parseField(field, draft);
      if (next === null) return false;
      setEditing(null);
      moveFrom(cellKey(rowId, field), move);
      if (next === row[field]) return true;
      const id = cellKey(rowId, field);
      const staged = { ...row, [field]: next };
      setPending((state) => ({ ...state, [id]: { next, prev: row[field], display: displayValue(staged, field) } }));
      schedule(() => land(rowId, field, next, row[field]), PENDING_MS);
      return true;
    },
    [rows, moveFrom, schedule, land],
  );

  const retry = useCallback(
    (rowId) => {
      const field = EDITABLE_FIELDS.find((name) => failed[cellKey(rowId, name)]);
      if (!field) return;
      const id = cellKey(rowId, field);
      const entry = failed[id];
      const row = rows.find((item) => item.id === rowId);
      setFailed((state) => omit(state, id));
      setPending((state) => ({ ...state, [id]: { ...entry, display: displayValue({ ...row, [field]: entry.next }, field) } }));
      schedule(() => land(rowId, field, entry.next, entry.prev), PENDING_MS);
    },
    [failed, rows, schedule, land],
  );

  const applyUndo = useCallback(() => {
    if (!undo || undoExiting) return;
    setRows((state) => state.map((row) => (row.id === undo.rowId ? { ...row, [undo.field]: undo.prev } : row)));
    const direction = payoutDirection(undo.field, undo.next, undo.prev);
    setPayoutMove((state) => ({ ...state, [undo.rowId]: direction }));
    setTotalMove(direction);
    setRowFlash((state) => ({ ...state, [undo.rowId]: "undo" }));
    schedule(() => setRowFlash((state) => omit(state, undo.rowId)), FLASH_MS);
    schedule(() => setPayoutMove((state) => omit(state, undo.rowId)), FLASH_MS);
    schedule(() => setTotalMove(null), FLASH_MS);
    closeUndo(undo.token);
  }, [undo, undoExiting, schedule, closeUndo]);

  const expireUndo = useCallback(() => {
    if (undo) closeUndo(undo.token);
  }, [undo, closeUndo]);

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      applyUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyUndo]);

  const undoLabel = undo ? `${rows.find((row) => row.id === undo.rowId)?.artist} ${fieldLabel[undo.field]} saved` : "";

  return (
    <main className="iet-page bg-surface text-ink">
      <div className="iet-shell">
        <h1 className="iet-title text-title-sm text-ink">Royalty ledger, editable in place</h1>

        <div className="iet-panel">
          <div className="iet-toolbar">
            <label className="iet-search" htmlFor="iet-filter">
              <Search size={14} strokeWidth={2} aria-hidden="true" />
              <input
                id="iet-filter"
                className="iet-search-input text-ui-lg"
                value={query}
                placeholder="Filter by artist, track or territory"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="iet-period text-ui text-ink-secondary">Statement Q3 2026</div>
          </div>

          <div className="iet-scroll">
            <div className="iet-grid" aria-busy={!ready}>
              <div className="iet-head">
                <div className="iet-head-cell text-ui text-ink-secondary">Artist</div>
                <div className="iet-head-cell text-ui text-ink-secondary">Track</div>
                <div className="iet-head-cell text-ui text-ink-secondary">Territory</div>
                <div className="iet-head-cell iet-end text-ui text-ink-secondary">Streams</div>
                <div className="iet-head-cell iet-end text-ui text-ink-secondary">Rate</div>
                <div className="iet-head-cell iet-end text-ui text-ink-secondary">Payout</div>
                <div className="iet-head-cell text-ui text-ink-secondary">Status</div>
              </div>

              {!ready ? <LedgerSkeleton count={LEDGER_ROWS.length} /> : null}

              {ready && visible.length
                ? visible.map((row, index) => (
                    <LedgerRow
                      key={row.id}
                      row={row}
                      index={index}
                      editing={editing}
                      pending={pending}
                      failed={failed}
                      flash={flash}
                      rowFlash={rowFlash[row.id]}
                      payoutMove={payoutMove[row.id]}
                      registerCell={registerCell}
                      onStart={start}
                      onCommit={commit}
                      onCancel={cancel}
                      onNavigate={navigate}
                      onRetry={retry}
                    />
                  ))
                : null}

              {ready && !visible.length ? (
                <div className="iet-empty">
                  <p className="iet-empty-line text-heading text-ink">Nothing matches “{query}”</p>
                  <button type="button" className="iet-empty-action text-ui-lg" onClick={() => setQuery("")}>
                    Clear the filter
                  </button>
                </div>
              ) : null}

              <div className="iet-foot">
                <div className="iet-foot-label text-ui-lg text-ink">
                  {visible.length} of {rows.length} tracks
                </div>
                <div className="iet-foot-total text-heading text-ink">
                  <RollingNumber value={formatPayout(total)} size="lg" tone={totalMove} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="iet-toast-slot">
          {undo ? (
            <UndoToast
              key={undo.token}
              entry={{ ...undo, label: undoLabel }}
              duration={UNDO_MS}
              exiting={undoExiting}
              onUndo={applyUndo}
              onExpire={expireUndo}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
