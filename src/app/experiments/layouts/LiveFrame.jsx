"use client";

import { useEffect, useRef, useState } from "react";

// A piece running live inside a box. The piece lays out at the box's own size
// whenever the box is at least `base` wide, so its main interaction shows at
// true scale; a narrower box renders at `base` and scales down to fit. Either
// way the frame takes the box's aspect — nothing cropped, nothing to open.
export default function LiveFrame({ src, title, base = 480, className = "" }) {
  const boxRef = useRef(null);
  const [box, setBox] = useState(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setBox({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = box ? Math.max(box.w, base) : 0;
  const scale = box ? box.w / width : 0;
  const height = scale ? box.h / scale : 0;

  return (
    <div ref={boxRef} className={`xl-frame ${className}`}>
      {box && box.w > 0 ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="microphone; autoplay; clipboard-write"
          style={{ width, height, transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  );
}
