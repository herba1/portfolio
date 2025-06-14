"use client";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef } from "react";

export default function MagnetWrapper() {
  const containerRef = useRef();
  const itemRef = useRef();
  const animationRef = useRef();

  const { contextSafe } = useGSAP(() => {
    // Initial setup
  }, { scope: containerRef });

  const handleMouseMove = contextSafe((e) => {
    if (!itemRef.current) return;

    const rect = itemRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Calculate distance from mouse to element center
    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Magnetic threshold - adjust this value
    const magneticRange = 100;
    
    if (distance < magneticRange) {
      // Calculate magnetic strength (stronger when closer)
      const strength = (magneticRange - distance) / magneticRange;
      
      // Apply magnetic pull (element moves toward mouse)
      const pullX = deltaX * strength * 0.3; // 0.3 is the pull intensity
      const pullY = deltaY * strength * 0.3;
      
      // Kill previous animation
      if (animationRef.current) animationRef.current.kill();
      
      animationRef.current = gsap.to(itemRef.current, {
        x: pullX,
        y: pullY,
        duration: 0.3,
        ease: "power2.out"
      });
    }
  });

  const handleMouseLeave = contextSafe(() => {
    // Return to original position when mouse leaves
    if (animationRef.current) animationRef.current.kill();
    
    animationRef.current = gsap.to(itemRef.current, {
      x: 0,
      y: 0,
      duration: 0.5,
      ease: "elastic.out(1, 0.3)"
    });
  });

  return (
    <div 
      ref={containerRef} 
      className="relative inline-block magnet-wrapper border-2 p-8"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={itemRef} className="item inline-block w-fit h-fit">
        <button className="bg-pink-300 p-4 rounded-md">MAGNETIC BUTTON</button>
      </div>
    </div>
  );
}
