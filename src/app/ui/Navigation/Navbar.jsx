"use client";
import { useRef } from "react";
import NavLogo from "./NavLogo";
import NavMenuButton from "./NavMenuButton";
import NavPhone from "./NavPhone";
import NavLinks from "./NavLinks";
import { geist } from "@/app/fonts";

export default function Navbar({
  phoneVisible,
  ctaVisible,
  phone = "559-XXX-XXXX",
  className = "",
}) {
  const navContainer = useRef();

  return (
    <nav
      ref={navContainer}
      className={`fixed w-full z-50 nav__container flex items-center justify-between p-4 antialiased md:p-6 ${geist.className} tracking-body-base text-base font-medium ${className}`}
    >
      <div className="nav__left z-50">
        <NavLogo />
      </div>
      <div className="nav__right flex gap-5 lg:gap-10">
        <NavMenuButton>Menu</NavMenuButton>
        {phoneVisible && <NavPhone />}
        {ctaVisible && <NavCta />}
        <NavLinks className="z-50" />
      </div>
    </nav>
  );
}
