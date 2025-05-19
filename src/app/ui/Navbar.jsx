"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Menu, Phone, ChevronDown } from "lucide-react";
import LinkMask from "./LinkMask";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useLenis } from "@/context/LenisContext";
import { ScrollTrigger } from "gsap/all";

function NavMenu({ menuIsOpen, setMenuIsOpen, children }) {
  const container = useRef();
  const menu = useRef();
  const tl = useRef();
  const { lenis } = useLenis();

  useEffect(() => {
    if (menuIsOpen && lenis) {
      openMenu();
      lenis.stop();
    } else if (!menuIsOpen && lenis) {
      closeMenu();
      lenis.start();
    }

    function handleClickOutside(event) {
      if (menuIsOpen && menu.current && !menu.current.contains(event.target)) {
        setMenuIsOpen(false);
      }
    }

    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [menuIsOpen]);

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({ paused: true });
      gsap.set(".nav__menu", {
        clipPath: "polygon(0 0,100% 0 , 100% 0, 0 0)",
      });
      gsap.set(container.current, {
        opacity: 0,
        pointerEvents: "none",
      });

      tl.current
        .to(
          container.current,
          {
            opacity: 1,
            pointerEvents: "all",
          },
          "tart"
        )
        .to(
          ".nav__menu",
          {
            clipPath: "polygon(0 0,100% 0 , 100% 100%, 0 100%)",
            opacity: 1,
          },
          "start"
        );
    },
    { scope: container }
  );

  const openMenu = contextSafe(() => {
    tl.current.play();
  });
  const closeMenu = contextSafe(() => {
    tl.current.timeScale(2).reverse();
  });

  return (
    <menu
      ref={container}
      className={` opacity-0 nav__menu__container fixed left-0 top-0 w-dvw h-[100vh] bg-black/40 grid  lg:grid-cols-2 sm:p-5 sm:justify-end sm:items-end"`}
    >
      <div
        ref={menu}
        className=" rounded-sm nav__menu opacity-0 bg-pink-300 h-full w-full lg:col-start-2 lg:w-auto sm:w-[420px]"
      >
        <div
          className={`nav__menu__top h-16 flex items-center justify-between`}
        >
          <Link
            href={"#"}
            className=" pl-5 nav__logo font-extrabold text-2xl transform-3d   "
          >
            herb.
          </Link>
          <button
            type="button"
            className=" active:rotate-0 active:scale-95 hover:rotate-8 hover:scale-105 transition-all"
          >
            <X
              onClick={() => {
                setMenuIsOpen(false);
              }}
              size={48}
              strokeWidth={1}
              className="text-white "
            ></X>
          </button>
        </div>
        <div className={`nav__menu__content h-full p-5`}></div>
      </div>
    </menu>
  );
}

function NavCta() {
  return (
    <div className=" flex items-center justify-center order-2">
      <button
        type="button"
        className=" cursor-pointer outline-2 p-2 rounded-full outline-pink-300 hover:bg-pink-300 hover:scale-105 active:scale-95 active:opacity-90 transition-all "
      >
        Call to Action
      </button>
    </div>
  );
}

function NavPhone({ phone = "559-XXX-XXXX" }) {
  return (
    <div className="flex items-center font-extrabold underline">
      <Phone size={16} className="mr-1"></Phone>
      <a href={`tel:${phone}`}>{phone}</a>
    </div>
  );
}

const LINKS = [
  {
    name: "Dropdown",
    link: "/",
    links: [
      { name: "you", link: "/" },
      { name: "cannot", link: "/" },
      { name: "see!", link: "/" },
    ],
  },
  { name: "Home", link: "/" },
  { name: "Contact", link: "/contact" },
];

function NavDropdownLink({ name, link, links }) {
  const container = useRef();
  const tl = useRef();
  const tlChev = useRef();

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({ paused: true });
      tlChev.current = gsap.timeline({ paused: true });

      gsap.set(".link__dropdown__container", {
        clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)",
        opacity: 0,
      });

      tl.current.to(
        ".link__dropdown__container",
        {
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
          opacity: 1,
        },
        "in"
      );

      tl.current.to(
        ".chevron__button",
        {
          ease: "power1.inOut",
          rotate: -180,
        },
        "in"
      );
    },
    { scope: container }
  );

  const toggleDropdown = contextSafe(() => {
    // Check the progress of the timeline to determine if it's open or closed
    if (tl.current.progress() > 0 && !tl.current.reversed()) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  const closeDropdown = contextSafe(() => {
    tl.current.timeScale(2.5).reverse();
    tlChev.current.reverse();
  });
  const openDropdown = contextSafe(() => {
    tl.current.play();
    tlChev.current.play();
  });

  const dropdownLinks = links.map((link) => {
    return (
      <li key={link.name} className="flex flex-col items-stretch">
        <LinkMask text={link.name} href={`${link.link}`}></LinkMask>
      </li>
    );
  });

  return (
    <li>
      <div
        onMouseLeave={toggleDropdown}
        onMouseEnter={toggleDropdown}
        ref={container}
        className="nav__link__dropdown flex justify-center relative min-w-fit  w-full"
      >
        <div className="flex items-center">
          <LinkMask
            text={name}
            className="flex justify-center items-center"
            href={link}
          ></LinkMask>
          <button
            onClick={toggleDropdown}
            type="button"
            className=" cursor-pointer"
          >
            <ChevronDown
              aria-label="toggle dropdown menu"
              className={`chevron__button`}
            ></ChevronDown>
          </button>
        </div>
        <div
          className={` opacity-0 overflow-hidden path link__dropdown__container min-w-[150%] top-full absolute pt-3   `}
        >
          <ul
            className={`bg-white outline-1 outline-neutral-300 text-black  text-left p-3 rounded-md min-w-fit w-full  `}
          >
            {dropdownLinks}
          </ul>
        </div>
      </div>
    </li>
  );
}

function NavLinks() {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const links = LINKS.map((link) => {
    if (link.links) {
      return (
        <NavDropdownLink
          key={link.name}
          link={link.name}
          name={link.name}
          links={link.links}
        ></NavDropdownLink>
      );
    } else {
      return (
        <li key={link.name}>
          <LinkMask text={link.name} href={link.link}></LinkMask>
        </li>
      );
    }
  });
  return (
    <div className=" hidden font-sans nav__links md:flex text-center items-center">
      <ul className="flex font text-lg items-center gap-5 lg:gap-10 ">
        {links}
      </ul>
    </div>
  );
}

function NavMenuButton({ setMenuIsOpen }) {
  return (
    <button
      onClick={() => {
        setMenuIsOpen(true);
      }}
      type="button"
      className=" cursor-pointer  nav__button--open md:hidden order-4 "
    >
      <Menu className=" " strokeWidth={2}></Menu>
    </button>
  );
}

function NavLogo() {
  return (
    <Link href={"#"} className=" nav__logo">
      {/* logo would go in here */}
      <h1 className="font-extrabold text-2xl">herb.</h1>
    </Link>
  );
}

export default function Navbar({
  phoneVisible,
  ctaVisible,
  phone = "559-XXX-XXXX",
  navTriggerElement,
}) {
  const navContainer = useRef();
  const [menuIsOpen, setMenuIsOpen] = useState(false);
  const tl = useRef();

  useEffect(() => {
    const navTrigger = contextSafe(() => {
      ScrollTrigger.create({
        trigger:navTriggerElement.current,
        markers:true,
        start:"top top",
        end:"bottom-=500 top",
        onToggle:(self)=>{
          if(self.isActive){
            navBgShow();
          }
          else{
            navBgHide();
          }
        },
        
      })
    });
    navTrigger();
  });

  const { contextSafe } = useGSAP(() => {
      tl.current = gsap.timeline({
        paused:true,
      });
      tl.current
      .set('.nav__background',{
        opacity:1,
        clipPath:'polygon(0 0, 100% 0, 100% 0, 0 0)',
        rotate:-1,
      })
      .to('.nav__background',{
        duration:0.3,
        rotate:0,
        clipPath:'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
      },'first')
      .to(navContainer.current,{
      },'first')
  }, { scope:navContainer });

  const navBgShow = contextSafe(()=>{
    tl.current.play();
  })
  const navBgHide= contextSafe(()=>{
    tl.current.reverse();
  })

  return (
    <nav
      ref={navContainer}
      className=" fixed perspective-midrange w-[100vw] nav__container text-white h-14 flex justify-between items-center p-3 lg:p-7 "
    >
      {/* nav background */}
      <div className="nav__background backdrop-blur-md opacity-0 rounded-b-xs  bg-black   left-0 right-0 h-full -z-10 absolute"></div>
      <div className="nav__left">
        <NavLogo />
      </div>
      <div className="nav__right gap-5 lg:gap-10 flex">
        <NavMenuButton setMenuIsOpen={setMenuIsOpen} />
        {phoneVisible && <NavPhone />}
        {ctaVisible && <NavCta />}
        <NavLinks />
        <NavMenu
          menuIsOpen={menuIsOpen}
          setMenuIsOpen={setMenuIsOpen}
        ></NavMenu>
      </div>
    </nav>
  );
}
