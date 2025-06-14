"use client";
import { useGSAP } from "@gsap/react";
import ScrollTrigger from "gsap/ScrollTrigger";
import gsap from "gsap";
import Image from "next/image";
import { useRef } from "react";
import { Averia_Gruesa_Libre } from "next/font/google";

const averia= Averia_Gruesa_Libre({
  subsets: ['latin'],
  weight:['400']
})

export default function PageDistort() {
  const containerRef = useRef();

  const { contextSafe } = useGSAP(() => {
    let tl = gsap.timeline({
    })

    gsap.set('.distort--bottom',{scaleY:0});

    gsap.to('.distort--top',{
        scaleY:'0',
        ease:'linear',
        scrollTrigger:{
            trigger:'.distort--top',
            markers:false,
            start:'bottom bottom',
            end:'bottom top',
            scrub:0,
        }
    })

    gsap.to('.distort--bottom',{
        scaleY:1,
        ease:'linear',
        scrollTrigger:{
            trigger:'.distort--bottom',
            markers:false,
            start:'top bottom',
            end:'bottom top',
            scrub:0,
        }
    })

  }, { scope: containerRef });


  return (
    <div 
      ref={containerRef} 
      className="relative min-h-[200vh] flex flex-col "
    >
        <div className={` distort--top w-full h-svh scale-y-100 z-0 sticky top-0 origin-top bg-white font-serif flex flex-col justify-center items-center text-8xl tracking ${averia.className}`}>
            <h1>Dont Worry Baby</h1>
            <h1>Everything </h1>
            <h1>Will Be Alright</h1>
        </div>
        <div className="w-full h-[1000px] distort--center bg-white z-10 ">
            <Image className="object-cover w-full h-full" alt="img"  src={'/sound.png'} width={500} height={500} ></Image>
        </div>
        <div className={` distort--bottom w-full h-svh  z-0  origin-top bg-white font-serif flex flex-col justify-center items-center text-8xl  ${averia.className}`}>
            <h1>Barbara Ann</h1>
            <h1>Take my Hand</h1>
            <h1>You got me Rockin</h1>
        </div>
    </div>
  );
}
