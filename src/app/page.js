"use client";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { Inter } from "next/font/google";
import { useRef } from "react";
import PageDistort from "./ui/PageDistort";
import TransitionLink from "./ui/Navigation/TransitionLink";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

export default function Home() {
  const navTrigger = useRef(null);

  return (
    <div id="content" className={` relative`}>
      {/* HERO BG SECTION */}
      {/* <div className="h-svh sticky top-0 -z-10 ">
        <Image
          src={"img1.png"}
          unoptimized
          className="-z-20 select-none absolute h-full saturate-150 w-full object-cover"
          alt="noise"
          fill="true"
        ></Image>
        <div className="w-full h-full bg-black/20 absolute -z-10"></div>
        <div className="z-10 flex flex-col justify-end h-full p-5">
          <h1 className="   text-white max-w-80  text-7xl mb-1">
            Lost Weathered And Torn
          </h1>
        </div>
      </div> */}
      {/* first section */}
      
      <div ref={navTrigger}  className="main__container ">
        <div className="h-20"></div>
        <article className="main-content  bg-white h-svh">
          <h1 className="text-center text-4xl ">this is some content</h1>
          <TransitionLink href="/">Wouldnt It Be Nice</TransitionLink>
          <TransitionLink href="/contact">Oh Caroline</TransitionLink>
        </article>
        {/* <PageDistort/> */}
        <article className="main-content  bg-green-300 flex justify-center items-center h-svh  ">
          <h1 className="text-center text-4xl ">this is some content</h1>
        </article>
        <article className="main-content  bg-green-300 flex justify-center items-center h-svh  ">
          <h1 className="text-center text-4xl ">HELLO</h1>
        </article>
      </div>
    </div>
  );
}
