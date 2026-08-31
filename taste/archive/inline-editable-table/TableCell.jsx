"use client";

import { useEffect, useRef } from "react";

const STATUS_DATA = {
  Confirmed: "positive",
  Tentative: "warning",
  Hold: "neutral",
};

function StatusValue({ value }) {
  return (
    <span className="iet__status">
      <span className="iet__status-dot" data-tone={STATUS_DATA[value] ?? "neutral"} />
      {value}
    </span>
  );
}

function CellDisplay({ column, value }) {
  const text = column.format ? column.format(value) : value;
  if (column.key === "status") return <StatusValue value={value} />;
  return <span className="iet__value">{text}</span>;
}

export default function TableCell({
  row,
  col,
  column,
  value,
  isActive,
  isEditing,
  isPending,
  isFlashing,
  registerCell,
  onActivate,
  onStartEdit,
  onCommit,
  onBlurCommit,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, [isEditing]);

  const handleClick = () => {
    if (isEditing || isPending) return;
    if (isActive) onStartEdit();
    else onActivate();
  };

  return (
    <div
      ref={(el) => registerCell(row, col, el)}
      className="iet__cell text-body"
      role="gridcell"
      tabIndex={isActive ? 0 : -1}
      data-pending={isPending || undefined}
      data-flashing={isFlashing || undefined}
      data-editing={isEditing || undefined}
      data-align={column.align}
      onFocus={onActivate}
      onClick={handleClick}
    >
      {isEditing ? (
        column.type === "select" ? (
          <select
            ref={inputRef}
            className="iet__select text-body"
            defaultValue={value}
            onChange={(event) => onCommit(event.target.value)}
            onBlur={(event) => onBlurCommit(event.target.value)}
          >
            {column.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef}
            className="iet__input text-body"
            type={column.type === "number" ? "number" : "text"}
            defaultValue={value}
            onBlur={(event) => onBlurCommit(event.target.value)}
          />
        )
      ) : (
        <CellDisplay column={column} value={value} />
      )}
    </div>
  );
}
