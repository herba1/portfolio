"use client";
const LINKS = [
  //   { name: "Work", link: "#portfolio" },
  //   { name: "Experiments", link: "https://x.com/herb_dev" },
  { name: "LinkedIn", link: "https://linkedin.com/in/herbart-hernandez" },
  { name: "X/Twitter", link: "https://x.com/herb_dev" },
  { name: "Github", link: "https://github.com/herba1" },
  { name: "Email", link: "mailto:herbart.dev@gmail.com" },
];
import { spencer, lastik, spencerOutlined } from "@/app/fonts";
import { cn } from "@/lib/utils";
import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { useRef, useEffect, useState } from "react";

gsap.registerPlugin(SplitText);

export default function TempPage() {
  const containerRef = useRef(null);
  const [hoverChar, setHoverChar] = useState("");

  useGSAP(
    (_, contextSafe) => {
      const titleChars = SplitText.create(
        containerRef.current.querySelector(".title"),
        {
          type: "chars, lines",
          charsClass:
            "bg-linear-to-b will-change-auto from-slate-900/50 to-slate-900 bg-clip-text text-transparent",
          linesClass: "transform-3d perspective-[600px] ",
          propIndex: true,
        },
      );

      const company = containerRef.current.querySelector(".company");

      const companyHoverEvent = new Event("mouseenter");

      const desc = SplitText.create(
        containerRef.current.querySelector(".desc"),
        {
          type: "chars, lines, words",
          charsClass: "transform-auto",
        },
      );

      const onCompanyHover = contextSafe(() => {
        gsap.to(desc.chars, {
          color: "red",
          stagger: 0.02,
          ease: "power4.out",
          duration: 0.5,
        });
        gsap.to(desc.chars, {
          color: "purple",
          delay: 0.3,
          stagger: 0.02,
          ease: "power4.out",
          duration: 0.5,
        });
        gsap.to(desc.chars, {
          delay: 0.6,
          stagger: 0.02,
          color: "#0f172b",
          ease: "power4.out",
          duration: 0.5,
        });
      });

      company.addEventListener("mouseenter", onCompanyHover);

      gsap.set(containerRef.current, {
        visibility: "visible",
      });

      // intro sequence
      gsap
        .timeline({ delay: 0.4 })
        .from(titleChars.chars, {
          opacity: 0,
          duration: 1,
          rotateX: -65,
          yPercent: 100,
          stagger: {
            amount: 0.3,
            from: "start",
          },
          ease: "power4.out",
        },"start")
        .from(".links", {
          delay: 0.3,
          stagger: 0.05,
          opacity: 0,
          yPercent: 100,
          duration: 0.8,
          ease: "power4.out",
        },"start")
        .from(desc.lines, {
          opacity: 0,
          delay: 0.6,
          duration: 1,
          yPercent: 100,
          onStart: () => {
            company.dispatchEvent(companyHoverEvent);
          },
          stagger: {
            amount: 0.3,
            from: "start",
          },
          ease: "power4.out",
        },"start");

      // hero interaction
      const charHandlers = [];

      titleChars.chars.forEach((char) => {
        const onCharEnter = contextSafe(() => {
          setHoverChar(char.textContent);
          gsap.to(char, {
            paddingLeft: "0.15em",
            paddingRight: "0.15em",
            scale: 1.3,
            rotate: gsap.utils.random(-15, 15),
            duration: 0.5,
            ease: "power4.out",
          });
        });

        const onCharLeave = contextSafe(() => {
          setHoverChar("");
          gsap.to(char, {
            paddingLeft: "0em",
            paddingRight: "0em",
            scale: 1,
            rotate: 0,
            duration: 0.5,
            ease: "power4.out",
          });
        });

        char.addEventListener("mouseenter", onCharEnter);
        char.addEventListener("mouseleave", onCharLeave);

        charHandlers.push({ char, onCharEnter, onCharLeave });
      });

      return () => {
        company.removeEventListener("mouseenter", onCompanyHover);
        charHandlers.forEach(({ char, onCharEnter, onCharLeave }) => {
          char.removeEventListener("mouseenter", onCharEnter);
          char.removeEventListener("mouseleave", onCharLeave);
        });
      };
    },
    { scope: containerRef, dependencies: [] },
  );

  return (
    <article
      ref={containerRef}
      className="invisible relative mx-auto flex h-full min-h-fit w-full flex-col items-center justify-center text-slate-900 selection:bg-black selection:text-white"
    >
      {/* <p
        className={`pointer-events-none text-white absolute top-1/2 left-1/2 z-10 -translate-1/2 text-[70vw] opacity-10 mix-blend-difference ${lastik.className}`}
      >
        {hoverChar}
      </p> */}
      <p className="desc tracking-body-base text-sm text-[#0f172b] opacity-60 md:text-base">
        Temporary Portfolio{" "}
        <a href="#" className="group company">
          2026
        </a>
      </p>
      <h1
        className={`title mt-4 bg-linear-to-b from-slate-900/50 to-slate-900 bg-clip-text text-6xl text-[15vw] tracking-normal text-transparent will-change-transform select-none text-shadow-sm md:text-8xl ${spencer.className}`}
      >
        Herbart Hernandez
      </h1>
      <ul className="mt-2 flex w-full flex-row flex-wrap items-center justify-center gap-4 px-4 md:mt-4">
        {LINKS.map((link, index) => (
          <li key={index} className="links hidden md:inline-block">
            <a
              href={link.link}
              className={cn(
                "bg-linear-to-b from-blue-400 to-blue-500 text-white",
                "border border-white/30 shadow-md inset-shadow-sm shadow-blue-500/30 inset-shadow-white/50",
                "squircle inline-block min-w-28 rounded-xl px-6 py-2 will-change-transform",
                "tracking-body-base text-center text-base font-medium",
                "ease-out-quart transition-transform duration-200 hover:scale-105 active:scale-95",
              )}
            >
              {link.name}
            </a>
          </li>
        ))}
        {LINKS.map((link, index) => (
          <li key={index} className="links md:hidden">
            <a
              href={link.link}
              className={cn(
                "tracking-body-base text-center text-base font-medium",
                "text-slate-900/50",
              )}
            >
              {link.name}
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
