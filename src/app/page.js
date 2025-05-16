"use client";
import { useEffect, useRef, useState } from "react";
import StickyFooter from "./ui/StickyFooter";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { X, Menu } from "lucide-react";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

function Navbar({ triggerRef }) {
  // const navTriggerSmall = useRef(navTriggerSmallRef);
  const navContainer = useRef();
  const navTl = useRef();
  const [menuIsOpen, setMenuIsOpen] = useState(false);
  const menuTl = useRef();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useGSAP(
    () => {
      // navbar
      gsap.set(".nav__background", {
        // y: "-200%",
        // skewX: -10,
        // rotate: -4,
      });

      navTl.current = gsap
        .timeline({
          scrollTrigger: {
            trigger: "",
            markers: false,
            start: "top top",
            end: "top top",
            toggleActions: "play none none reverse",
          },
        })
        .to(
          ".nav__background",
          {
            ease: "expo",
            y: 0,
            rotate: 0,
            skewX: 0,
            duration: 0.6,
          },
          "start"
        )
        .to(navContainer.current, {
          height: 10,
        });
    },
    { scope: navContainer }
  );
  return (
    // parent container
    <nav
      ref={navContainer}
      className=" fixed perspective-midrange w-[100vw] nav__container text-white h-16 flex justify-between items-center p-5 "
    >
      {/* nav background color */}
      <div className="nav__background rounded-b-xs bg-linear-to-b from-black/50 to-black/0  left-0 right-0 h-full -z-10 absolute"></div>
      {/* nav left content */}
      <div className="nav__left">
        <Link
          href={"#"}
          className=" nav__logo font-extrabold text-2xl transform-3d   "
        >
          herb.
        </Link>
      </div>
      {/* nav right content */}
      <div className="nav__right">
        <button
          onClick={() => {
            setMenuIsOpen(true);
          }}
          type="button"
          className=" nav__button--open md:hidden "
        >
          <Menu className=" " strokeWidth={2}></Menu>
        </button>
      </div>

      {/* Nav links and dropdowns */}
      <div className=" hidden font-sans  nav__links md:flex text-center items-center">
        <ul className="flex font text-lg items-center gap-10 ">
          <li>
            <div className="nav__link__dropdown relative"
            
              onMouseOver={(e)=>{
                console.log(e.target);
                setDropdownOpen(true);
              }}
              onMouseLeave={(e)=>{
                setDropdownOpen(false);
              }}
            >
              <Link href={"#"}>Dropdown</Link>
              <ul
                className={`fixed bg-pink-400 w-fit rounded-md p-2 ${
                  dropdownOpen ? " block " : " hidden "
                } `}
              >
                <li>
                  <Link href={"#"}>A link</Link>
                </li>
                <li>
                  <Link href={"#"}>A link</Link>
                </li>
                <li>
                  <Link href={"#"}>A link</Link>
                </li>
                <li>
                  <Link href={"#"}>A link</Link>
                </li>
              </ul>
            </div>
          </li>
          <li>
            <Link href={"#"}>Home</Link>
          </li>
          <li>
            <Link href={"#"}>About</Link>
          </li>
          <li>
            <Link href={"#"}>Contact</Link>
          </li>
        </ul>
      </div>

      {/* Modal menu */}
      <menu
        className={` ${
          menuIsOpen ? " grid " : " hidden "
        } nav__menu__container transition-all fixed left-0 top-0 w-dvw h-[100vh] grid  lg:grid-cols-2 sm:p-5 sm:justify-end sm:items-end"`}
      >
        <div className=" rounded-sm nav__menu__modal bg-pink-300 h-full w-full lg:col-start-2 lg:w-auto sm:w-[420px]">
          <div
            className={`nav__menu__top h-16 flex items-center justify-between`}
          >
            <Link
              href={"#"}
              className=" pl-5 mix-blend-difference nav__logo font-extrabold text-2xl transform-3d   "
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
                className="text-black"
              ></X>
            </button>
          </div>
          <div className={`nav__menu__content grow p-5`}>
            <div className="h-full grid grid-rows-2 ">
              <ul className="max-w-300 text-4xl row-start-2  text-black">
                <li>
                  <Link href={"#"}>Nothing</Link>
                </li>
                <li>
                  <Link href={"#"}>Everything</Link>
                </li>
                <li>
                  <Link href={"#"}>Something</Link>
                </li>
                <li>
                  <Link href={"#"}>Onething</Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </menu>
    </nav>
  );
}

export default function Home() {
  // const navTriggerSmall = useRef();
  // const navContainer = useRef();
  // const navTl = useRef();
  // const footerRef = useRef();

  return (
    <div id="content" className=" font-serif ">
      <Navbar></Navbar>

      {/* HERO BG SECTION */}
      <div className="h-svh sticky top-0 -z-10 ">
        <Image
          src={"water.gif"}
          unoptimized
          className="-z-20 select-none absolute h-full saturate-150 w-full object-cover"
          alt="noise"
          fill="true"
        ></Image>
        <div className="w-full h-full bg-black/20 absolute -z-10"></div>
        <div className="z-10 flex flex-col justify-end h-full p-5">
          <h1 className=" font-sans  text-white max-w-80  text-7xl mb-1">
            Lost Weathered And Torn
          </h1>
        </div>
      </div>

      {/* first section */}
      <article className="main-content  bg-white flex justify-center items-center h-svh  ">
        <h1 className="text-center text-4xl font-serif">
          this is some content
        </h1>
      </article>
      <article className="main-content  bg-white flex justify-center items-center h-svh  ">
        <h1 className="text-center text-4xl font-serif">
          this is some content
        </h1>
      </article>
      <article className="main-content  bg-white flex justify-center items-center h-svh  ">
        <h1 className="text-center text-4xl font-serif">
          this is some content
        </h1>
      </article>
      <StickyFooter></StickyFooter>
    </div>
  );
}
