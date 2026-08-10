"use client";

import { memo } from "react";
import { motion, useSpring, useTransform } from "motion/react";

function TunerMeter({ centsMV }) {
  const x = useSpring(centsMV, { stiffness: 210, damping: 26, mass: 0.7 });
  const left = useTransform(x, [-50, 50], ["0%", "100%"]);

  return (
    <div className="meter">
      <span className="meter__center" aria-hidden="true" />
      <motion.span className="meter__needle" style={{ left }} aria-hidden="true" />
    </div>
  );
}

export default memo(TunerMeter);
