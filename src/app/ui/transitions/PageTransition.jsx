"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";
import { PAGE_ENTER, PAGE_EXIT } from "./types";
import "./transitions.css";

export default function PageTransition({ children }) {
  const pathname = usePathname();

  return (
    <ViewTransition key={pathname} enter={PAGE_ENTER} exit={PAGE_EXIT} default="none">
      {children}
    </ViewTransition>
  );
}
