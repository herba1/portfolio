"use client";
import { useEffect, useRef } from "react";
import StickyFooter from "./ui/StickyFooter";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { Menu } from "lucide-react";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

export default function Home() {
  const navTriggerSmall = useRef();
  const navContainer = useRef();
  const navTl = useRef();

  useGSAP(
    () => {
      let logoSplit = SplitText.create(".nav__logo", {
        type: "lines,chars,words",
      });
      // navbar
      gsap.set(".nav__background", {
        y: "-200%",
        skewX: -10,
        rotate: -4,
      });

      navTl.current = gsap
        .timeline({
          scrollTrigger: {
            trigger: navTriggerSmall.current,
            markers: false,
            start: "top +=30",
            end: "top",
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
        .to(navContainer.current,{
          height:10,
          
        })
        ;
    },
    { scope: navContainer }
  );

  return (
    <div id="content" className=" font-serif ">
      <nav
        ref={navContainer}
        className=" fixed perspective-midrange w-[100vw] nav__container text-white h-16 flex justify-between items-center p-5 "
      >
        <div className="nav__background rounded-b-xs bg-black backdrop-blur-sm  left-0 right-0 h-full -z-10 absolute"></div>
        <Link
          href={"#"}
          className=" nav__logo font-extrabold text-2xl transform-3d   "
        >
         herb. 
        </Link>
        <button type="button" className=" nav__button ">
          <Menu className="" strokeWidth={2}></Menu>
        </button>
        <menu className=" fixed ">

        </menu>
      </nav>

      {/* HERO BG SECTION */}
      <div className="h-svh sticky top-0 -z-10 ">
        <Image
          src={"noise.gif"}
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
      <article
        ref={navTriggerSmall}
        className="main-content  bg-white flex justify-center items-center h-svh  "
      >
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
