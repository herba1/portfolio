"use client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useEffect, useRef, useLayoutEffect } from "react";
import { createContext } from "react";
import { useLenis } from "@/context/LenisContext";

const TimelineContext = createContext();

export default function Loading({ children }) {
  const container = useRef(null);
  const { lenis } = useLenis();

  const startLenis = () => {
    lenis.start();
  };
  const { contextSafe } = useGSAP(() => {}, { scope: container.current });

  useLayoutEffect(() => {
    if (!lenis) return;
    lenis.scrollTo(0,{immediate:true})
    // lenis.stop();
    let anim = contextSafe(() => {
      gsap.to(
        ".load",
        {
          opacity: 0,
          pointerEvents: "none",
          ease: "power4.out",
          delay: 0.1,
          duration: 0.5,
        },
        "start",
      );
      let t2 = gsap.fromTo(
        container.current,
        {
          scale: 1.1,
        },
        {
          delay: 0.5,
          scale: 1,
          ease:'power4.out',
          duration:1,
          onComplete: () => {
            t2.revert();
            lenis.resize();
          },
        },
      );
    });
    anim();
  }, [lenis]);

  return (
    <div ref={container} className={`bg-light relative overflow-clip`}>
      <div className="load bg-dark  absolute top-0 left-0 z-50 h-full w-full"></div>
      <TimelineContext value={gsap.timeline({ paused: false})}>
        {children}
      </TimelineContext>
    </div>
  );
}
