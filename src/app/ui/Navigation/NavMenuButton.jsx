"use client";

import posthog from "posthog-js";
import { useMobileMenu } from "./MobileMenuContext";

export default function NavMenuButton({ className = "", children }) {
  const { open, toggle } = useMobileMenu();
  return (
    <button
      onClick={() => {
        posthog.capture("nav_menu_toggled");
        toggle();
      }}
      type="button"
      aria-expanded={open}
      aria-label={open ? "Close menu" : "Open menu"}
      className={`touch-manipulation active:scale-95 transition-transform cursor-pointer nav__button--open sm:hidden order-4 ${className}`}
    >
      {open ? "Close" : children}
    </button>
  );
}
