"use client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useEffect, useRef, useLayoutEffect } from "react";
import { createContext } from "react";

const TimelineContext = createContext();

export default function Loading({ children }) {
  const container = useRef(null);
  const { contextSafe } = useGSAP(() => {}, { scope: container.current });

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
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
          },
        },
      );
    });
    anim();
  }, []);

  return (
    <div ref={container} className={`bg-light relative overflow-clip`}>
      <div className="load bg-dark  absolute top-0 left-0 z-[var(--z-index-nav)] h-full w-full"></div>
      <TimelineContext value={gsap.timeline({ paused: false})}>
        {children}
      </TimelineContext>
    </div>
  );
}
