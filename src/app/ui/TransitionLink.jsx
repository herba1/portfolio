"use client";

import Link from "next/link";

export default function TransitionLink({ href, className, children, onClick, ...props }) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        document.documentElement.classList.add("navigating");
        setTimeout(() => document.documentElement.classList.remove("navigating"), 600);
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
