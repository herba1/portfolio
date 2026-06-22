"use client";

import { useEffect, useRef, useState } from "react";
import { createField } from "@/app/intro/engine/field";
import { useFieldLoop } from "@/app/intro/engine/useFieldLoop";
import "./IntroSplash.css";

// The heavy half of the welcome burst — imports the gravity engine + render
// loop, so it's only ever pulled in (lazily, after idle) when IntroSplash
// decides to play. Fires once, paints the emoji crowd, and signals onDone the
// moment every particle has launched and left the screen.
const EMOJIS = ["🌸", "🍋", "⭐️", "🫧", "🪐", "🍣", "🎈", "🧊", "🍑", "🎧", "🍉", "✨", "🪩", "🌷"];

export default function IntroSplashStage({ onDone }) {
  const fieldRef = useRef(null);
  if (!fieldRef.current) {
    fieldRef.current = createField({
      count: 12, // sparse — a light scatter, not a wall of emoji
      launch: "fountain",
      loop: false, // one shot — clears once everything exits
      stagger: 70,
      power: 2200,
      sizeMin: 54,
      sizeMax: 120,
      onSpawn: (p) => {
        p.data = { emoji: EMOJIS[(Math.random() * EMOJIS.length) | 0] };
      },
    });
  }
  const field = fieldRef.current;

  const nodes = useRef([]);
  const doneRef = useRef(false);
  const [fading, setFading] = useState(false);

  // Paint each frame and detect completion: every particle has launched
  // (age > 0) and none is still alive → the burst is over.
  const place = (particles) => {
    let anyAlive = false;
    let allLaunched = true;
    for (const p of particles) {
      if (p.alive) anyAlive = true;
      if (!p.alive && p.age <= 0) allLaunched = false;
      const n = nodes.current[p.id];
      if (!n) continue;
      n.style.opacity = p.alive ? "1" : "0";
      n.style.transform =
        `translate3d(${(p.x - p.size / 2).toFixed(2)}px,${(p.y - p.size / 2).toFixed(2)}px,0)` +
        ` rotate(${p.rot.toFixed(4)}rad) scale(${p.scale.toFixed(3)})`;
    }
    if (allLaunched && !anyAlive && !doneRef.current) {
      doneRef.current = true;
      setFading(true);
    }
  };

  useFieldLoop(field, place, [field, field.particles.length]);

  // Unmount after the fade-out transition completes. (Unmounting tears down the
  // rAF loop via useFieldLoop's cleanup, so nothing keeps ticking afterward.)
  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(onDone, 450);
    return () => clearTimeout(t);
  }, [fading, onDone]);

  return (
    <div className={`intro-splash ${fading ? "is-leaving" : ""}`} aria-hidden="true">
      {field.particles.map((p) => (
        <div
          key={p.id}
          ref={(n) => (nodes.current[p.id] = n)}
          className="intro-splash__item"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: p.size,
            height: p.size,
            fontSize: p.size,
            lineHeight: 1,
            opacity: 0,
            willChange: "transform",
            transformOrigin: "center",
            userSelect: "none",
            display: "grid",
            placeItems: "center",
            zIndex: Math.round(p.depth * 40),
          }}
        >
          {p.data?.emoji}
        </div>
      ))}
    </div>
  );
}
