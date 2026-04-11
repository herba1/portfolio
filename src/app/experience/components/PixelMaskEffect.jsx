"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  EffectComposer,
  Pixelation,
  Vignette,
  DepthOfField,
} from "@react-three/postprocessing";
import { useControls, folder } from "leva";

// Pixelation steps — scroll progress maps to these discrete values
// Scroll 0% = fully pixelated (200), scroll 100% = clear (0)
const PIXEL_STEPS = [200, 140, 90, 60, 40, 24, 14, 8, 0];

export default function DreamyEffect({ active, scrollProgressRef, isVisible }) {
  const pixelRef = useRef();
  const lastStepRef = useRef(0);

  const {
    vignetteDarkness,
    vignetteOffset,
    dofFocusDistance,
    dofFocalLength,
    dofBokehScale,
  } = useControls(
    "Dreamy",
    {
      Vignette: folder({
        vignetteDarkness: { value: 0.7, min: 0, max: 1.5, step: 0.05 },
        vignetteOffset: { value: 0.2, min: 0, max: 1, step: 0.05 },
      }),
      "Depth of Field": folder({
        dofFocusDistance: { value: 0.005, min: 0, max: 0.1, step: 0.001 },
        dofFocalLength: { value: 0.02, min: 0.001, max: 0.2, step: 0.001 },
        dofBokehScale: { value: 3, min: 0, max: 10, step: 0.1 },
      }),
    },
    { collapsed: true }
  );

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
