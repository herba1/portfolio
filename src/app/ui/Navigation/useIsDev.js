"use client";

import { useState, useEffect } from "react";

// True during `next dev`, or on a localhost host even in a production build.
// Starts from NODE_ENV (identical on server + client) to avoid a hydration
// mismatch, then upgrades after mount when running on localhost.
export function useIsDev() {
  const [isDev, setIsDev] = useState(process.env.NODE_ENV === "development");

  useEffect(() => {
    if (isDev) return;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      setIsDev(true);
    }
  }, [isDev]);

  return isDev;
}
