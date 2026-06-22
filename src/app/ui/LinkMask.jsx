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
        posthog.capture("link_clicked", { href, text });
      }}
      {...(!isInternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className={`LinkMask__text ${textClassName}`}>{text}</span>
    </Component>
  );
}
