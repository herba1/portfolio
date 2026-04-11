"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function DebugTransitions() {
  const pathname = usePathname();

  useEffect(() => {
    console.log("[DebugTransitions] pathname changed to:", pathname, Date.now());
  }, [pathname]);

  useEffect(() => {
    // Listen for native View Transition API events
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "event" || entry.name?.includes("transition")) {
          console.log("[DebugTransitions] perf entry:", entry.name, entry);
        }
      }
    });

    // Log when view transitions start via the document API
    if (document.startViewTransition) {
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        console.log("[DebugTransitions] startViewTransition called!", Date.now());
        console.trace();
        return original(...args);
      };
      console.log("[DebugTransitions] patched startViewTransition");
    }

    console.log("[DebugTransitions] mounted, pathname:", pathname, Date.now());

    return () => {
      console.log("[DebugTransitions] unmounted", Date.now());
    };
  }, []);

  return null;
}
