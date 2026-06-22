"use client";

import Link from "next/link";

export default function TransitionLink({ href, className, children, onClick, ...props }) {
  return (
    <Link
      href={href}
      className={className}
      onClick={onClick}
      {...props}
    >
      {children}
    </Link>
  );
}
