"use client";

import TransitionLink from "@/app/ui/transitions/TransitionLink";
import { armReturn } from "./returnTrip";

// `scroll={false}`: Next's scroll-to-top runs after the index's own layout
// effect and would undo the rail position the index restores.
export default function BackToIndex({ slug, className, children }) {
  return (
    <TransitionLink back href="/splats" scroll={false} className={className} onClick={() => armReturn(slug)}>
      {children}
    </TransitionLink>
  );
}
