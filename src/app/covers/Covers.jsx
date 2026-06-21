"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useMeasure from "react-use-measure";
import { Canvas } from "@react-three/fiber";
import { Leva, useControls, folder, button } from "leva";
import CoversGrid from "./CoversGrid";
import CoverPlayer from "./CoverPlayer";
import Minimap from "./Minimap";
import { makeCoversMeta, setCoverSources } from "./lib/makeCovers";
import { fetchSpotifyCovers } from "./lib/spotify";
import { DEFAULTS } from "./lib/config";
import "./covers.css";

// horizontal padding on .cv-focus-title (covers.css) — added to the measured
// text width so the notch plate fits the title.
const NOTCH_PAD_X = 60;
const NOTCH_MOBILE_BP = 640; // matches the covers.css mobile media query
const NOTCH_SIDE_GUTTER = 24; // min breathing room each side of the notch
const NOTCH_MIN_SQUISH = 0.6; // floor so condensed text stays legible

export default function Covers() {
  // start with placeholders, then swap in recently-played Spotify covers if set up
  const [covers, setCovers] = useState(() => makeCoversMeta());
  useEffect(() => {
    let alive = true;
    fetchSpotifyCovers().then((sp) => {
      if (!alive || !sp) return;
      setCoverSources(sp); // tiles load real album art
      setCovers(sp); // grid + player use the track meta
    });
    return () => {
      alive = false;
    };
  }, []);

  // auto-detect reduced motion once
  const prefersReduced = useRef(false);
  useEffect(() => {
    prefersReduced.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // ── live tunables ──────────────────────────────────────────────────────
  const v = useControls({
    Layout: folder(
      {
        tileSize: { value: DEFAULTS.tileSize, min: 80, max: 480, step: 1 },
        gap: { value: DEFAULTS.gap, min: 0, max: 400, step: 1 },
        cornerRadius: { value: DEFAULTS.cornerRadius, min: 0, max: 0.5, step: 0.01 },
        brickOffset: { value: DEFAULTS.brickOffset, min: 0, max: 1, step: 0.05 },
      },
      { collapsed: false },
    ),
    Motion: folder(
      {
        momentumDamping: { value: DEFAULTS.momentumDamping, min: 0.8, max: 0.99, step: 0.005 },
        wheelStrength: { value: DEFAULTS.wheelStrength, min: 0, max: 4, step: 0.05 },
        dragEase: { value: DEFAULTS.dragEase, min: 0.2, max: 2, step: 0.05 },
        maxSpeed: { value: DEFAULTS.maxSpeed, min: 1000, max: 15000, step: 100 },
        stopThreshold: { value: DEFAULTS.stopThreshold, min: 0.1, max: 20, step: 0.1 },
      },
      { collapsed: true },
    ),
    Follow: folder(
      {
        followResponseCenter: { value: DEFAULTS.followResponseCenter, min: 0.1, max: 1.2, step: 0.01 },
        followResponseEdge: { value: DEFAULTS.followResponseEdge, min: 0.1, max: 1.6, step: 0.01 },
        followDamping: { value: DEFAULTS.followDamping, min: 0.3, max: 1.2, step: 0.01 },
        followJitter: { value: DEFAULTS.followJitter, min: 0, max: 0.6, step: 0.01 },
      },
      { collapsed: false },
    ),
    Stretch: folder(
      {
        stretchMax: { value: DEFAULTS.stretchMax, min: 0, max: 0.5, step: 0.01 },
        stretchRef: { value: DEFAULTS.stretchRef, min: 500, max: 8000, step: 100 },
        stretchSquash: { value: DEFAULTS.stretchSquash, min: 0, max: 1.5, step: 0.05 },
        stretchResponse: { value: DEFAULTS.stretchResponse, min: 0.05, max: 1, step: 0.01 },
        stretchDamping: { value: DEFAULTS.stretchDamping, min: 0.3, max: 1.2, step: 0.01 },
      },
      { collapsed: false },
    ),
    Scale: folder(
      {
        scaleResponse: { value: DEFAULTS.scaleResponse, min: 0.05, max: 1.2, step: 0.01 },
        scaleDamping: { value: DEFAULTS.scaleDamping, min: 0.3, max: 1.2, step: 0.01 },
        centerScale: { value: DEFAULTS.centerScale, min: 0, max: 0.8, step: 0.01 },
        centerSigma: { value: DEFAULTS.centerSigma, min: 0.1, max: 1.2, step: 0.01 },
        hoverScale: { value: DEFAULTS.hoverScale, min: 1, max: 1.6, step: 0.01 },
      },
      { collapsed: true },
    ),
    Entrance: folder(
      {
        popResponse: { value: DEFAULTS.popResponse, min: 0.1, max: 1, step: 0.01 },
        popDamping: { value: DEFAULTS.popDamping, min: 0.3, max: 1, step: 0.01 },
        popStagger: { value: DEFAULTS.popStagger, min: 0, max: 0.15, step: 0.002 },
        popJitter: { value: DEFAULTS.popJitter, min: 0, max: 2, step: 0.05 },
        popScaleFrom: { value: DEFAULTS.popScaleFrom, min: 0.4, max: 1, step: 0.01 },
        popRise: { value: DEFAULTS.popRise, min: 0, max: 120, step: 1 },
        popReadyTimeout: { value: DEFAULTS.popReadyTimeout, min: 0.5, max: 8, step: 0.5 },
      },
      { collapsed: false },
    ),
    Depth: folder(
      {
        depthFade: { value: DEFAULTS.depthFade, min: 0, max: 1, step: 0.01 },
        depthStart: { value: DEFAULTS.depthStart, min: 0, max: 1, step: 0.01 },
      },
      { collapsed: true },
    ),
    Background: folder(
      { bgTint: { value: DEFAULTS.bgTint, min: 0, max: 1, step: 0.01 } },
      { collapsed: true },
    ),
    reducedMotion: { value: DEFAULTS.reducedMotion },
  });

  // merged, frame-fresh config (OR in the OS reduced-motion preference)
  const config = useMemo(
    () => ({ ...v, reducedMotion: v.reducedMotion || prefersReduced.current }),
    [v],
  );
  const configRef = useRef(config);
  configRef.current = config;

  // ── view reset + copy-params buttons (refs so Leva calls the latest) ────
  const apiRef = useRef(null);
  const [toast, setToast] = useState(null);
  const copyRef = useRef(() => {});
  const resetRef = useRef(() => {});
  copyRef.current = () => {
    copyText(JSON.stringify(v, null, 2));
    setToast("Params copied to clipboard ✓");
  };
  resetRef.current = () => apiRef.current?.resetView();
  useControls({
    "📋 Copy params JSON": button(() => copyRef.current()),
    "↺ Reset view": button(() => resetRef.current()),
  });

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(id);
  }, [toast]);

  // ── focus + player state ───────────────────────────────────────────────
  const [focusIdx, setFocusIdx] = useState(0);
  const [player, setPlayer] = useState(null); // { cover, rect }
  const focus = covers[focusIdx] ?? covers[0];

  // HUD holds hidden until the grid signals its reveal has armed (art loaded),
  // then the corner / name / minimap stagger in — so nothing shows "not ready".
  const [ready, setReady] = useState(false);

  // The notch plate persists across focus changes and just tweens its width to
  // fit the new title. react-use-measure (ResizeObserver) tracks the text's
  // natural width; the plate width is set in px so CSS can transition it (auto
  // can't animate). The text swaps/fades on its own layer, disconnected.
  const [textRef, textBounds] = useMeasure();
  const [rootRef, rootBounds] = useMeasure();

  // On mobile a long title can outgrow the screen. Rather than ellipsis, condense
  // the text horizontally (scaleX) so it always fits one line, and cap the plate
  // to the viewport. Desktop stays 1:1.
  const notch = useMemo(() => {
    const textW = textBounds.width;
    const vw = rootBounds.width;
    if (!textW) return { width: undefined, squish: 1 };
    const full = textW + NOTCH_PAD_X;
    if (vw && vw <= NOTCH_MOBILE_BP && full > vw - NOTCH_SIDE_GUTTER) {
      const availText = vw - NOTCH_SIDE_GUTTER - NOTCH_PAD_X;
      const squish = Math.max(NOTCH_MIN_SQUISH, availText / textW);
      return { width: Math.ceil(textW * squish + NOTCH_PAD_X), squish };
    }
    return { width: Math.ceil(full), squish: 1 };
  }, [textBounds.width, rootBounds.width]);

  // overlays (Leva / player / toast) portal to <body> so they sit ABOVE the
  // global navbar — inside .cv-root (position:fixed) they're trapped in its
  // stacking context, which renders below the navbar's z-50.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <main
        ref={rootRef}
        className="cv-root"
        style={{
          "--cv-focus": focus.color,
          "--cv-focus2": focus.color2,
          "--cv-tint": v.bgTint,
        }}
      >
      {/* soft focus-hue glow (its own layer so it can never break the base bg).
          Hue is driven by --cv-focus (set on .cv-root above) so it eases
          between covers instead of snapping. */}
      <div className="cv-tint" style={{ opacity: v.bgTint * 0.4 }} />

      <Canvas
        className="cv-canvas"
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: false }}
        camera={{ position: [0, 0, 1000], near: 0.1, far: 5000, zoom: 1 }}
      >
        <CoversGrid
          config={config}
          configRef={configRef}
          apiRef={apiRef}
          covers={covers}
          onReady={() => setReady(true)}
          onFocusChange={setFocusIdx}
          onOpen={(idx, rect, cell) => {
            const c = covers[idx];
            if (c.type === "audio") return; // no player for audio
            setPlayer({ cover: c, rect });
            apiRef.current?.openCell(cell.col, cell.row); // hide the tile (gap) + freeze
          }}
        />
      </Canvas>

      {/* blurred, white-fading screen edges — the homepage's soft-edge language */}
      <div className="cv-edge-fade" aria-hidden />

      {/* HUD */}
      <div className={`cv-hud${ready ? " is-ready" : ""}`}>
        <div className="cv-focus">
          <div className="cv-focus-title" style={{ width: notch.width }}>
            <span
              className="cv-focus-squish"
              style={notch.squish !== 1 ? { transform: `scaleX(${notch.squish})` } : undefined}
            >
              <span className="cv-focus-text" key={focus.index} ref={textRef}>
                {focus.title}
              </span>
            </span>
          </div>
        </div>
        <div className="cv-minimap-wrap">
          <Minimap
            covers={covers}
            focusIdx={focusIdx}
            onJump={(uc, ur) => apiRef.current?.jumpToCover(uc, ur)}
          />
        </div>
      </div>

      </main>

      {mounted &&
        createPortal(
          <>
            <div className="cv-leva">
              <Leva collapsed={false} titleBar={{ title: "Covers" }} />
            </div>
            <CoverPlayer
              cover={player?.cover}
              rect={player?.rect}
              cornerRadius={config.cornerRadius}
              onClose={() => setPlayer(null)}
              onClosed={() => apiRef.current?.closeCell()}
            />
            {toast ? <div className="cv-toast">{toast}</div> : null}
          </>,
          document.body,
        )}
    </>
  );
}

function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  // fallback for non-secure contexts
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
}
