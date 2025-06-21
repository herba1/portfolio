"use client";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";

import Link from "next/link";

export default function TransitionLink({ href = "/", children }) {
  const router = useRouter();
  const container = useRef(null);
  const tl = useRef(null);
  const pathName = usePathname();

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({ paused: true });
      let tl2 = gsap.timeline();

      tl2.fromTo(
        ".screen--out",
        { opacity: 1, pointerEvents: "auto" },
        { opacity: 0, pointerEvents: "none", ease: "power3.out" }
      );

      tl.current
        .to(".screen--out", {
          opacity: 1,
          ease: "power3.out",
          pointerEvent: "none",
        })
        .to(".screen--out", {
          duration: 0,
          onComplete: pushRouter,
        });
    },
    { scope: container.current }
  );

  const handleClick = contextSafe((e) => {
    e.preventDefault();
    if (href === pathName) return;
    tl.current.play();
    console.log("handleClick");
  });

  const pushRouter = () => {
    // pushing
    router.push(href);
  };

  return (
    <div ref={container} className="inline-block">
      <div
        // style={{ opacity: 0 }}
        className=" screen--out w-full h-lvh absolute top-0 left-0 pointer-events-none bg-white"
      ></div>
      <Link onClick={handleClick} href={href}>
        {children}
      </Link>
    </div>
  );
}
