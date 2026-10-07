"use client";

import SlotNumber from "@/app/ui/SlotNumber";

const FAN_SIZE = 5;

export default function CopierTray({ copies, fanned, pileRef, onFan, onPick, onSave, canSave, busy }) {
  const count = copies.reduce((total, copy) => total + (copy.arrived ? 1 : 0), 0);
  const visible = copies.slice(-FAN_SIZE - 1).reverse();

  return (
    <aside className="copier__tray" aria-label="Copies">
      <p className="copier-tray__count text-ui-lg">
        <span className="text-ink-secondary">Copies</span>
        <SlotNumber className="copier-tray__number font-strong" value={count} />
      </p>
      <div
        ref={pileRef}
        className="copier-pile"
        data-fanned={fanned ? "true" : "false"}
        data-empty={count === 0 ? "true" : "false"}
      >
        {visible.map((copy, depth) => {
          const fanIndex = Math.min(depth, FAN_SIZE - 1);
          const pickable = fanned && depth < FAN_SIZE && copy.sheet && copy.arrived;
          return (
            <button
              key={copy.id}
              type="button"
              className="copier-copy"
              data-arrived={copy.arrived ? "true" : "false"}
              data-fed={copy.fed ? "true" : undefined}
              data-depth={depth}
              tabIndex={copy.arrived && (depth === 0 || fanned) ? 0 : -1}
              aria-label={fanned ? `Put generation ${copy.gen} back on the glass` : `Fan out ${count} copies`}
              disabled={busy && fanned}
              style={{
                "--i": fanIndex,
                "--z": 20 - depth,
                "--jx": `${copy.jitterX}px`,
                "--jy": `${copy.jitterY}px`,
                "--jr": `${copy.jitterTurn}deg`,
              }}
              onClick={(event) => {
                if (pickable) onPick(copy, event.currentTarget);
                else onFan();
              }}
            >
              <span className="copier-copy__paper" style={copy.thumb ? { backgroundImage: `url(${copy.thumb})` } : undefined} />
              <span className="copier-copy__gen text-ui-xs">
                <span className="copier-copy__gen-number">{copy.gen}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="copier-link copier-tray__save text-ui" onClick={onSave} disabled={!canSave}>
        Save latest as PNG
      </button>
    </aside>
  );
}
