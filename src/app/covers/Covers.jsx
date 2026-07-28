"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useMeasure from "react-use-measure";
import { Canvas } from "@react-three/fiber";
import { Leva, useControls, folder, button } from "leva";
import CoversGrid from "./CoversGrid";
import CoverPlayer, { playerLayout } from "./CoverPlayer";
import NowPlaying from "./NowPlaying";
import Minimap from "./Minimap";
import MorphText from "@/app/ui/MorphText";
import { makeCoversMeta, setCoverSources } from "./lib/makeCovers";
import { fetchSpotifyCovers } from "./lib/spotify";
import { DEFAULTS, REF_VW, responsiveLayout } from "./lib/config";
import { isDevView } from "@/lib/viewMode";
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
        // reference values — the composition at REF_VW; the live grid scales
        // these to the viewport (see responsiveLayout).
        tileSize: { value: DEFAULTS.tileSize, min: 80, max: 480, step: 1, label: "tileSize @1440" },
        gap: { value: DEFAULTS.gap, min: 0, max: 400, step: 1, label: "gap @1440" },
        cornerRadius: { value: DEFAULTS.cornerRadius, min: 0, max: 0.5, step: 0.01 },
        brickOffset: { value: DEFAULTS.brickOffset, min: 0, max: 1, step: 0.05 },
      },
      { collapsed: false },
    ),
    Motion: folder(
      {
        momentumDamping: { value: DEFAULTS.momentumDamping, min: 0.8, max: 0.99, step: 0.005 },
        wheelStrength: { value: DEFAULTS.wheelStrength, min: 0.2, max: 3, step: 0.05 },
        scrollSmooth: { value: DEFAULTS.scrollSmooth, min: 0, max: 0.35, step: 0.005 },
        scrollKnee: { value: DEFAULTS.scrollKnee, min: 200, max: 4000, step: 50 },
        scrollResist: { value: DEFAULTS.scrollResist, min: 0, max: 1, step: 0.01 },
        dragEase: { value: DEFAULTS.dragEase, min: 0.2, max: 2, step: 0.05 },
        springTrackSpeed: { value: DEFAULTS.springTrackSpeed, min: 800, max: 12000, step: 100 },
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
        popRise: { value: DEFAULTS.popRise, min: 0, max: 120, step: 1, label: "popRise @1440" },
        popReadyTimeout: { value: DEFAULTS.popReadyTimeout, min: 0.5, max: 8, step: 0.5 },
      },
      { collapsed: false },
    ),
    Depth: folder(
      {
        depthFade: { value: DEFAULTS.depthFade, min: 0, max: 1, step: 0.01 },
        depthScale: { value: DEFAULTS.depthScale, min: 0, max: 0.5, step: 0.01, label: "depthScale @1440" },
        depthStart: { value: DEFAULTS.depthStart, min: 0, max: 1, step: 0.01 },
      },
      { collapsed: true },
    ),
    "Click push": folder(
      {
        pushStrength: { value: DEFAULTS.pushStrength, min: 0, max: 600, step: 5, label: "pushStrength @1440" },
        pushAnisotropy: { value: DEFAULTS.pushAnisotropy, min: 0, max: 1.6, step: 0.05 },
        pushFalloff: { value: DEFAULTS.pushFalloff, min: 0.1, max: 4, step: 0.05 },
        pushInflate: { value: DEFAULTS.pushInflate, min: 0, max: 2, step: 0.05 },
        pushScale: { value: DEFAULTS.pushScale, min: 0, max: 0.5, step: 0.01 },
        pushResponse: { value: DEFAULTS.pushResponse, min: 0.1, max: 1.5, step: 0.01 },
        pushSpread: { value: DEFAULTS.pushSpread, min: 0, max: 2, step: 0.05 },
        pushDamping: { value: DEFAULTS.pushDamping, min: 0.3, max: 1, step: 0.01 },
      },
      { collapsed: true },
    ),
    Background: folder(
      { bgTint: { value: DEFAULTS.bgTint, min: 0, max: 1, step: 0.01 } },
      { collapsed: true },
    ),
    reducedMotion: { value: DEFAULTS.reducedMotion },
  });

  // merged, frame-fresh config: reference values → viewport-scaled px, then OR
  // in the OS reduced-motion preference.
  const vp = useViewport();
  const config = useMemo(
    () => ({
      ...v,
      ...responsiveLayout(vp.w, vp.h, v),
      reducedMotion: v.reducedMotion || prefersReduced.current,
    }),
    [v, vp],
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

  const [rootRef, rootBounds] = useMeasure();

  // ── the notch plate ────────────────────────────────────────────────────
  // The plate persists across focus changes and tweens its width to fit the new
  // title. MorphText hands us that width during the layout phase, from the same
  // measurement it uses to place the glyphs (one hidden pass per unique string,
  // cached) — so the plate reshapes on the very frame the letters start moving,
  // with no ResizeObserver in the loop.
  //
  // It is written STRAIGHT TO THE NODES rather than held in state. Routing a
  // width through React costs a second full render of this component per title
  // change, and a render here means R3F reconciling the whole mesh pool — ~110
  // <mesh> elements, each with a ref callback that detaches and re-attaches —
  // while the grid is mid-drag at 60fps. Far too much for a number that only
  // ever lands on two style properties. Same reasoning as the dock's progress
  // hairline and SlotNumber's digits: DOM writes the compositor can absorb,
  // kept out of the render path.
  const plateRef = useRef(null);
  const squishRef = useRef(null);
  const textWRef = useRef(0);
  const vwRef = useRef(0);
  vwRef.current = rootBounds.width;

  // On mobile a long title can outgrow the screen. Rather than ellipsis, condense
  // the text horizontally (scaleX) so it always fits one line, and cap the plate
  // to the viewport. Desktop stays 1:1.
  const applyNotch = useCallback(() => {
    const plate = plateRef.current;
    const textW = textWRef.current;
    if (!plate || !textW) return;
    const vw = vwRef.current;
    const full = textW + NOTCH_PAD_X;
    let width = full;
    let squish = 1;
    if (vw && vw <= NOTCH_MOBILE_BP && full > vw - NOTCH_SIDE_GUTTER) {
      const availText = vw - NOTCH_SIDE_GUTTER - NOTCH_PAD_X;
      squish = Math.max(NOTCH_MIN_SQUISH, availText / textW);
      width = textW * squish + NOTCH_PAD_X;
    }
    plate.style.width = `${Math.ceil(width)}px`;
    if (squishRef.current) {
      squishRef.current.style.transform = squish === 1 ? "" : `scaleX(${squish})`;
    }
  }, []);

  const onTitleWidth = useCallback(
    (w) => {
      textWRef.current = w;
      applyNotch();
    },
    [applyNotch],
  );

  // the squish depends on the viewport, so refit when that changes too
  useEffect(() => {
    applyNotch();
  }, [rootBounds.width, applyNotch]);

  // ── grid callbacks ─────────────────────────────────────────────────────
  // Stable identities, because CoversGrid is memoised on them. An inline arrow
  // here would hand it a new prop on every render of this component and the
  // memo would never bail out — which is the whole point of it.
  const onGridReady = useCallback(() => setReady(true), []);
  const onGridOpen = useCallback(
    (idx, rect, cell) => {
      const c = covers[idx];
      if (c.type === "audio") return; // no player for audio
      setPlayer({ cover: c, rect });
      // hide the tile (gap) + freeze, and hand the grid the card box the
      // player is about to fill so the push matches its real shape
      apiRef.current?.openCell(cell.col, cell.row, cardBox());
    },
    [covers],
  );

  // overlays (Leva / player / toast) portal to <body> so they sit ABOVE the
  // global navbar — inside .cv-root (position:fixed) they're trapped in its
  // stacking context, which renders below the navbar's z-50.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The Leva panel is a desktop-only tool — on a phone it covers most of the
  // grid and there's nothing to drag it out of the way with. Keep it to wide,
  // pointer-driven viewports; everywhere else it stays hidden even in dev.
  const [panelRoom, setPanelRoom] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    const sync = () => setPanelRoom(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const showPanel = isDevView() && panelRoom;

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

      {/* premultipliedAlpha MUST stay true (three's default). Standard alpha
          blending writes premultiplied RGB into the drawing buffer; declaring
          it straight makes the browser compositor apply alpha a second time, so
          every antialiased edge pixel lands at ~alpha² — the dark outline that
          showed up around every tile, skeletons included. */}
      <Canvas
        className="cv-canvas"
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: true }}
        camera={{ position: [0, 0, 1000], near: 0.1, far: 5000, zoom: 1 }}
      >
        <CoversGrid
          config={config}
          configRef={configRef}
          apiRef={apiRef}
          covers={covers}
          onReady={onGridReady}
          onFocusChange={setFocusIdx}
          onOpen={onGridOpen}
        />
      </Canvas>

      {/* blurred, white-fading screen edges — the homepage's soft-edge language */}
      <div className="cv-edge-fade" aria-hidden />

      {/* HUD */}
      <div className={`cv-hud${ready ? " is-ready" : ""}`}>
        <div className="cv-focus">
          {/* The two concave ramps are siblings of the plate, not its
              pseudo-elements: the plate has to clip its own text now, and
              anything living outside its box would be clipped away with it. */}
          <span className="cv-focus-ear cv-focus-ear--l" aria-hidden="true" />
          <div ref={plateRef} className="cv-focus-title">
            <span ref={squishRef} className="cv-focus-squish">
              <MorphText className="cv-focus-text" text={focus.title} onWidth={onTitleWidth} />
            </span>
          </div>
          <span className="cv-focus-ear cv-focus-ear--r" aria-hidden="true" />
        </div>
        <div className="cv-minimap-wrap">
          <Minimap
            covers={covers}
            focusIdx={focusIdx}
            openIdx={player?.cover?.index ?? null}
            onJump={(uc, ur) => apiRef.current?.jumpToCover(uc, ur)}
          />
        </div>
      </div>

      </main>

      {mounted &&
        createPortal(
          <>
            {showPanel ? (
              <div className="cv-leva">
                <Leva collapsed={false} titleBar={{ title: "Covers" }} />
              </div>
            ) : (
              // useControls auto-injects Leva's default panel into <body>; render
              // it hidden whenever the panel isn't wanted (production, or any
              // narrow / touch viewport) so it never covers the grid.
              <Leva hidden />
            )}
            <CoverPlayer
              cover={player?.cover}
              rect={player?.rect}
              cornerRadius={config.cornerRadius}
              onClose={() => {
                setPlayer(null);
                apiRef.current?.releasePush(); // neighbours ease back WITH the flip home
              }}
              onClosed={() => apiRef.current?.closeCell()}
            />
            {/* Stays in the world once the card closes — and reopens it, with
                the card growing out of the dock's little album thumb. */}
            <NowPlaying
              hidden={!!player}
              onExpand={(cover, rect) => setPlayer({ cover, rect })}
            />
            {toast ? <div className="cv-toast">{toast}</div> : null}
          </>,
          document.body,
        )}
    </>
  );
}

// Viewport size in CSS px, which is what browser zoom actually changes — zoom
// out and innerWidth grows, so a width-derived layout scales with it instead of
// just revealing more tiles. Falls back to the reference width during SSR; the
// grid only lives inside <Canvas>, which renders nothing server-side, so there
// is no hydration mismatch to worry about.
function useViewport() {
  const [vp, setVp] = useState(() =>
    typeof window === "undefined"
      ? { w: REF_VW, h: 900 }
      : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const onResize = () =>
      setVp((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev // same size → same object, so the config memo doesn't churn
          : { w: window.innerWidth, h: window.innerHeight },
      );
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vp;
}

// The player card, in the grid's world space: origin at the viewport centre,
// +y up, 1 unit = 1 px. The canvas is a full-viewport fixed layer, so the card's
// CSS rect converts with a plain recentre — no camera maths needed.
function cardBox() {
  const l = playerLayout();
  if (!l) return null;
  const { left, top, width, height } = l.card;
  return {
    x: left + width / 2 - window.innerWidth / 2,
    y: window.innerHeight / 2 - (top + height / 2),
    hx: width / 2,
    hy: height / 2,
  };
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
