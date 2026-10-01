"use client";

import { useEffect, useRef, useState } from "react";

// A piece running live at a real desktop width, scaled down into whatever box
// it is given. The frame lays out at `width` px and takes the box's aspect, so
// the whole piece is visible — nothing cropped, nothing to click through.
export default function LiveFrame({ src, title, width = 1280, className = "" }) {
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

  const scale = box ? box.w / width : 0;
  const height = box && scale ? box.h / scale : 0;

  return (
    <div ref={boxRef} className={`xl-frame ${className}`}>
      {box ? (
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
