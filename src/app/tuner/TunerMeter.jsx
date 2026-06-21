"use client";

import { motion, useSpring, useTransform } from "motion/react";

// The actual tuner: a needle that slides left (flat) / right (sharp) by how far
// you are from the closest note, resting dead-centre when you're in tune. A
// faint fixed centre mark is the reference; the needle springs and goes green
// on pitch. No labels — position carries the meaning.

export default function TunerMeter({ centsMV, active, inTune }) {
  const x = useSpring(centsMV, { stiffness: 210, damping: 26, mass: 0.7 });
  const left = useTransform(x, [-50, 50], ["0%", "100%"]);

  return (
    <div
      className={`meter${active ? " is-active" : ""}${inTune ? " is-intune" : ""}`}
    >
      <span className="meter__center" aria-hidden="true" />
      <motion.span className="meter__needle" style={{ left }} aria-hidden="true" />
    </div>
  );
}
