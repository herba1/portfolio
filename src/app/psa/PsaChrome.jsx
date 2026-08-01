"use client";

import { useEffect } from "react";

import { useLenis } from "@/context/LenisContext";

/* ─────────────────────────────────────────────────────────────────────────
   PsaChrome — takes the site off the screen.

   /psa is a phone app, not a page on herb.art. The root layout's navbar and
   footer clock both belong to the site and both read as somebody else's
   furniture inside this UI, so they come off for the life of the route and
   go straight back on the way out. Same approach ~studio takes.

   `killLenis` is opt-in: /psa is a fixed app screen that scrolls its own
   panels and wants smooth-scroll gone, but a long-gallery caller would
   still want the site's scrolling.
   ───────────────────────────────────────────────────────────────────────── */

export default function PsaChrome({ killLenis = false }) {
  const { lenis } = useLenis();

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
    if (!killLenis || !lenis) return;
    lenis.stop();
    return () => lenis.start();
  }, [killLenis, lenis]);

  return null;
}
