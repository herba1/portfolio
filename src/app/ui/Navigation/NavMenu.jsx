"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
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
      // lenis.stop();
    } else if (!menuIsOpen && lenis) {
      closeMenu();
      // lenis.start();
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
          "start",
        )
        .to(
          ".nav__menu",
          {
            ease: "power4.out",
            clipPath: "circle(150% at 95% 5%)",
            opacity: 1,
            duration: 1.2,
          },
          "start",
        )
        .to(
          splits.chars,
          {
            yPercent: 0,
            stagger: 0.015,
            ease: "power3.out",
            duration: 0.8,
          },
          "-=1.1",
        );
    },
    { scope: container },
  );

  const openMenu = contextSafe(() => {
    tl.current.timeScale(1).play();
  });
  const closeMenu = contextSafe(() => {
    if (tl.current.progress()) {
      tl.current.timeScale(1.5).reverse();
    } else {
      tl.current.timeScale(1.5).reverse().progress(1);
    }
  });

  return (
    <menu
      ref={container}
      className={`nav__menu__container fixed top-0 left-0 z-10 grid h-lvh w-full cursor-not-allowed bg-transparent opacity-0 sm:items-end sm:justify-end lg:grid-cols-2`}
    >
      <div
        ref={menu}
        className="nav__menu bg-dark text-light flex h-full cursor-default flex-col justify-between opacity-100 sm:w-[450px] lg:col-start-2 lg:w-auto"
      >
        <div className={`nav__menu__top flex items-center justify-between p-4`}>
          <Link
            href={"/"}
            className={`nav__logo tracking-body-base font-medium ${inter.className}`}
          >
            Herbart Hernandez
          </Link>
          <button
            type="button"
            className="tracking-body-base cursor-pointer touch-manipulation font-medium transition-all active:scale-90"
            onClick={() => {
              setMenuIsOpen(false);
            }}
          >
            Close
          </button>
        </div>
        <div
          className={`nav__menu__content flex grow flex-col justify-end gap-8 px-4 pb-4`}
        >
          <ul
            className={`${instrumentSerif.className} tracking-heading-mobile flex flex-col gap-4 text-8xl`}
          >
            <li>
              <a
                onClick={(e) => {
                  e.preventDefault();
                  setMenuIsOpen(false);
                  lenis.scrollTo("#portfolio",{offset:-80});
                }}
                className={`nav__menu__link`}
                href={"#portfolio"}
              >
                Portfolio
              </a>
            </li>
            <li>
              <a
                className={`nav__menu__link`}
                href={"mailto:herbart.dev@gmail.com"}
              >
                Contact
              </a>
            </li>
            <li className="">
              <a target="_blank" rel="noopener" className={`nav__menu__link relative `} href={"https://www.youtube.com/watch?v=PJP1mXFehww"}>
                Secret
                <ExternalLink className="absolute left-full top-0 z-10"></ExternalLink>
              </a>
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
