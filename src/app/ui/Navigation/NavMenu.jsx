"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useLenis } from "@/context/LenisContext";
import { instrumentSerif, inter } from "@/app/fonts";
import LinkMask from "../LinkMask";

export default function NavMenu({ menuIsOpen, setMenuIsOpen, children }) {
  const container = useRef();
  const menu = useRef();
  const tl = useRef();
  const { lenis } = useLenis();

  useEffect(() => {
    if (menuIsOpen && lenis) {
      openMenu();
      lenis.stop();
    } else if (!menuIsOpen && lenis) {
      closeMenu();
      lenis.start();
    }

    function handleClickOutside(event) {
      if (menuIsOpen && menu.current && !menu.current.contains(event.target)) {
        setMenuIsOpen(false);
      }
    }

    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [menuIsOpen]);

  const { contextSafe } = useGSAP(
    () => {
      let splits = new SplitText(".nav__menu__link", {
        type: "chars, lines",
        mask: "lines",
      });

      tl.current = gsap.timeline({ paused: true });

      gsap.set(splits.chars, {
        yPercent: 100,
      });
      gsap.set(".nav__menu", {
        clipPath: "circle(0% at 95% 5%)",
      });
      gsap.set(container.current, {
        opacity: 1,
        pointerEvents: "none",
        backdropFilter: "blur(0px)",
      });

      tl.current
        .to(
          container.current,
          {
            // opacity: 1,
            backdropFilter: "blur(5px)",
            pointerEvents: "all",
          },
          "start"
        )
        .to(
          ".nav__menu",
          {
            ease: "power4.out",
            clipPath: "circle(150% at 95% 5%)",
            opacity: 1,
            duration: 1.2,
          },
          "start"
        )
        .to(splits.chars, {
          yPercent: 0,
          stagger:0.015,
          ease: "power3.out",
          duration: 0.8,
        },"-=1.1");
    },
    { scope: container }
  );

  const openMenu = contextSafe(() => {
    tl.current.timeScale(1).play();
  });
  const closeMenu = contextSafe(() => {
    tl.current.timeScale(1.5).reverse().progress(1);
  });

  return (
    <menu
      ref={container}
      className={` z-10 opacity-0 cursor-not-allowed nav__menu__container fixed left-0 top-0 w-full h-lvh   bg-transparent grid  lg:grid-cols-2 sm:justify-end sm:items-end`}
    >
      <div
        ref={menu}
        className=" nav__menu opacity-100 cursor-default bg-dark text-light flex flex-col justify-between  h-full  lg:col-start-2 lg:w-auto sm:w-[450px]"
      >
        <div className={`nav__menu__top p-4 flex items-center justify-between`}>
          <Link
            href={"/"}
            className={`nav__logo font-medium tracking-body-base ${inter.className}`}
          >
            Herbart Hernandez
          </Link>
          <button
            type="button"
            className=" touch-manipulation active:scale-90 font-medium tracking-body-base cursor-pointer  transition-all"
            onClick={() => {
              setMenuIsOpen(false);
            }}
          >
            Close
          </button>
        </div>
        <div
          className={`nav__menu__content gap-8 grow px-4 pb-4 flex flex-col justify-end`}
        >
          <ul
            className={`${instrumentSerif.className} flex flex-col gap-4 tracking-heading-mobile text-8xl `}
          >
            <li>
              <Link className={` nav__menu__link `} href={"#"}>
                Portfolio
              </Link>
            </li>
            <li>
              <Link className={` nav__menu__link `} href={"#"}>
                Contact
              </Link>
            </li>
            <li>
              <Link className={` nav__menu__link `} href={"#"}>
                Secret
              </Link>
            </li>
          </ul>
          <footer className="flex justify-end">
            <span className="nav__menu__link">©herb 2025</span>
          </footer>
        </div>
      </div>
    </menu>
  );
}
