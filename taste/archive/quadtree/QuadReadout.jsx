"use client";

import { useImperativeHandle, useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";

const GROUPED = new Intl.NumberFormat("en-US");

const INITIAL = { tiles: 0, carved: 0, tilesDirection: "up", carvedDirection: "up" };

export default function QuadReadout({ ref, onRelease }) {
  const [view, setView] = useState(INITIAL);

  useImperativeHandle(
    ref,
    () => ({
      update(tiles, carved) {
        setView((prev) => {
          if (prev.tiles === tiles && prev.carved === carved) return prev;
          return {
            tiles,
            carved,
            tilesDirection: tiles === prev.tiles ? prev.tilesDirection : tiles > prev.tiles ? "up" : "down",
            carvedDirection: carved === prev.carved ? prev.carvedDirection : carved > prev.carved ? "up" : "down",
          };
        });
      },
    }),
    [],
  );

  const showCarved = view.carved > 0;
  const showTiles = view.tiles > 0;

  return (
    <div className="qt-readout text-ui">
      <span
        className="qt-readout__item qt-tiles text-ink"
        data-shown={showTiles ? "" : undefined}
        aria-hidden={showTiles ? undefined : "true"}
      >
        {showTiles ? (
          <SlotNumber value={GROUPED.format(view.tiles)} direction={view.tilesDirection} duration={480} stagger={24} />
        ) : null}
        <span>{view.tiles === 1 ? "tile" : "tiles"}</span>
      </span>
      <span className="qt-carved" data-shown={showCarved ? "" : undefined} aria-hidden={showCarved ? undefined : "true"}>
        <span className="qt-readout__item text-ink">
          <SlotNumber value={GROUPED.format(view.carved)} direction={view.carvedDirection} duration={480} stagger={24} />
          <span>carved</span>
        </span>
        <button type="button" className="qt-release text-ui" tabIndex={showCarved ? 0 : -1} onClick={onRelease}>
          Release
        </button>
      </span>
    </div>
  );
}
