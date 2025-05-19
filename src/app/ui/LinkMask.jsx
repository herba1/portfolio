
"use client";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

gsap.registerPlugin(SplitText);

export default function LinkMask({ href= "#", text = "Hello World",className="",textClassName="",children }) {
  const container = useRef();
  const tl = useRef(null);

  const { contextSafe } = useGSAP(
    () => {
      const split1 = SplitText.create(".LinkMask__text", {
        type: "chars,lines",
      });
      const split2 = SplitText.create(".LinkMask__text--second", {
        type: "chars,lines",
      });
      tl.current = gsap.timeline({ paused: true });

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
    },
    { scope: container, dependencies: null }
  );


  const onEnter = contextSafe((e) => {
    tl.current.play();
  });

  const onLeave = contextSafe(() => {
    setTimeout(() => {
      tl.current.reverse();
    }, 200);
  });

  return (
    <div
      ref={container}
      onMouseOver={onEnter}
      onMouseLeave={onLeave}
      className={`LinkMask__container inline-block overflow-clip relative ${className}`}
    >
      <Link href={href} className="w-full h-full left-0 right-0 absolute z-10"></Link>
      <p className={`LinkMask__text ${textClassName}`}>{text}</p>
      <p className={`LinkMask__text--second absolute ${textClassName}`}>{text}</p>
    </div>
  );
}

