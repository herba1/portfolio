"use client";
import { useRouter } from "next/navigation";

// Prefetch a route when a visitor shows they might go there — pointer over
// it, a finger down on it, keyboard focus — rather than whenever the link is
// on screen. A viewport prefetch pulls the route's whole client bundle in
// with it: the nav's /covers link alone brought three, react-three-fiber and
// leva (about 1.2MB) down on every page load, racing the page's own work.
export default function useIntentPrefetch(href) {
  const router = useRouter();
  const prefetch = () => {
    if (href?.startsWith("/")) router.prefetch(href);
  };
  return { onPointerEnter: prefetch, onTouchStart: prefetch, onFocus: prefetch };
}
