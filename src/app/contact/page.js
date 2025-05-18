"use client";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger, SplitText, ScrambleTextPlugin } from "gsap/all";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

gsap.registerPlugin(SplitText);

export default function LinkMask() {
  const container = useRef();

  const { contextSafe } = useGSAP(() => {}, {
    scope: container,
    dependencies: null,
  });

  const onEnter = contextSafe((e) => {});

  const onLeave = contextSafe(() => {});

  return (
    <div
      ref={container}
      className="w-dvw h-dvh flex justify-center items-center"
    >
      <button>Hello !</button>
    </div>
  );
}
