"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { useEffect, useRef, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Defer PostHog init to idle — don't compete with hero paint
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NODE_ENV === "production") {
  const initPostHog = () => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      persistence: "memory",
    });
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(initPostHog);
  } else {
    setTimeout(initPostHog, 1);
  }
}

function PostHogScrollDepth() {
  const posthogClient = usePostHog();
  const firedRef = useRef(false);
  const pathname = usePathname();

  useEffect(() => {
    firedRef.current = false;
  }, [pathname]);

  useEffect(() => {
    if (!posthogClient) return;
    // scrollY and scrollHeight are layout-forcing reads, and this runs on
    // every page — reading them per scroll event thrashes layout on any
    // page that writes styles while scrolling (the deck reflowed all 50
    // cards per event). One read per frame, via rAF, costs nothing.
    let raf = 0;
    const measure = () => {
      raf = 0;
      if (firedRef.current) return;
      const scrolled = window.scrollY + window.innerHeight;
      const total = document.documentElement.scrollHeight;
      if (scrolled / total > 0.9) {
        firedRef.current = true;
        posthogClient.capture("page_bottom_reached", { path: window.location.pathname });
      }
    };
    const handler = () => {
      if (firedRef.current || raf) return;
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("scroll", handler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [posthogClient, pathname]);

  return null;
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthogClient = usePostHog();

  useEffect(() => {
    if (pathname && posthogClient) {
      let url = window.origin + pathname;
      if (searchParams.toString()) {
        url += "?" + searchParams.toString();
      }
      posthogClient.capture("$pageview", { $current_url: url });
    }
  }, [pathname, searchParams, posthogClient]);

  return null;
}

export default function PostHogProvider({ children }) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return children;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
        <PostHogScrollDepth />
      </Suspense>
      {children}
    </PHProvider>
  );
}
