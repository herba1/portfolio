// src/context/LenisContext.jsx
"use client";
import { createContext, useContext, useEffect, useState, useRef } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import "../app/globals.css" 
import 'lenis/dist/lenis.css'

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger,SplitText);

const LenisContext = createContext({
  lenis: null,
});

export function LenisProvider({ children }) {
  const [lenis, setLenis] = useState(null);
  const reqIdRef = useRef(null);

  useEffect(() => {
    const lenisInstance = new Lenis({
      // duration: 1.2,
      // easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      direction: 'vertical',
      smooth: true,
      smoothTouch: false,
      // touchMultiplier: 2,
      autoResize:true,
      syncTouch:false,
      infinite:false,
    });

    setLenis(lenisInstance);

    // Connect Lenis to ScrollTrigger
    lenisInstance.on('scroll', ScrollTrigger.update);

    // Add Lenis raf to GSAP's ticker
    gsap.ticker.add((time) => {
      lenisInstance.raf(time * 1000);
    });

    // Disable lag smoothing in GSAP
    gsap.ticker.lagSmoothing(0);

    return () => {
      lenisInstance.destroy();
      gsap.ticker.remove(lenisInstance.raf);
    };
  }, []);

  return (
    <LenisContext.Provider value={{ lenis }}>
      {children}
    </LenisContext.Provider>
  );
}

export const useLenis = () => {
  return useContext(LenisContext);
};