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
  const delta = useRef(1);
  const deltaMultiplier = useRef(0);
  const progress = useRef(0);
  const direction = useRef(1);

  const { contextSafe } = useGSAP(() => {
    const updateDirection = () => {
      if(direction.current < 0){
        gsap.set(container.current, {translateX:'0%'});
        if(progress.current > 0){
            progress.current *= -1;
        }
      }
      else{
        gsap.set(container.current, {translateX:'-50%'});
        if(progress.current < 0){
            progress.current *= -1;
        }
      }
    };
    updateDirection();

    const scrollTrigger = new ScrollTrigger({
      onUpdate: (e) => {
        deltaMultiplier.current = gsap.utils.clamp(
          0,
          1,
          Math.abs(e.getVelocity() / 1000)
        );
        direction.current = e.direction;
        updateDirection();
      },
    });

    const loop = () => {
      if (progress.current >= 50 || progress.current <=-50) progress.current = 0;
      gsap.set(container.current, {
        xPercent: progress.current,
      });
      progress.current += (0.1 + deltaMultiplier.current) * direction.current ;
      console.log(progress.current);
      requestAnimationFrame(loop);
    };
    loop();
  });

  return (
    <div className={` ${className} overflow-x-clip relative w-full`}>
      <span
        ref={container}
        className={`marquee__item ${instrumentSerif.className} inline-block whitespace-nowrap text-8xl`}
      >
        {children}
        {children}
      </span>
    </div>
  );
}
