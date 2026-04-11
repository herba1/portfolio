"use client";
import Link from "next/link";
import posthog from "posthog-js";

export default function LinkMask({
  href = "#",
  text = "Hello World",
  className = "",
  textClassName = "",
}) {
  const isInternal = href.startsWith("/");
  const Component = isInternal ? Link : "a";

  return (
    <Component
      href={href}
      className={`LinkMask relative inline-block ${className}`}
      onClick={() => {
        if (isInternal) {
          document.documentElement.classList.add("navigating");
          setTimeout(() => document.documentElement.classList.remove("navigating"), 600);
        }
        posthog.capture("link_clicked", { href, text });
      }}
      {...(!isInternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className={`LinkMask__text ${textClassName}`}>{text}</span>
    </Component>
  );
}
