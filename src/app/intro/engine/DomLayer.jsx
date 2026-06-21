"use client";

import { useRef } from "react";
import { useFieldLoop } from "./useFieldLoop";

// DOM renderer for a gravity field. Renders one element per particle and blits
// the field's transforms into them each frame. Renderer-agnostic about content:
// pass `renderItem(p)` to draw emojis, <img>s, cards — any DOM.
//
//   <DomLayer field={field} renderItem={(p) => p.data.emoji} />
//
// The element is sized to `p.size` (px); content is centered. transform-origin
// is centre so the field's scale stays anchored at the particle position.
export default function DomLayer({ field, renderItem, className = "" }) {
  const nodes = useRef([]);

  const place = (particles) => {
    for (const p of particles) {
      const n = nodes.current[p.id];
      if (!n) continue;
      n.style.opacity = p.alive ? "1" : "0";
      n.style.transform =
        `translate3d(${(p.x - p.size / 2).toFixed(2)}px,${(p.y - p.size / 2).toFixed(2)}px,0)` +
        ` rotate(${p.rot.toFixed(4)}rad) scale(${p.scale.toFixed(3)})`;
    }
  };

  // Re-bind when the particle set is rebuilt (count / appearance change).
  useFieldLoop(field, place, [field, field.particles.length]);

  return (
    <>
      {field.particles.map((p) => (
        <div
          key={p.id}
          ref={(n) => (nodes.current[p.id] = n)}
          className={`gf-item ${className}`}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: p.size,
            height: p.size,
            fontSize: p.size,
            lineHeight: 1,
            opacity: 0,
            willChange: "transform",
            transformOrigin: "center",
            userSelect: "none",
            display: "grid",
            placeItems: "center",
            zIndex: 10 + Math.round(p.depth * 40),
          }}
        >
          {renderItem ? renderItem(p) : null}
        </div>
      ))}
    </>
  );
}
