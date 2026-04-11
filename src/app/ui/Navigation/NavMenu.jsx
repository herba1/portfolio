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
      // Don't close if clicking the menu button itself (it handles its own toggle)
      if (e.target.closest(".nav__button--open")) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuIsOpen(false);
      }
    }
    // Use timeout so this doesn't fire on the same click that opened the menu
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", handleClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", handleClick);
    };
  }, [menuIsOpen, setMenuIsOpen]);

  return (
    <div
      ref={menuRef}
      className={`sm:hidden fixed top-12 right-4 z-50 ${
        menuIsOpen
          ? "opacity-100 scale-100 translate-y-0"
          : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
      }`}
      style={{
        transformOrigin: "top right",
        transitionProperty: "opacity, transform",
        transitionDuration: menuIsOpen ? "0.25s" : "0.15s",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <nav
        className={`flex flex-col rounded-xl overflow-hidden ${geist.className}`}
        style={{
          background: "rgba(255, 255, 255, 0.8)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04), inset 0 0 0 0.5px rgba(0,0,0,0.06)",
          minWidth: "160px",
        }}
      >
        {LINKS.map((link, i) => {
          const isInternal = link.link.startsWith("/");
          const Component = isInternal ? Link : "a";
          return (
            <Component
              key={link.name}
              href={link.link}
              onClick={() => {
                if (isInternal) {
                  document.documentElement.classList.add("navigating");
                  setTimeout(
                    () => document.documentElement.classList.remove("navigating"),
                    600
                  );
                }
                posthog.capture("nav_link_clicked", {
                  link: link.name.toLowerCase(),
                });
                setMenuIsOpen(false);
              }}
              className="nav-menu-link text-dark/70 hover:text-dark hover:bg-black/[0.03] active:bg-black/[0.06] tracking-body-base text-[13px]"
              style={{
                padding: "12px 20px",
                display: "block",
                opacity: menuIsOpen ? 1 : 0,
                transform: menuIsOpen ? "translateY(0)" : "translateY(-4px)",
                transitionProperty: menuIsOpen
                  ? "opacity, transform, background-color, color"
                  : "none",
                transitionDuration: "0.25s, 0.25s, 0.15s, 0.15s",
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                transitionDelay: `${i * 30}ms`,
                borderBottom:
                  i < LINKS.length - 1
                    ? "0.5px solid rgba(0,0,0,0.06)"
                    : "none",
              }}
              {...(!isInternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {link.name}
            </Component>
          );
        })}
      </nav>
    </div>
  );
}
