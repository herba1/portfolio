"use client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import ScrollTrigger from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";

const SCROLL_INERTIA_DECAY = 0.94;

export default function Marquee({
  children = "Developer * Web Designer * Musician * Creative * Developer * Web Designer * Musician * Guitarists *",
  className,
}) {
  const container = useRef(null);
  const delta = useRef(0.025);
  const deltaMultiplier = useRef(0);
  const progress = useRef(0);
  const direction = useRef(1);

  useGSAP(() => {
    // Main animation loop
    const loop = () => {
      // Reset progress when reaching end of either direction
      if (progress.current >= 50 || progress.current <= -50)
        progress.current = 0;

      let setter = gsap.quickSetter(container.current, "xPercent");
      setter(progress.current);

      // Increment progress: base speed + scroll-based inertia * direction
      progress.current +=
        (delta.current + deltaMultiplier.current) * direction.current;
      deltaMultiplier.current *= SCROLL_INERTIA_DECAY;
      requestAnimationFrame(loop);
    };
    loop();
  });

  useEffect(() => {
    const updateDirection = () => {
      if (direction.current < 0) {
        // Reverse direction: start container at 0%, progress goes 0 to -50
        gsap.set(container.current, { translateX: "0%" });
        if (progress.current > 0) {
          // Translate forward progress to equivalent reverse position
          progress.current = -50 + progress.current;
        }
      } else {
        // Forward direction: start container at -50%, progress goes 0 to 50
        gsap.set(container.current, { translateX: "-50%" });
        if (progress.current < 0) {
          // Translate reverse progress to equivalent forward position
          progress.current = 50 + progress.current;
        }
      }
    };
    updateDirection();

    // Track scroll velocity and direction for inertia effect
    let lastY = window.scrollY;
    let lastTime = performance.now();
    const onScroll = () => {
      const now = performance.now();
      const y = window.scrollY;
      const pxPerFrame = ((y - lastY) / Math.max(1, now - lastTime)) * 16;
      lastY = y;
      lastTime = now;
      deltaMultiplier.current = Math.abs(pxPerFrame / 20);
      if (pxPerFrame !== 0) direction.current = Math.sign(pxPerFrame);
      updateDirection();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`relative flex w-full items-center overflow-x-clip ${className} `}
    >
      <span
        ref={container}
        className={`marquee__item will-change-transform font-bold tracking-tighter inline-block whitespace-nowrap`}
      >
        {children}
        {children}
      </span>
    </div>
  );
}
