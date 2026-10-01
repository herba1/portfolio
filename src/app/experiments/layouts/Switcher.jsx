"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const OPTIONS = [
  { href: "/experiments/layouts/bento", label: "Bento" },
  { href: "/experiments/layouts/sheet", label: "Sheet" },
  { href: "/experiments/layouts/board", label: "Board" },
  { href: "/experiments/layouts/timeline", label: "Timeline" },
];

export default function Switcher() {
  const pathname = usePathname();
  return (
    <nav className="xl-switcher text-ui-lg" aria-label="Layout options">
      {OPTIONS.map((option, i) => (
        <Link
          key={option.href}
          href={option.href}
          className="xl-switcher__item"
          data-on={pathname === option.href}
        >
          <span className="tabular-nums">{String.fromCharCode(65 + i)}</span>
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
