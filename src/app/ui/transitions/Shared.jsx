"use client";

import { ViewTransition } from "react";
import { flyAlongArc } from "./arc";

const onlyFor = (types, className) => ({
  ...Object.fromEntries([types].flat().map((type) => [type, className])),
  default: "none",
});

export default function Shared({ name, morph = "solid", arc = 0, on, className = "", children }) {
  const morphClass = [`morph-${morph}`, className].filter(Boolean).join(" ");
  const share = on ? onlyFor(on, morphClass) : morphClass;
  const onShare = arc ? (instance) => flyAlongArc(instance, arc) : undefined;

  return (
    <ViewTransition name={name} share={share} default="none" onShare={onShare}>
      {children}
    </ViewTransition>
  );
}
