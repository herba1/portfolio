"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useControls } from "leva";
import { createField, LAUNCH_MODES, SIDE_DIRS, FIELD_DEFAULTS } from "./engine/field";
import DomLayer from "./engine/DomLayer";
import SplatLayer from "./engine/SplatLayer";
import "./intro.css";

const RENDERERS = ["emoji", "splat"];
const SPLAT_SRC = "/splats/herb-scan-clean.splat"; // the site's existing scan
const DEFAULT_EMOJIS = ["🌸", "🍋", "⭐️", "🫧", "🪐", "🍣", "🎈", "🧊", "🍑", "🎧"];

const parseEmojis = (s) =>
  [...new Intl.Segmenter().segment(s || "")]
    .map((g) => g.segment.trim())
    .filter(Boolean);

/* Defaults double as the URL query-string schema. */
const DEFAULTS = {
  renderer: "emoji",
  count: 4,
  launch: FIELD_DEFAULTS.launch,
  sideDir: FIELD_DEFAULTS.sideDir,
  gravity: FIELD_DEFAULTS.gravity,
  power: FIELD_DEFAULTS.power,
  spread: FIELD_DEFAULTS.spread,
  spin: FIELD_DEFAULTS.spin,
  drag: FIELD_DEFAULTS.drag,
  stagger: FIELD_DEFAULTS.stagger,
  scaleFx: FIELD_DEFAULTS.scaleFx,
  loop: FIELD_DEFAULTS.loop,
  emojis: DEFAULT_EMOJIS.join(" "),
  splatScale: 60, // px-space ortho world → native splat is small; tune to taste
};

function readURL() {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const out = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!q.has(k)) continue;
    const raw = q.get(k);
    if (typeof def === "number") {
      const n = Number(raw);
      if (!Number.isNaN(n)) out[k] = n;
    } else if (typeof def === "boolean") {
      out[k] = raw === "1" || raw === "true";
    } else {
      out[k] = raw;
    }
  }
  return out;
}

function writeURL(state) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams();
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = state[k];
    if (v === def) continue;
    q.set(k, typeof def === "boolean" ? (v ? "1" : "0") : String(v));
  }
  const qs = q.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export default function IntroExperience() {
  const initial = useMemo(readURL, []);
  const cfg = { ...DEFAULTS, ...initial };

  const controls = useControls("Intro", {
    renderer: { value: cfg.renderer, options: RENDERERS },
    count: { value: cfg.count, min: 1, max: 40, step: 1 },
    launch: { value: cfg.launch, options: LAUNCH_MODES },
    sideDir: { value: cfg.sideDir, options: SIDE_DIRS, label: "side from" },
    gravity: { value: cfg.gravity, min: 600, max: 7000, step: 50, label: "gravity (px/s²)" },
    power: { value: cfg.power, min: 500, max: 4500, step: 50, label: "launch power" },
    spread: { value: cfg.spread, min: 0, max: 40, step: 1 },
    spin: { value: cfg.spin, min: 0, max: 1000, step: 10, label: "spin (°/s)" },
    drag: { value: cfg.drag, min: 0, max: 0.5, step: 0.01, label: "air drag" },
    stagger: { value: cfg.stagger, min: 0, max: 400, step: 10, label: "stagger (ms)" },
    scaleFx: { value: cfg.scaleFx, label: "scale in/out" },
    emojis: { value: cfg.emojis },
    splatScale: { value: cfg.splatScale, min: 1, max: 600, step: 1, label: "splat scale" },
    loop: { value: cfg.loop },
  });

  useEffect(() => writeURL(controls), [controls]);

  const emojiList = useMemo(() => {
    const list = parseEmojis(controls.emojis);
    return list.length ? list : DEFAULT_EMOJIS;
  }, [controls.emojis]);
  const emojiRef = useRef(emojiList);
  emojiRef.current = emojiList;

  // ── The reusable engine. Created once; appearance comes from onSpawn. ──
  const fieldRef = useRef(null);
  if (!fieldRef.current) {
    fieldRef.current = createField({
      ...DEFAULTS,
      onSpawn: (p) => {
        const set = emojiRef.current;
        p.data = { emoji: set[(Math.random() * set.length) | 0] };
      },
    });
  }
  const field = fieldRef.current;

  // Live-tune motion params (no rebuild → loop reads them next frame).
  useEffect(() => {
    field.update({
      launch: controls.launch,
      sideDir: controls.sideDir,
      gravity: controls.gravity,
      power: controls.power,
      spread: controls.spread,
      spin: controls.spin,
      drag: controls.drag,
      stagger: controls.stagger,
      scaleFx: controls.scaleFx,
      loop: controls.loop,
    });
  }, [field, controls.launch, controls.sideDir, controls.gravity, controls.power,
      controls.spread, controls.spin, controls.drag, controls.stagger,
      controls.scaleFx, controls.loop]);

  // Structural changes (count / emoji set) rebuild the particle set → re-render.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    field.update({ count: controls.count }); // rebuilds when count changes
    field.rebuild(); // re-pick appearance for the new emoji set
    setVersion((v) => v + 1);
  }, [field, controls.count, emojiList]);

  void version;

  // Particle appearance is random → only render layers after mount to avoid a
  // server/client hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="intro-stage">
      {!mounted ? null : controls.renderer === "emoji" ? (
        <DomLayer field={field} renderItem={(p) => p.data?.emoji} />
      ) : (
        <Canvas
          orthographic
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 0, 1000], near: 0.1, far: 4000 }}
          style={{ position: "absolute", inset: 0 }}
        >
          <Suspense fallback={null}>
            <SplatLayer field={field} src={SPLAT_SRC} splatScale={controls.splatScale} />
          </Suspense>
        </Canvas>
      )}

      <div className="intro-caption">
        <span className="text-2xl font-bold tracking-tight">intro</span>
        <span className="ml-2 text-sm opacity-60">
          — gravity field engine · {controls.renderer} renderer
        </span>
      </div>
    </div>
  );
}
