"use client";
import StickyFooter from "./ui/StickyFooter";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import Navbar from "./ui/Navbar";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

export default function Home() {
  return (
    <div id="content" className=" page__wrapper ">
      <Navbar></Navbar>
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
          <h1 className="   text-white max-w-80  text-7xl mb-1">
            Lost Weathered And Torn
          </h1>
        </div>
      </div>

      {/* first section */}
      <div className="main__container navTrigger">
        <article className="main-content  bg-white flex justify-center items-center h-svh  ">
          <h1 className="text-center text-4xl ">this is some content</h1>
        </article>
        <article className="main-content  bg-white flex justify-center items-center h-svh  ">
          <h1 className="text-center text-4xl ">this is some content</h1>
        </article>
        <article className="main-content  bg-white flex justify-center items-center h-svh  ">
          <h1 className="text-center text-4xl ">this is some content</h1>
        </article>
      </div>
      <StickyFooter></StickyFooter>
    </div>
  );
}
