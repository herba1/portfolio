"use client";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import ScrollTrigger from "gsap/ScrollTrigger";

const sizes = {
  0: 1,
  1: 10,
  2: 20,
  3: 20,
  4: 30,
  5: 1000,
};

export default function ImagePixel() {
  const [index, setIndex] = useState(0);
  const [trigger, setTrigger] = useState(0);
  const ref = useRef();

  useEffect(() => {
    if (trigger === 0) return;
    if (index >= Object.keys(sizes).length - 1) return;
    const id = setTimeout(() => setIndex((prev) => prev + 1), 120);
    return () => clearTimeout(id);
  }, [index, trigger]);

  const triggerEffect = () => {
    setIndex(0);
    setTrigger(trigger + 1);
  };

  useGSAP(() => {
    ScrollTrigger.create({
      trigger: ref.current,
      markers: true,
      start: "top 60%",
      end: "top 60%",
      once: true,
      onEnter: () => {
        triggerEffect();
      },
    });
  });

  return (
    <div className="inline-block w-64 h-64  ">
      <Image
        ref={ref}
        src={"/img.png"}
        width={sizes[index]}
        height={sizes[index]}
        quality={100}
        alt="image"
        className="object-cover w-full h-full  "
        style={{ imageRendering: "pixelated" }}
        onMouseEnter={triggerEffect}
      ></Image>
    </div>
  );
}
