"use client";

import { memo, useCallback } from "react";

import SlotNumber from "@/app/ui/SlotNumber";

function ThreadRow({ track, slot, index, total, tabbable, register, onFocusRow }) {
  const { id, image } = track;
  const attach = useCallback(
    (node) => {
      if (!node) return undefined;
      return register(id, node, image);
    },
    [register, id, image],
  );

  return (
    <li
      ref={attach}
      data-thread-row={id}
      className="thread-row"
      tabIndex={tabbable ? 0 : -1}
      aria-posinset={index + 1}
      aria-setsize={total}
      aria-label={`${track.title} by ${track.artist}, ${track.duration}`}
      onFocus={() => onFocusRow(id)}
      style={{ "--row-i": slot }}
    >
      <div className="thread-reveal" data-part="reveal" aria-hidden="true">
        <span className="thread-reveal__label text-ui-sm" data-part="label">
          Remove
        </span>
      </div>
      <div className="thread-row__body" data-part="body">
        <span className="thread-bead" data-part="bead" data-image={image ? "true" : undefined} style={{ "--bead-fill": track.fill }} aria-hidden="true">
          <span className="thread-bead__mono text-ui-sm">{track.monogram}</span>
          {image ? <span className="thread-bead__image" style={{ backgroundImage: `url(${JSON.stringify(image)})` }} /> : null}
        </span>
        <div className="thread-row__main" data-part="main" aria-hidden="true">
          <div className="thread-row__text">
            <span className="thread-row__title text-heading-sm">{track.title}</span>
            <span className="thread-row__meta text-ui">
              {track.artist} · {track.duration}
            </span>
          </div>
          <SlotNumber className="thread-row__index text-ui" value={index + 1} pad={2} />
          <span className="thread-handle" data-thread-handle="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </li>
  );
}

export default memo(ThreadRow);
