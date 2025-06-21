"use client";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

gsap.registerPlugin(SplitText);

export default function LinkMask({
  href = "#",
  text = "Hello World",
  className = "",
  textClassName = "",
  children,
}) {
  const container = useRef();
  const tl = useRef(null);
  const tlUnder = useRef(null);

  const { contextSafe } = useGSAP(
    () => {
      const split1 = SplitText.create(".LinkMask__text", {
        type: "chars,lines",
      });
      const split2 = SplitText.create(".LinkMask__text--second", {
        type: "chars,lines",
      });
      tl.current = gsap.timeline({ paused: true });
      tlUnder.current = gsap.timeline({ paused: true });

      tl.current
        .to(
          split1.chars,
          {
            ease: "power1.inOut",
            duration: 0.4,
            stagger: 0.025,
            yPercent: -100,
          },
          "start"
        )
        .to(
          split2.chars,
          {
            duration: 0.4,
            ease: "power1.inOut",
            stagger: 0.025,
            yPercent: -100,
          },
          "start"
        );
      tlUnder.current
        .to(
          ".LinkMask__underline",
          {
            clipPath: "inset(96% 0% 0% 0%)",
            ease: "power3.out",
            duration: 0.4,
          },
          "start"
        )
        .to(
          ".LinkMask__underline",
          {
            clipPath: "inset(96% 0% 0% 100%)",
            ease: "power3.out",
            duration: 0.4,
          },
          "two"
        );
    },
    { scope: container, dependencies: null }
  );

  const onEnter = contextSafe((e) => {
    tl.current.play();
    tlUnder.current.tweenFromTo(0, "two");
  });

  const onLeave = contextSafe(() => {
    setTimeout(() => {
      tl.current.reverse();
    }, 200);
    tlUnder.current.play();
  });

  return (
    <div
      ref={container}
      onMouseOver={onEnter}
      onMouseLeave={onLeave}
      className={`LinkMask__container inline-block overflow-visible relative ${className}`}
    >
      <Link
        href={href}
        className="w-full h-full left-0 right-0 absolute z-20"
      ></Link>
      <div className="inline-block overflow-clip relative z-10">
        <p className={`LinkMask__text relative ${textClassName}`}>{text}</p>
        <p className={`LinkMask__text--second absolute ${textClassName}`}>
          {text}
        </p>
      </div>
      <p
        className={`w-fit text-transparent absolute LinkMask__underline mix-blend-difference  bg-white top-1 pointer-events-none ${textClassName}`}
        style={{ clipPath: "inset(96% 100% 0% 0%)" }}
      >
        {text}
        <span></span>
      </p>
    </div>
  );
}
