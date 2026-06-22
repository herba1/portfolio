"use client";

import { useMobileMenu } from "./MobileMenuContext";
import NavMenu from "./NavMenu";

/* Wraps the page. On mobile, opening the menu pushes the page card straight
   down (CSS .page-card.is-open), revealing the link list behind it. Tapping
   the card closes the menu. The navbar lives outside this wrapper, so it stays. */
export default function MobileMenuShell({ children }) {
  const { open, active, snapshotY, setOpen } = useMobileMenu();
  return (
    <>
      <NavMenu open={open} setOpen={setOpen} />
      <div
        className={`page-card ${active ? "is-active" : ""} ${open ? "is-open" : ""}`}
        onClick={active ? () => setOpen(false) : undefined}
        aria-hidden={open ? "true" : undefined}
      >
        {/* While the card is the fixed viewport window, shift the content up by
            the captured scroll so it shows the exact slice you were looking at
            — the snapshot. In normal flow this is a no-op wrapper. */}
        <div
          className="page-card-inner"
          style={active ? { transform: `translateY(${-snapshotY}px)` } : undefined}
        >
          {children}
        </div>
      </div>
    </>
  );
}
