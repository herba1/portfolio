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
  className=""
}) {
  const navContainer = useRef();
  const [menuIsOpen, setMenuIsOpen] = useState(false);
  const tl = useRef();

  const { contextSafe } = useGSAP(() => {
      tl.current = gsap.timeline({
        paused:true,
      });
      tl.current
      .set('.nav__background',{
        opacity:1,
        clipPath:'polygon(0 0, 100% 0, 100% 0, 0 0)',
        skew:-1,
      })
      .to('.nav__background',{
        ease:'power2.inOut',
        duration:1,
        rotate:0,
        clipPath:'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
      },'first')
      .to(navContainer.current,{
      },'first')
  }, { scope:navContainer });

  return (
    <nav
      ref={navContainer}
      className={` fixed perspective-midrange w-full   nav__container flex justify-between items-center  p-4 md:p-6 ${inter.className} font-medium text-base tracking-body-base ${className}`} 
    >
      {/* nav background */}
      <div className="nav__background  opacity-0 rounded-b-xs  bg-black   left-0 right-0 h-full -z-10 absolute"></div>
      <div className="nav__left">
        <NavLogo />
      </div>
      <div className="nav__right gap-5 lg:gap-10 flex">
        <NavMenuButton className={''} setMenuIsOpen={setMenuIsOpen} >Menu</NavMenuButton>
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
