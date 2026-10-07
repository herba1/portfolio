"use client";

import { memo, useEffect } from "react";

import { lockPageScroll } from "@/lib/pageScroll";

/* ─────────────────────────────────────────────────────────────────────────
   FlyoutChrome — takes the site off the screen.

   /flyout is a phone app, not a page on herb.art. The root layout's navbar and
   footer clock both belong to the site and both read as somebody else's
   furniture inside this UI, so they come off for the life of the route and
   go straight back on the way out. Same approach ~studio takes.
   ───────────────────────────────────────────────────────────────────────── */

function FlyoutChrome({ lockScroll = false }) {

  useEffect(() => {
    const nav = document.querySelector("nav");
    const clock = document.querySelector(".footer-clock");

    if (nav) nav.style.display = "none";
    if (clock) clock.style.display = "none";

    return () => {
      if (nav) nav.style.display = "";
      if (clock) clock.style.display = "";
    };
  }, []);

  useEffect(() => {
    if (!lockScroll) return undefined;
    return lockPageScroll();
  }, [lockScroll]);

  return null;
}

export default memo(FlyoutChrome);
