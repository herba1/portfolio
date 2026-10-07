"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
  const closeTimer = useRef(null);
  const wasActive = useRef(false);
  // Work parked until the close animation finishes — see closeThen below.
  const afterClose = useRef(null);

  const doOpen = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    // Reopening cancels a close, so anything that close was going to do is
    // abandoned with it — otherwise a tap-then-reopen would navigate later.
    afterClose.current = null;
    setSnapshotY(Math.round(window.scrollY));
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

  // Close, then run `fn` once the card is genuinely back — used by the mobile
  // link list to navigate. It has to wait, because an open card is
  // `position: fixed` with `transform: translateY(57vh) scale(.96)` and
  // `overflow: hidden`, and the page's <PageTransition>
  // lives *inside* it. Navigating mid-close hands the browser an outgoing
  // snapshot that is scaled down, pushed off the bottom of the screen and
  // clipped to the card window, which it then cross-fades against a full-size
  // incoming page. Letting the card land first means the transition captures
  // the page the same way it does on desktop.
  const closeThen = (fn) => {
    afterClose.current = fn;
    doClose();
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

    window.scrollTo({ top: y, behavior: "instant" });

    // Anything waiting on the close runs here and not a moment earlier — the
    // card is back in flow and the scroll is where the reader left it, so a
    // navigation now starts from the same state a desktop click would. Two
    // frames, deliberately: the first paints the restored page, the second
    // navigates against it. Pushing from inside the layout effect would let
    // React commit the route change in the same pass that un-fixes the card,
    // and the transition would snapshot the halfway state we just waited out.
    const run = afterClose.current;
    if (run) {
      afterClose.current = null;
      requestAnimationFrame(() => requestAnimationFrame(run));
    }
  }, [active, snapshotY]);

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
      value={{ open, active, snapshotY, toggle, close, closeThen, setOpen }}
    >
      {children}
    </MobileMenuContext.Provider>
  );
}

export const useMobileMenu = () => useContext(MobileMenuContext);
