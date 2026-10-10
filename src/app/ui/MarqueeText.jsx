"use client";

import { useLayoutEffect, useRef, useState } from "react";
import "./MarqueeText.css";

const PIXELS_PER_SECOND = 32;
const REST_SECONDS = 1.6;
const OVERFLOW_TOLERANCE_PX = 1;
const TRAVEL_SHARE = 0.3;
const REST_SHARE = 0.2;

export default function MarqueeText({ children, className = "", as: Tag = "span" }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const hidden = inner.scrollWidth - outer.clientWidth;
      setOverflow(hidden > OVERFLOW_TOLERANCE_PX ? Math.ceil(hidden) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [children]);

  const travelSeconds = overflow / PIXELS_PER_SECOND;
  const cycleSeconds = Math.max(travelSeconds / TRAVEL_SHARE, REST_SECONDS / REST_SHARE);

  return (
    <Tag
      ref={outerRef}
      className={`marquee-text${className ? ` ${className}` : ""}`}
      data-overflow={overflow ? "" : undefined}
      style={overflow ? { "--marquee-shift": `${-overflow}px`, "--marquee-cycle": `${cycleSeconds}s` } : undefined}
      title={typeof children === "string" && overflow ? children : undefined}
    >
      <span ref={innerRef} key={typeof children === "string" ? children : undefined} className="marquee-text-inner">
        {children}
      </span>
    </Tag>
  );
}
