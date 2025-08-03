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
    lenis.stop();
    let anim = contextSafe(() => {
      let t1 = gsap.to(
        ".load",
        {
          opacity: 0,
          pointerEvents: "none",
          ease: "power4.out",
          delay: 0.5,
          duration: 1,
        },
        "start",
      );
      let t2 = gsap.fromTo(
        container.current,
        {
          scale: 1.15,
        },
        {
          delay: 0.8,
          scale: 1,
          ease:'power4.out',
          duration:0.85,
          onComplete: () => {
            // t2.revert();
            t2.revert();
            lenis.start();
            lenis.resize();
          },
        },
      );
    });
    anim();
  }, [lenis]);

  return (
    <div ref={container} className={`bg-light relative z-10 overflow-clip`}>
      <div className="load bg-dark absolute top-0 left-0 z-50 h-full w-full"></div>
      <TimelineContext value={gsap.timeline({ paused: true })}>
        {children}
      </TimelineContext>
    </div>
  );
}
