"use client";

import { useEffect } from "react";

export default function ReactScan() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    let cancelled = false;

    import("react-scan").then(({ scan }) => {
      if (cancelled) return;
      scan({
        enabled: true,
        log: false,
        showToolbar: true,
        trackUnnecessaryRenders: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
