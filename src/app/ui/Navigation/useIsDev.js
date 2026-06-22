"use client";

import { useState, useEffect } from "react";
import { isDevView, FORCE_PROD_VIEW } from "@/lib/viewMode";

// True during `next dev`, or on a localhost host even in a production build.
// Starts from the view mode (identical on server + client) to avoid a hydration
// mismatch, then upgrades after mount when running on localhost — unless the
// production view is forced (NEXT_PUBLIC_FORCE_PROD_VIEW), in which case we stay
// in prod view everywhere so `next dev` can preview the real navbar.
export function useIsDev() {
  const [isDev, setIsDev] = useState(isDevView());

  useEffect(() => {
    if (isDev || FORCE_PROD_VIEW) return;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      setIsDev(true);
    }
  }, [isDev]);

  return isDev;
}
