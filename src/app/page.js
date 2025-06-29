"use client";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { Inter } from "next/font/google";
import { useRef } from "react";
import Marquee from "./ui/Hero/Marquee";
import HeroSection from "./ui/Hero/HeroSection";
import ImagePixel from "./ui/ImagePixel";
import PageDistort from "./ui/PageDistort";
import Portoflio from "./ui/Porotflio/Portoflio";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

export default function Home() {
  const navTrigger = useRef(null);

  return (
    <main id="content" className={`relative`}>
      <div className="hero__container">
        <HeroSection></HeroSection>
      </div>
      <div className="bg-light mx-4 lg:mx-6 min-h-lvh">
        <Portoflio></Portoflio>
      </div>
      <div className="hero__container">
        <HeroSection></HeroSection>
      </div>
      {/* <div className="hero__container">
        <HeroSection></HeroSection>
      </div> */}
    </main>
  );
}
