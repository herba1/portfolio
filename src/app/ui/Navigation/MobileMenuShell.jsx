"use client";

import { useMobileMenu } from "./MobileMenuContext";
import NavMenu from "./NavMenu";

/* Wraps the page. On mobile, opening the menu pushes the page card straight
   down (CSS .page-card.is-open), revealing the link list behind it. Tapping
   the card closes the menu. The navbar lives outside this wrapper, so it stays. */
export default function MobileMenuShell({ children }) {
  const { open, setOpen } = useMobileMenu();
  return (
    <>
      <NavMenu open={open} setOpen={setOpen} />
      <div
        className={`page-card ${open ? "is-open" : ""}`}
        onClick={open ? () => setOpen(false) : undefined}
        aria-hidden={open ? "true" : undefined}
      >
        {children}
      </div>
    </>
  );
}
