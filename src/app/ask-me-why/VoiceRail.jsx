"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

const initials = (name) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const VoiceRail = forwardRef(function VoiceRail({ cast, activeSingers }, ref) {
  const [broken, setBroken] = useState({});
  const slotRefs = useRef([]);
  const countRef = useRef(0);

  const singing = new Set(activeSingers || []);
  countRef.current = cast?.length || 0;

  const draw = useCallback((bins) => {
    const slots = slotRefs.current;
    const count = countRef.current;
    if (!count) return;

    const usable = bins ? Math.floor(bins.length * 0.55) : 0;
    const perSlot = usable ? Math.max(3, Math.floor(usable / count)) : 0;

    let shared = 0;
    if (usable) {
      let sum = 0;
      for (let i = 0; i < usable; i++) sum += bins[i];
      shared = sum / usable / 255;
    }

    for (let s = 0; s < count; s++) {
      const node = slots[s];
      if (!node) continue;

      let band = 0;
      if (perSlot) {
        let sum = 0;
        const from = s * perSlot;
        for (let i = from; i < from + perSlot; i++) sum += bins[i] || 0;
        band = sum / perSlot / 255;
      }

      const level = shared * 0.82 + band * 0.18;
      const shaped = Math.round(Math.min(1, level * 1.5) ** 1.5 * 24) / 24;
      if (node.__v !== shaped) {
        node.__v = shaped;
        node.style.setProperty("--vol", shaped);
      }
    }
  }, []);

  useImperativeHandle(ref, () => ({ draw }), [draw]);

  if (!cast?.length) return null;

  return (
    <div className="rail" data-count={cast.length} aria-hidden="true">
      {cast.map((member, i) => (
        <div
          key={member.id}
          ref={(el) => (slotRefs.current[i] = el)}
          className="rail-slot"
          data-on={singing.has(member.id)}
          data-quiet={singing.size > 0 && !singing.has(member.id)}
          style={{ "--agent": member.color, "--i": i }}
        >
          <span className="rail-drift">
            <span className="rail-photo">
              <span className="rail-initials">{initials(member.name)}</span>
              {broken[member.id] ? null : (
                <img
                  className="rail-img"
                  src={`/cast/${member.id}.webp`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setBroken((b) => ({ ...b, [member.id]: true }))}
                />
              )}
            </span>
          </span>
          <span className="rail-name">{member.name}</span>
        </div>
      ))}
    </div>
  );
});

export default VoiceRail;
