"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   Dev flags for /psa.

   Off by default, turned on by URL and then remembered:

       /psa?spring=1     on, and sticky from then on
       /psa?spring=0     off again

   Sticky because the whole point of a flag here is to compare two engines
   over a session without retyping a query string every reload, and off by
   default because nothing that already works should change because a new
   thing was added next to it.

   Read in an effect, never during render: the server has no location, and a
   flag that differs between the server pass and the first client pass is a
   hydration mismatch. So the first paint is always the un-flagged app.
   ───────────────────────────────────────────────────────────────────────── */

const KEY = (name) => `psa.flag.${name}`;

export function useFlag(name) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.has(name)) {
        const raw = q.get(name);
        const next = raw === "" || raw === "1" || raw === "true";
        window.localStorage.setItem(KEY(name), next ? "1" : "0");
        setOn(next);
        return;
      }
      setOn(window.localStorage.getItem(KEY(name)) === "1");
    } catch {
      // Private mode, blocked storage — the flag is simply off.
      setOn(false);
    }
  }, [name]);

  return on;
}
