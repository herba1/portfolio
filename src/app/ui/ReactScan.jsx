"use client";

import { useEffect } from "react";

export default function ReactScan() {
  useEffect(() => {
    // Opt-in: its full-screen overlay redraws on every render, which on the
    // experiments index at 4K is enough to freeze the tab.
    if (process.env.NODE_ENV !== "development") return;
    if (process.env.NEXT_PUBLIC_REACT_SCAN !== "1") return;

    let cancelled = false;

    import("react-scan").then(({ scan }) => {
      if (cancelled) return;
      scan({
        enabled: true,
        log: false,
        showToolbar: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
