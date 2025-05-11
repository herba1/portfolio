'use client'
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
    
import { Observer } from "gsap/Observer";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
// ScrollSmoother requires ScrollTrigger
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(Observer,ScrambleTextPlugin,ScrollTrigger,ScrollSmoother,SplitText);


export default function Home() {

  useGSAP(()=>{
    // ScrollSmoother.create();
  })

  return (
      <div id="content">
        <article className="main-content relative  border-2 bg-white  border-black  flex justify-center items-center h-svh w-dvw ">
          <h1 className="text-center text-4xl font-serif">
            who is this crazed man
          </h1>
        </article>
        {/* main footer container should have any height wanted */}
        <footer className="h-svh w-dvw flex flex-col justify-end relative -z-10 bg-black">
          {/* spacing should be calculation of footer? + some height in our case full height */}
          <div className="h-[200vh] relative shrink-0 border-2">
            {/* actual container conent goes in side this div */}
            <div className="h-svh w-full fixed bg-blue-600 flex justify-center items-center">
              <h1 className="font-serif text-2xl text-white">
                im talking about my girl &lt;3
              </h1>
            </div>
          </div>
        </footer>
      </div>
  );
}