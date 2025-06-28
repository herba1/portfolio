"use client";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { Inter } from "next/font/google";
import { useRef } from "react";
import Marquee from "./ui/Hero/Marquee";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

export default function Home() {
  const navTrigger = useRef(null);

  return (
    <div id="content" className={` relative`}>
      <main ref={navTrigger}  className="main__container h-1000">
        <article className="main-content bg-light    flex justify-center items-center min-h-svh  ">
          <Marquee></Marquee>
        </article>
      </main>
    </div>
  );
}
