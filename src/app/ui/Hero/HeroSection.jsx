"use client";
import Image from "next/image";
import Marquee from "./Marquee";

import { instrumentSerif } from "@/app/fonts";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef } from "react";
import ScrollTrigger from "gsap/ScrollTrigger";

function ParralaxImage({
  className,
  classNameImage,
  src = "/sound.png",
  alt = "image",
  size = { width: 250, height: 250 },
}) {
  const container = useRef(null);

  const { contextSafe } = useGSAP(
    () => {
      gsap.to(".parralax", {
        y: -30,
        scrollTrigger: {
          scrub: 1.5,
          start: "top top",
        },
      });
    },
    { scope: container.current },
  );
  return (
    <div ref={container} className={` ${className}`}>
      <Image
        className="parralax w-full object-center"
        width={size.width}
        height={size.height}
        src={src}
        alt={alt}
      ></Image>
    </div>
  );
}

function HeroTextTop({ children, className }) {
  const container = useRef();
  const tl = useRef(null);
  const tl2 = useRef(null);

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({});
      tl2.current = gsap.timeline({ paused: true });

      //   height ani
      tl.current.set(".split__item--height", {
        height: 0,
      });

      tl.current.to(
        ".split__item--height",
        {
          height: "auto",
          ease: "power4.out",
        },
        "one",
      );

      //   width
      tl2.current.set(".split__item--width", {
        width: 0,
      });

      tl2.current
        .to(
          ".split__item--width",
          {
            width: "auto",
            ease: "power4.out",
            duration: 0.5,
          },
          "one",
        )
        .to(
          ".split__item--width",
          {
            width: 0,
            ease: "power4.out",
          },
          "two",
        );
    },
    { scope: container.current },
  );

  const hoverEnter = contextSafe(() => {
    tl2.current.tweenFromTo("one", "two");
  });
  const hoverExit = contextSafe(() => {
    tl2.current.tweenFromTo("two", "end");
  });

  return (
    <div
      ref={container}
      className={` ${instrumentSerif.className} tracking-heading-mobile lg:tracking-heading flex flex-col items-center justify-center tet-[64px] text-6xl leading-tight md:flex-row md:gap-2 md:pb-6 lg:gap-4 lg:text-8xl ${className}`}
      onMouseEnter={hoverEnter}
      onMouseLeave={hoverExit}
    >
      <span className="">I Am Herbart</span>
      <span className="grid grid-cols-4 overflow-hidden md:inline-block">
        <ParralaxImage
          src="/2.png"
          className="split__item--height col-span-2 col-start-2 h-0 max-h-24 overflow-hidden rounded-3xl object-cover md:hidden"
        ></ParralaxImage>
        <ParralaxImage
          src="/2.png"
          className="split__item--width asect-[140/125] hidden max-h-20 w-0 max-w-30 overflow-hidden rounded-3xl object-cover md:block lg:max-h-26 lg:max-w-36"
          classNameImage={``}
        ></ParralaxImage>
      </span>
      <span className="">Hernandez, A</span>
    </div>
  );
}

function HeroTextBottom({ children, className }) {
  const container = useRef();
  const tl = useRef(null);
  const tl2 = useRef(null);

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({});
      tl2.current = gsap.timeline({ paused: true });

      tl.current.set(".split__item--height", {
        height: 0,
      });

      tl.current.to(
        ".split__item--height",
        {
          height: "auto",
          ease: "power4.out",
        },
        "one",
      );
      //   width
      tl2.current.set(".split__item--width-b", {
        width: 0,
      });

      tl2.current
        .to(
          ".split__item--width-b",
          {
            width: "auto",
            ease: "power4.out",
            duration: 0.5,
          },
          "one",
        )
        .to(
          ".split__item--width-b",
          {
            width: 0,
            ease: "power4.out",
          },
          "two",
        );
    },
    { scope: container.current },
  );

  const hoverEnter = contextSafe(() => {
    tl2.current.tweenFromTo("one", "two");
  });
  const hoverExit = contextSafe(() => {
    tl2.current.tweenFromTo("two", "end");
  });

  return (
    <div
      ref={container}
      className={` ${instrumentSerif.className} tracking-heading-mobile lg:tracking-heading flex flex-col items-center justify-center  text-6xl leading-tight md:flex-row md:gap-2 md:pt-6 lg:gap-4 lg:text-8xl ${className}`}
      onMouseEnter={hoverEnter}
      onMouseLeave={hoverExit}
    >
      <span className="md:hidden">Open For</span>
      <span className="hidden md:inline-block">Open</span>
      <span className="grid grid-cols-4 overflow-hidden md:inline-block">
        <ParralaxImage
          src="/1.png"
          className="split__item--height col-span-2 col-start-2 h-0 max-h-24 overflow-hidden rounded-3xl object-cover md:hidden"
        ></ParralaxImage>
        <ParralaxImage
          src="/1.png"
          className="split__item--width-b w-0 asect-[140/125] hidden max-h-20 max-w-30 overflow-hidden rounded-3xl object-cover md:block lg:max-h-26 lg:max-w-36"
          classNameImage={``}
        ></ParralaxImage>
      </span>
      <span className="hidden md:inline-block">For</span>
      <span className="grid grid-cols-4 overflow-hidden md:inline-block">
        <ParralaxImage
          src="/light2.jpeg"
          className="split__item--width-b w-0 asect-[140/125] hidden max-h-20  max-w-30 overflow-hidden rounded-3xl object-cover md:block lg:max-h-26 lg:max-w-36"
          classNameImage={` saturate-150`}
        ></ParralaxImage>
      </span>
      <span className="">Work</span>
    </div>
  );
}

export default function HeroSection({ children }) {
  return (
    <section className="flex min-h-svh w-full flex-col items-center justify-center gap-4">
      <div className="relative min-h-fit w-full">
        <HeroTextTop className={`absolute bottom-full w-full`}></HeroTextTop>
        <Marquee
          className={`bg-dark text-light tracking-heading-mobile md:tracking-heading h-fit py-2 text-8xl md:py-3 md:text-9xl`}
        ></Marquee>
        <HeroTextBottom className={`absolute top-full w-full`}></HeroTextBottom>
      </div>
    </section>
  );
}
