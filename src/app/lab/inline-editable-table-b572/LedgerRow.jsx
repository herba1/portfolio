"use client";

import { Lock, RotateCcw } from "lucide-react";
import LedgerCell from "./LedgerCell";
import RollingNumber from "./RollingNumber";
import { EDITABLE_FIELDS, cellKey, displayValue, formatPayout, payoutOf, rawValue } from "./ledgerRows";

const ALIGN = { track: "start", streams: "end", rate: "end" };

const STATUS_STATES = ["ready", "pending", "committed", "failed", "settled"];

function StatusBody({ name, active, onRetry }) {
  if (name === "pending") {
    return (
      <>
        <span className="iet-status-pulse" aria-hidden="true" />
        Saving
      </>
    );
  }
  if (name === "failed") {
    return (
      <button type="button" className="iet-retry" onClick={onRetry} tabIndex={active ? 0 : -1}>
        <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
        Retry
      </button>
    );
  }
  if (name === "committed") {
    return (
      <>
        <svg className="iet-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 8.4 6.4 12 13 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Saved
      </>
    );
  }
  if (name === "settled") {
    return (
      <>
        <Lock size={12} strokeWidth={2} aria-hidden="true" />
        Paid
      </>
    );
  }
  return <>Ready</>;
}

function StatusCell({ state, onRetry }) {
  return (
    <span className="iet-status-stack">
      {STATUS_STATES.map((name) => (
        <span
          key={name}
          className="iet-status"
          data-state={name}
          data-on={state === name ? "true" : undefined}
          aria-hidden={state === name ? undefined : "true"}
        >
          <StatusBody name={name} active={state === name} onRetry={onRetry} />
        </span>
      ))}
    </span>
  );
}

function rowStatus(row, pending, failed, flash) {
  if (EDITABLE_FIELDS.some((field) => pending[cellKey(row.id, field)])) return "pending";
  if (EDITABLE_FIELDS.some((field) => failed[cellKey(row.id, field)])) return "failed";
  if (EDITABLE_FIELDS.some((field) => flash[cellKey(row.id, field)] === "commit")) return "committed";
  if (row.settled) return "settled";
  return "ready";
}

export default function LedgerRow({
  row,
  index,
  editing,
  pending,
  failed,
  flash,
  rowFlash,
  payoutMove,
  registerCell,
  onStart,
  onCommit,
  onCancel,
  onNavigate,
  onRetry,
}) {
  const cellFor = (field) => {
    const id = cellKey(row.id, field);
    const pendingEntry = pending[id];
    const isEditing = editing?.id === id;
    return (
      <LedgerCell
        key={id}
        cellId={id}
        align={ALIGN[field]}
        display={displayValue(row, field)}
        raw={isEditing ? (editing.seed ?? rawValue(row, field)) : rawValue(row, field)}
        editing={isEditing}
        pendingValue={pendingEntry ? pendingEntry.display : null}
        failed={Boolean(failed[id])}
        flash={flash[id]}
        locked={row.settled}
        registerCell={registerCell}
        onStart={(seed) => onStart(id, seed)}
        onCommit={(draft, move) => onCommit(row.id, field, draft, move)}
        onCancel={(restore) => onCancel(id, restore)}
        onNavigate={(key) => onNavigate(id, key)}
      />
    );
  };

  return (
    <div className="iet-row" data-flash={rowFlash} data-locked={row.settled ? "true" : undefined} style={{ "--iet-row-i": index }}>
      <div className="iet-static text-ui-lg text-ink">{row.artist}</div>
      {cellFor("track")}
      <div className="iet-static iet-territory text-ui text-ink-secondary">{row.territory}</div>
      {cellFor("streams")}
      {cellFor("rate")}
      <div className="iet-static iet-payout text-ui-lg text-ink">
        <RollingNumber value={formatPayout(payoutOf(row))} size="lg" tone={payoutMove} />
      </div>
      <div className="iet-static iet-status-cell">
        <StatusCell state={rowStatus(row, pending, failed, flash)} onRetry={() => onRetry(row.id)} />
      </div>
    </div>
  );
}
