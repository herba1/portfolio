"use client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import ScrollTrigger from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import { instrumentSerif } from "@/app/fonts";

export default function Marquee({
  children = "Developer*Web Designer*Musician*Creative*",
  className,
}) {
  const container = useRef(null);
  const delta = useRef(0.025);
  const deltaMultiplier = useRef(0);
  const progress = useRef(0);
  const direction = useRef(1);

  const { contextSafe } = useGSAP(() => {
    // Handle direction changes and maintain visual continuity
    const updateDirection = () => {
      if(direction.current < 0){
        // Reverse direction: start container at 0%, progress goes 0 to -50
        gsap.set(container.current, {translateX:'0%'});
        if(progress.current > 0){
            // Translate forward progress to equivalent reverse position
            progress.current = -50 + progress.current;
        }
      }
      else{
        // Forward direction: start container at -50%, progress goes 0 to 50
        gsap.set(container.current, {translateX:'-50%'});
        if(progress.current < 0){
            // Translate reverse progress to equivalent forward position
            progress.current = 50 + progress.current;
        }
      }
    };
    updateDirection();

    // Track scroll velocity and direction for inertia effect
    const scrollTrigger = new ScrollTrigger({
      onUpdate: (e) => {
        // Convert scroll velocity to speed multiplier (0-1 range)
        deltaMultiplier.current = gsap.utils.clamp(
          0,
          0.4,
          Math.abs(e.getVelocity() / 5000)
        );
        // Update scroll direction and recalculate container position
        direction.current = e.direction;
        updateDirection();
      },
    });

    // Main animation loop
    const loop = () => {
      // Reset progress when reaching end of either direction
      if (progress.current >= 50 || progress.current <=-50) progress.current = 0;
      
      // Apply current progress as transform
      gsap.set(container.current, {
        xPercent: progress.current,
      });
      
      // Increment progress: base speed + scroll-based inertia * direction
      progress.current += (delta.current + deltaMultiplier.current) * direction.current ;
      requestAnimationFrame(loop);
    };
    loop();
  });

  return (
    <div className={`overflow-x-clip relative w-full flex items-center ${className} `}>
      <span
        ref={container}
        className={`marquee__item ${instrumentSerif.className} inline-block whitespace-nowrap `}
      >
        {children}
        {children}
      </span>
    </div>
  );
}
