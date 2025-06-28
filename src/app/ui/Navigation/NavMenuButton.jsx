import { Menu } from "lucide-react";

export default function NavMenuButton({ setMenuIsOpen, className,children }) {
  return (
    <button
      onClick={() => {
        setMenuIsOpen(true);
      }}
      type="button"
      className={` touch-manipulation active:scale-95 active:scale-y-90 transition-all cursor-pointer  nav__button--open sm:hidden order-4 text-dark ${className} `}
    >
      {/* <Menu className=" " strokeWidth={2}>{children}</Menu> */}
      {children}
    </button>
  );
}
