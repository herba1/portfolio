"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { geist } from "@/app/fonts";
import { LINKS } from "./LINKS";
import posthog from "posthog-js";

export default function NavMenu({ menuIsOpen, setMenuIsOpen }) {
  const menuRef = useRef();

  useEffect(() => {
    if (!menuIsOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [menuIsOpen, setMenuIsOpen]);

  return (
    <div
      ref={menuRef}
      className={`sm:hidden fixed top-12 right-4 z-50 transition-all duration-200 ease-out-quart ${
        menuIsOpen
          ? "opacity-100 scale-100 translate-y-0"
          : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
      }`}
    >
      <nav
        className={`flex flex-col items-end gap-1 ${geist.className}`}
      >
        {LINKS.map((link) => {
          const isInternal = link.link.startsWith("/");
          const Component = isInternal ? Link : "a";
          return (
            <Component
              key={link.name}
              href={link.link}
              onClick={() => {
                if (isInternal) {
                  document.documentElement.classList.add("navigating");
                  setTimeout(() => document.documentElement.classList.remove("navigating"), 600);
                }
                posthog.capture("nav_link_clicked", { link: link.name.toLowerCase() });
                setMenuIsOpen(false);
              }}
              className="text-dark/70 hover:text-dark tracking-body-base px-1 py-1 text-sm transition-colors"
              {...(!isInternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.name}
            </Component>
          );
        })}
      </nav>
    </div>
  );
}
