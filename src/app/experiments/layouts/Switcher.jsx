"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const OPTIONS = [
  { href: "/experiments/layouts/bento", label: "Bento" },
  { href: "/experiments/layouts/sheet", label: "Sheet" },
];

export default function Switcher() {
  const pathname = usePathname();
  return (
    <nav className="xl-switcher text-ui-lg" aria-label="Layout options">
      {OPTIONS.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          className="xl-switcher__item"
          data-on={pathname === option.href}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
