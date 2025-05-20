"use client";
import { useRef } from "react";
import { ChevronDown } from "lucide-react";
import LinkMask from "../LinkMask";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

export default function NavDropdownLink({ name, link, links }) {
  const container = useRef();
  const tl = useRef();
  const tlChev = useRef();

  const { contextSafe } = useGSAP(
    () => {
      tl.current = gsap.timeline({ paused: true });
      tlChev.current = gsap.timeline({ paused: true });

      gsap.set(".link__dropdown__container", {
        clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)",
        opacity: 0,
      });

      tl.current.to(
        ".link__dropdown__container",
        {
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
          opacity: 1,
        },
        "in"
      );

      tl.current.to(
        ".chevron__button",
        {
          ease: "power1.inOut",
          rotate: -180,
        },
        "in"
      );
    },
    { scope: container }
  );

  const toggleDropdown = contextSafe(() => {
    // Check the progress of the timeline to determine if it's open or closed
    if (tl.current.progress() > 0 && !tl.current.reversed()) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  const closeDropdown = contextSafe(() => {
    tl.current.timeScale(2.5).reverse();
    tlChev.current.reverse();
  });
  const openDropdown = contextSafe(() => {
    tl.current.play();
    tlChev.current.play();
  });

  const dropdownLinks = links.map((link) => {
    return (
      <li key={link.name} className="flex flex-col items-stretch">
        <LinkMask text={link.name} href={`${link.link}`}></LinkMask>
      </li>
    );
  });

  return (
    <li>
      <div
        onMouseLeave={toggleDropdown}
        onMouseEnter={toggleDropdown}
        ref={container}
        className="nav__link__dropdown flex justify-center relative min-w-fit  w-full"
      >
        <div className="flex items-center">
          <LinkMask
            text={name}
            className="flex justify-center items-center"
            href={link}
          ></LinkMask>
          <button
            onClick={toggleDropdown}
            type="button"
            className=" cursor-pointer"
          >
            <ChevronDown
              aria-label="toggle dropdown menu"
              className={`chevron__button`}
            ></ChevronDown>
          </button>
        </div>
        <div
          className={` opacity-0 overflow-hidden path link__dropdown__container min-w-[150%] top-full absolute pt-3   `}
        >
          <ul
            className={`bg-neutral-50 border-1 border-neutral-100  text-black flex flex-col gap-2   text-left p-3 rounded-md min-w-fit w-full  `}
          >
            {dropdownLinks}
          </ul>
        </div>
      </div>
    </li>
  );
}