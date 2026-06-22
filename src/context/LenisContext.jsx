// src/context/LenisContext.jsx
"use client";
import { createContext, useContext, useEffect, useState, useRef } from "react";
import "../app/globals.css"
import 'lenis/dist/lenis.css'

const LenisContext = createContext({
  lenis: null,
  scrollTrigger: null,
});

export function LenisProvider({ children }) {
  const [lenis, setLenis] = useState(null);
  // Exposed so consumers (e.g. the mobile menu) can freeze/resync scroll-driven
  // animations while the page is locked. Stored as a function to keep React's
  // setState from treating the class as an updater.
  const [scrollTrigger, setScrollTrigger] = useState(null);

  useEffect(() => {
    // Defer until after view transitions settle (~600ms)
    const delayId = setTimeout(() => {
    Promise.all([
      import("lenis"),
      import("gsap"),
      import("gsap/ScrollTrigger"),
      import("gsap/SplitText"),
    ]).then(([LenisMod, gsapMod, ScrollTriggerMod, SplitTextMod]) => {
      const Lenis = LenisMod.default;
      const gsap = gsapMod.gsap;
      const ScrollTrigger = ScrollTriggerMod.ScrollTrigger;
      const SplitText = SplitTextMod.SplitText;

      gsap.registerPlugin(ScrollTrigger, SplitText);

      const lenisInstance = new Lenis({
        direction: 'vertical',
        smooth: true,
        smoothTouch: false,
        autoResize: true,
        syncTouch: false,
        infinite: false,
      });

      setLenis(lenisInstance);
      setScrollTrigger(() => ScrollTrigger);

      lenisInstance.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => {
        lenisInstance.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);
    });
    }, 500); // Defer until after LCP — let first paint settle

    return () => {
      clearTimeout(delayId);
      setLenis((prev) => {
        prev?.destroy();
        return null;
      });
    };
  }, []);

  return (
    <LenisContext.Provider value={{ lenis, scrollTrigger }}>
      {children}
    </LenisContext.Provider>
  );
}

export const useLenis = () => {
  return useContext(LenisContext);
};
