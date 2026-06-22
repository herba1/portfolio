"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLenis } from "@/context/LenisContext";

const MobileMenuContext = createContext(null);

// Keep in sync with the .page-card transform transition in globals.css.
const CLOSE_MS = 500;

// useLayoutEffect on the client, useEffect on the server (avoids the SSR warning).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function MobileMenuProvider({ children }) {
  const [open, setOpenState] = useState(false);
  // `active` keeps the page card fixed + clipped through the whole close
  // animation, so it can slide back up smoothly before returning to flow.
  const [active, setActive] = useState(false);
  // The scroll position captured the moment the menu opens — the card's inner
  // wrapper is shifted up by this so the fixed window shows your exact slice.
  const [snapshotY, setSnapshotY] = useState(0);
  const { lenis, scrollTrigger } = useLenis();
  const closeTimer = useRef(null);
  const wasActive = useRef(false);

  const doOpen = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    // Lenis owns the scroll, so its value is authoritative — window.scrollY can
    // lag or read 0 depending on the smoothing. Fall back to it just in case.
    const y = Math.round(
      lenis?.actualScroll ?? lenis?.scroll ?? window.scrollY ?? 0
    );
    setSnapshotY(y);
    lenis?.stop();
    // Freeze every scroll-driven animation (splat parallax, scroll progress…).
    // Making the card fixed collapses the document to viewport height, which
    // would otherwise fire a ScrollTrigger resize + scroll-to-0 and snap the
    // parallax back to progress 0 inside the snapshot. disable(false) leaves the
    // current transforms exactly as they are, so the frozen frame stays honest.
    scrollTrigger?.getAll().forEach((st) => st.disable(false));
    setActive(true);
    setOpenState(true);
  };

  const doClose = () => {
    setOpenState(false); // starts the card sliding back up + menu fading out
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setActive(false); // card returns to normal flow (scroll restored below)
    }, CLOSE_MS);
  };

  // Once the card is back in flow, restore the real scroll position. Done in a
  // layout effect (after the DOM reflows, before paint) so the page is tall
  // again — scrollTo would otherwise clamp to 0 against the collapsed document.
  useIsoLayoutEffect(() => {
    if (active) {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return; // initial mount, never opened
    wasActive.current = false;
    const y = snapshotY;

    // Re-enable the frozen scroll animations and recompute their geometry first
    // (refresh() can nudge the scroll while measuring — we override it below).
    if (scrollTrigger) {
      scrollTrigger.getAll().forEach((st) => st.enable());
      scrollTrigger.refresh();
    }

    // Restore the scroll position LAST so it wins. Order matters: start Lenis
    // BEFORE hard-setting its position. If we scrollTo while it's stopped and
    // then start, it resumes from a stale internal 0 and visibly lerps the page
    // up to the very top. Starting first, then force-setting to `y`, keeps it
    // pinned. window.scrollTo backs it up at the DOM level.
    lenis?.start();
    lenis?.scrollTo(y, { immediate: true, force: true });
    window.scrollTo(0, y);
  }, [active, snapshotY, lenis, scrollTrigger]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const toggle = () => (open ? doClose() : doOpen());
  const close = () => doClose();
  // Compatibility shim for callers that still do setOpen(true/false).
  const setOpen = (next) => {
    const value = typeof next === "function" ? next(open) : next;
    value ? doOpen() : doClose();
  };

  return (
    <MobileMenuContext.Provider
      value={{ open, active, snapshotY, toggle, close, setOpen }}
    >
      {children}
    </MobileMenuContext.Provider>
  );
}

export const useMobileMenu = () => useContext(MobileMenuContext);
