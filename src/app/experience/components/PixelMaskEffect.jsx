"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  EffectComposer,
  Pixelation,
  Vignette,
  DepthOfField,
} from "@react-three/postprocessing";

// Pixelation steps — scroll progress maps to these discrete values
// Scroll 0% = fully pixelated (200), scroll 100% = clear (0)
const PIXEL_STEPS = [200, 140, 90, 60, 40, 24, 14, 8, 0];

export default function DreamyEffect({ active, scrollProgressRef, isVisible }) {
  const pixelRef = useRef();
  const lastStepRef = useRef(0);

  const vignetteDarkness = 0.7;
  const vignetteOffset = 0.2;
  const dofFocusDistance = 0.005;
  const dofFocalLength = 0.02;
  const dofBokehScale = 3;

  useFrame(() => {
    if (!active || !pixelRef.current || !isVisible) return;

    // Map scroll progress [0, 1] to pixel step index
    const scrollP = scrollProgressRef?.current ?? 0;
    const stepIndex = Math.min(
      Math.floor(scrollP * PIXEL_STEPS.length),
      PIXEL_STEPS.length - 1
    );

    // Only update when step actually changes (discrete snaps)
    if (stepIndex !== lastStepRef.current) {
      lastStepRef.current = stepIndex;
      pixelRef.current.granularity = PIXEL_STEPS[stepIndex];
    }
  });

  return (
    <EffectComposer multisampling={0}>
      <Pixelation ref={pixelRef} granularity={PIXEL_STEPS[0]} />
      <DepthOfField
        focusDistance={dofFocusDistance}
        focalLength={dofFocalLength}
        bokehScale={dofBokehScale}
      />
      <Vignette
        offset={vignetteOffset}
        darkness={vignetteDarkness}
        eskil={false}
      />
    </EffectComposer>
  );
}
