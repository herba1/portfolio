"use client";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/all";
import NavLogo from "./NavLogo";
import NavMenuButton from "./NavMenuButton";
import NavPhone from "./NavPhone";
import NavLinks from "./NavLinks";
import NavMenu from "./NavMenu";
import { inter } from "@/app/fonts";

export default function Navbar({
  phoneVisible,
  ctaVisible,
  phone = "559-XXX-XXXX",
  className = "",
}) {
  const navContainer = useRef();
  const [menuIsOpen, setMenuIsOpen] = useState(false);
  const tl = useRef();

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({
        paused: true,
      });
    },
    { scope: navContainer },
  );

  return (
    <nav
      ref={navContainer}
      className={`fixed w-full ${!menuIsOpen ? " " : " "} nav__container flex items-center justify-between p-4 antialiased md:p-6 ${inter.className} tracking-body-base text-base font-medium ${className}`}
    >
      {/* nav background */}
      <div className="nav__background absolute right-0 left-0 -z-10 h-full w-full bg-light/90 opacity-100 !backdrop-blur-lg sm:hidden"></div>
      <div className="nav__left">
        <NavLogo />
      </div>
      <div className="nav__right flex gap-5 lg:gap-10">
        <NavMenuButton className={""} setMenuIsOpen={setMenuIsOpen}>
          Menu
        </NavMenuButton>
        {phoneVisible && <NavPhone />}
        {ctaVisible && <NavCta />}
        <NavLinks className />
        <NavMenu
          menuIsOpen={menuIsOpen}
          setMenuIsOpen={setMenuIsOpen}
        ></NavMenu>
      </div>
    </nav>
  );
}
