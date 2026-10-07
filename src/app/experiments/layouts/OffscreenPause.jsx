"use client";

import { useEffect } from "react";

export default function OffscreenPause() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) delete entry.target.dataset.offscreen;
          else entry.target.dataset.offscreen = "";
        }
      },
      { rootMargin: "64px 0px" },
    );
    document.querySelectorAll(".xl-bento .xl-tile").forEach((tile) => observer.observe(tile));
    return () => observer.disconnect();
  }, []);
  return null;
}
