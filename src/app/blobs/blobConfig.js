"use client";

import { useEffect, useRef } from "react";
import { useControls, folder, button } from "leva";
import { blobActions } from "./blobActions";
import {
  BASE,
  DEFAULTS,
  GRID_MODE_COUNT,
  LAYOUTS,
  LAYOUT_COUNT,
  LAYOUT_DEFAULTS,
  LAYOUT_KEYS,
  PRESETS,
  PRESET_NAMES,
  SUBJECTS,
  SUBJECT_COUNT,
} from "./blobPresets";

const slider = (key, min, max, step) => ({ value: DEFAULTS[key], min, max, step });

export function useBlobConfig() {
  const latest = useRef({});
  const applyingPreset = useRef(false);
  const cyclePreset = (current, direction) => {
    const index = PRESET_NAMES.indexOf(current);
    const next = PRESET_NAMES[(index + direction + PRESET_NAMES.length) % PRESET_NAMES.length];
    set({ preset: next });
  };

  const [values, set] = useControls("Blobs", () => ({
    preset: {
      value: PRESET_NAMES[0],
      options: PRESET_NAMES,
      transient: false,
      onChange: (name, _path, context) => {
        if (context.initial) return;
        const preset = PRESETS[name];
        const layoutValues =
          preset.layout !== undefined
            ? { ...LAYOUT_DEFAULTS[preset.layout] }
            : Object.fromEntries(LAYOUT_KEYS.map((key) => [key, latest.current[key] ?? BASE[key]]));
        const nextLayout = preset.layout ?? latest.current.layout ?? 0;
        applyingPreset.current = true;
        set({
          ...BASE,
          ...layoutValues,
          ...preset,
          subject: latest.current.subject ?? 0,
          gridMode: preset.gridMode ?? (nextLayout > 0 ? 0 : latest.current.gridMode ?? 0),
        });
        queueMicrotask(() => {
          applyingPreset.current = false;
        });
      },
    },
    Layout: folder(
      {
        layout: {
          value: DEFAULTS.layout,
          options: LAYOUTS,
          transient: false,
          onChange: (value, _path, context) => {
            if (context.initial || applyingPreset.current) return;
            set({ ...LAYOUT_DEFAULTS[value], ...(value > 0 ? { gridMode: 0 } : {}) });
          },
        },
        cellSize: slider("cellSize", 40, 420, 1),
        elementScale: slider("elementScale", 0.2, 1.4, 0.01),
        jitter: slider("jitter", 0, 1.2, 0.01),
        sizeVar: slider("sizeVar", 0, 1, 0.01),
        density: slider("density", 0.1, 1, 0.01),
        drift: slider("drift", -0.6, 0.6, 0.01),
        layoutSpin: slider("layoutSpin", -1, 1, 0.01),
      },
    ),
    Retro: folder({
      pixel: slider("pixel", 1, 64, 1),
      dither: slider("dither", 0, 1, 0.01),
      ditherScale: slider("ditherScale", 1, 8, 1),
      levels: slider("levels", 2, 32, 1),
      alphaDither: slider("alphaDither", 0, 1, 0.01),
      halftone: slider("halftone", 0, 1, 0.01),
      halftoneSize: slider("halftoneSize", 3, 40, 1),
      mono: slider("mono", 0, 1, 0.01),
    }),
    Color: folder({
      hue: slider("hue", -180, 180, 1),
      saturation: slider("saturation", 0, 2.5, 0.01),
      contrast: slider("contrast", 0.5, 1.8, 0.01),
      grain: slider("grain", 0, 0.4, 0.005),
      grainSpeed: slider("grainSpeed", 0, 40, 1),
      aberration: slider("aberration", 0, 14, 0.5),
    }),
    Look: folder(
      {
        edgeLow: slider("edgeLow", 0.02, 0.6, 0.01),
        edgeHigh: slider("edgeHigh", 0.3, 1.4, 0.01),
        valley: slider("valley", 0, 1, 0.01),
        gloss: slider("gloss", 0, 1.2, 0.01),
        glossSharpness: slider("glossSharpness", 4, 160, 1),
        rim: slider("rim", 0, 1, 0.01),
        ambient: slider("ambient", 0.3, 1, 0.01),
        outline: slider("outline", 0, 1, 0.01),
      },
      { collapsed: true },
    ),
    Organic: folder(
      {
        wobble: slider("wobble", 0, 2, 0.01),
        wobbleSpeed: slider("wobbleSpeed", 0, 4, 0.01),
        wobbleScale: slider("wobbleScale", 0.5, 6, 0.05),
        breathe: slider("breathe", 0, 0.3, 0.005),
        spinSpeed: slider("spinSpeed", 0, 3, 0.05),
      },
      { collapsed: true },
    ),
    Jelly: folder(
      {
        jellyStiffness: slider("jellyStiffness", 10, 220, 1),
        jellyDamping: slider("jellyDamping", 1, 24, 0.1),
        lean: slider("lean", 0, 0.6, 0.01),
        scrollKick: slider("scrollKick", 0, 0.3, 0.005),
        parallax: slider("parallax", 0, 0.15, 0.005),
        followRate: slider("followRate", 1, 15, 0.1),
        bloomSeconds: slider("bloomSeconds", 0.3, 5, 0.05),
      },
      { collapsed: true },
    ),
    Shape: folder(
      {
        petals: slider("petals", 3, 8, 1),
        subject: {
          value: DEFAULTS.subject,
          options: SUBJECTS,
        },
        lobeShape: slider("lobeShape", 0.8, 6, 0.05),
        petalSize: slider("petalSize", 0.5, 1.6, 0.01),
        petalReach: slider("petalReach", 0.6, 1.5, 0.01),
        flowerScale: slider("flowerScale", 0.5, 1.6, 0.01),
        coreSize: slider("coreSize", 0.4, 2, 0.01),
      },
      { collapsed: true },
    ),
    Space: folder(
      {
        gridMode: { value: DEFAULTS.gridMode, options: { Off: 0, Dots: 1, Lines: 2, Crosses: 3 } },
        gridSize: slider("gridSize", 12, 140, 1),
        gridWarp: slider("gridWarp", 0, 1.6, 0.01),
        gridStrength: slider("gridStrength", 0, 1, 0.01),
        gridReveal: slider("gridReveal", 0, 1, 0.01),
      },
      { collapsed: true },
    ),
    Stage: folder(
      {
        customBackground: DEFAULTS.customBackground,
        background: DEFAULTS.background,
        textColor: DEFAULTS.textColor,
        nextPreset: button((get) => cyclePreset(get("Blobs.preset"), 1)),
        previousPreset: button((get) => cyclePreset(get("Blobs.preset"), -1)),
        pop: button(() => blobActions.pop()),
        replayBloom: button(() => blobActions.replay()),
        reset: button(() => set({ preset: PRESET_NAMES[0], ...DEFAULTS })),
      },
      { collapsed: true },
    ),
  }));

  latest.current = values;

  useEffect(() => {
    const handleKey = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft";
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (!horizontal && !vertical) return;
      event.preventDefault();
      if (horizontal && event.shiftKey) {
        const step = event.key === "ArrowRight" ? 1 : -1;
        set({ layout: (values.layout + step + LAYOUT_COUNT) % LAYOUT_COUNT });
        return;
      }
      if (horizontal) {
        cyclePreset(values.preset, event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (event.shiftKey) {
        set({ gridMode: (values.gridMode + direction + GRID_MODE_COUNT) % GRID_MODE_COUNT });
      } else {
        set({ subject: (values.subject + direction + SUBJECT_COUNT) % SUBJECT_COUNT });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return values;
}
