'use client'
import { useEffect, useRef,  } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useLenis } from "@/context/LenisContext";


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
      tl.current = gsap.timeline({ paused: true });
      gsap.set(".nav__menu", {
        clipPath: "polygon(100% 0%,100% 0% , 100% 0%, 100% 0%)",
      });
      gsap.set(container.current, {
        opacity: 0,
        pointerEvents: "none",
      });

      tl.current
        .to(
          container.current,
          {
            opacity: 1,
            pointerEvents: "all",
          },
          "start"
        )
        .to(
          ".nav__menu",
          {
            ease:'power4.out',
            clipPath: "polygon(0% 0%,100% 0% , 100% 100%, 0% 100%)",
            opacity: 1,
          },
          "start"
        );
    },
    { scope: container }
  );

  const openMenu = contextSafe(() => {
    tl.current.play();
  });
  const closeMenu = contextSafe(() => {
    tl.current.timeScale(2).reverse();
  });

  return (
    <menu
      ref={container}
      className={` z-10 opacity-0 cursor-not-allowed nav__menu__container fixed left-0 top-0 w-full  h-svh bg-black/40 grid  lg:grid-cols-2 sm:p-3 lg:p-5 sm:justify-end sm:items-end`}
    >
      <div
        ref={menu}
        className=" rounded-sm nav__menu opacity-0 cursor-default bg-pink-300 h-full w-full lg:col-start-2 lg:w-auto sm:w-[450px]"
      >
        <div
          className={`nav__menu__top h-16 flex items-center justify-between`}
        >
          <Link
            href={"#"}
            className=" pl-5 nav__logo font-extrabold text-2xl transform-3d   "
          >
            herb.
          </Link>
          <button
            type="button"
            className=" active:rotate-0 active:scale-95 hover:rotate-8 hover:scale-105 transition-all"
          >
            <X
              onClick={() => {
                setMenuIsOpen(false);
              }}
              size={48}
              strokeWidth={1}
              className="text-white "
            ></X>
          </button>
        </div>
        <div className={`nav__menu__content h-full p-5`}></div>
      </div>
    </menu>
  );
}