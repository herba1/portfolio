"use client";

import { useEffect } from "react";
import { useControls, folder, monitor } from "leva";
import { BACKDROP_DEFAULTS, MOD_SOURCES } from "./gradientScene";

const MOD_TARGETS = [
  ["speed", "rotation rate", 1],
  ["twistDrift", "swirl drift rate", 1],
  ["spriteScale", "sprite scale", 1],
  ["blurScale", "blur", 1],
  ["saturation", "saturation", 1],
  ["brightness", "brightness", 1],
];

function audioFolder() {
  const controls = {
    modSmoothing: {
      value: BACKDROP_DEFAULTS.modSmoothing,
      min: 0.005,
      max: 0.5,
      step: 0.005,
      label: "glide",
    },
  };
  MOD_TARGETS.forEach(([key, label, max]) => {
    const capital = `${key[0].toUpperCase()}${key.slice(1)}`;
    controls[`mod${capital}Source`] = {
      value: BACKDROP_DEFAULTS[`mod${capital}Source`],
      options: MOD_SOURCES,
      label: `${label} ←`,
    };
    controls[`mod${capital}Depth`] = {
      value: BACKDROP_DEFAULTS[`mod${capital}Depth`],
      min: 0,
      max,
      step: 0.01,
      label: `${label} depth`,
    };
  });
  return controls;
}

export default function BackdropControls({ onChange, getLevel }) {
  useControls("Signal", { level: monitor(getLevel, { graph: true, interval: 40 }) });

  const values = useControls("Backdrop", {
    audio: folder(audioFolder(), { collapsed: false }),
    render: folder({
      renderScale: {
        value: BACKDROP_DEFAULTS.renderScale,
        min: 0.15,
        max: 1,
        step: 0.05,
        label: "internal scale",
      },
      maxFPS: { value: BACKDROP_DEFAULTS.maxFPS, min: 5, max: 60, step: 1, label: "fps cap" },
      referenceExtent: {
        value: BACKDROP_DEFAULTS.referenceExtent,
        min: 800,
        max: 2400,
        step: 20,
        label: "reference px",
      },
    }, { collapsed: true }),
    motion: folder({
      speed: { value: BACKDROP_DEFAULTS.speed, min: 0, max: 4, step: 0.05 },
      orbitRate: { value: BACKDROP_DEFAULTS.orbitRate, min: 0, max: 3, step: 0.05 },
      orbitRadius: { value: BACKDROP_DEFAULTS.orbitRadius, min: 0, max: 0.8, step: 0.01 },
      orbitDrift: { value: BACKDROP_DEFAULTS.orbitDrift, min: -0.3, max: 0.3, step: 0.01 },
      crossfadeMS: {
        value: BACKDROP_DEFAULTS.crossfadeMS,
        min: 0,
        max: 6000,
        step: 50,
        label: "crossfade (ms)",
      },
    }, { collapsed: true }),
    shape: folder({
      twistAngle: { value: BACKDROP_DEFAULTS.twistAngle, min: -8, max: 8, step: 0.05 },
      twistRadius: { value: BACKDROP_DEFAULTS.twistRadius, min: 0, max: 2400, step: 10 },
      blurScale: { value: BACKDROP_DEFAULTS.blurScale, min: 0.1, max: 3, step: 0.05 },
      twistDriftRate: {
        value: BACKDROP_DEFAULTS.twistDriftRate,
        min: 0,
        max: 0.05,
        step: 0.001,
        label: "swirl drift",
      },
      twistDriftRadius: {
        value: BACKDROP_DEFAULTS.twistDriftRadius,
        min: 0,
        max: 0.4,
        step: 0.01,
        label: "swirl radius",
      },
      artworkSize: {
        value: BACKDROP_DEFAULTS.artworkSize,
        options: [128, 256, 512, 1024],
        label: "texture px",
      },
    }, { collapsed: true }),
    color: folder({
      saturation: { value: BACKDROP_DEFAULTS.saturation, min: 0, max: 6, step: 0.05 },
      contrast: { value: BACKDROP_DEFAULTS.contrast, min: 0, max: 4, step: 0.05 },
      brightness: { value: BACKDROP_DEFAULTS.brightness, min: 0, max: 2, step: 0.05 },
      gamma: { value: BACKDROP_DEFAULTS.gamma, min: 0.2, max: 3, step: 0.05 },
      blackScrim: { value: BACKDROP_DEFAULTS.blackScrim, min: 0, max: 1, step: 0.01 },
      whiteScrim: { value: BACKDROP_DEFAULTS.whiteScrim, min: 0, max: 0.5, step: 0.01 },
    }, { collapsed: true }),
  });

  useEffect(() => {
    onChange(values);
  }, [values, onChange]);

  return null;
}
