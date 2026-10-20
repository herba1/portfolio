"use client";

import { useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { albumsFrom } from "./packArt";
import "./wax-pack.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const poolRef = useRef(albumsFrom([]));
  const { tracks } = useTopSongs(30);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState("sealed");
  const [status, setStatus] = useState("");

  useEffect(() => {
    poolRef.current = albumsFrom(tracks);
  }, [tracks]);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!root || !stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 24, bottom: 24, left: 20, right: 20 };
      const box = root.getBoundingClientRect();
      if (box.width >= 900) return { top: 96, bottom: 48, left: 320, right: 320 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 24 : 200;
      return { top, bottom: 40, left: 16, right: 16 };
    };
    const onChange = (change) => {
      if (cancelled) return;
      if (change.phase) setPhase(change.phase);
      if (change.message !== undefined) setStatus(change.message);
    };
    const start = async () => {
      try {
        const { createPack } = await import("./packEngine");
        if (cancelled) return;
        const family = getComputedStyle(root).fontFamily;
        engine = await createPack(stage, canvas, {
          embedded,
          onChange,
          insets,
          family,
          getPool: () => poolRef.current,
        });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        setReady(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (event) => {
    const engine = engineRef.current;
    if (!engine || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      engine.key("next");
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (engine.key(event.key === "ArrowLeft" ? "left" : "right")) event.preventDefault();
      return;
    }
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      engine.reset();
    }
  };

  const Root = embedded ? "div" : "main";
  const opened = phase !== "sealed";
  const dealt = phase === "dealt" || phase === "rare";

  return (
    <Root
      ref={rootRef}
      className="wax-pack-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-phase={phase}
    >
      <div ref={stageRef} className="wax-pack-stage">
        <canvas
          ref={canvasRef}
          className="wax-pack-canvas"
          tabIndex={0}
          role="application"
          aria-label="A sealed foil booster pack of six album cards. Drag across the top strip to tear the foil open, pull the cards up out of the pack, then swipe the front card aside to see the next. The rare holo card sits at the back. With the keyboard, Enter tears the pack, pulls the cards and deals the next card, the arrow keys swipe left or right, and N opens a new pack."
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="wax-pack-fallback">This piece needs WebGL 2.</p> : null}
      </div>
      {embedded ? null : (
        <header ref={headRef} className="wax-pack-head">
          <h1 className="wax-pack-title">Booster</h1>
          <p className="wax-pack-hint">
            Tear the foil across the top, pull the cards out, and swipe through them. The <em>rare holo</em> waits at the back.
          </p>
          <button
            type="button"
            className="wax-pack-button"
            data-show={opened ? "" : undefined}
            tabIndex={opened ? 0 : -1}
            onClick={() => engineRef.current?.reset()}
          >
            New pack
          </button>
        </header>
      )}
      {embedded ? (
        <button
          type="button"
          className="wax-pack-button wax-pack-button-corner"
          data-show={dealt ? "" : undefined}
          tabIndex={dealt ? 0 : -1}
          onClick={() => engineRef.current?.reset()}
        >
          New pack
        </button>
      ) : null}
      <p className="wax-pack-live" aria-live="polite">
        {status}
      </p>
    </Root>
  );
}
