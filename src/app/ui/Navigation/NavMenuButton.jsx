import { Menu } from "lucide-react";
import posthog from "posthog-js";

export default function NavMenuButton({ setMenuIsOpen, className,children }) {
  return (
    <button
      onClick={() => {
        posthog.capture("nav_menu_toggled");
        setMenuIsOpen((prev) => !prev);
      }}
      type="button"
      className={` touch-manipulation active:scale-95 active:scale-y-90 transition-all cursor-pointer  nav__button--open sm:hidden order-4 ${className} `}
    >
      {/* <Menu className=" " strokeWidth={2}>{children}</Menu> */}
      {children}
    </button>
  );
}
