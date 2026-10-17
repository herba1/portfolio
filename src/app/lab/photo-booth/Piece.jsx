"use client";

import { useEffect, useRef, useState } from "react";

import "./photo-booth.css";

const STAGE_LABEL =
  "A photo booth delivery slot with a printed strip hanging from it. Press the chrome button for a countdown and four flashes; the strip feeds out wet and dries. Drag a strip by its end, pull it sideways to tear it off at the perforation, and drag torn strips around the tray. Enter takes photos, T tears off the hanging strip.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const flashRef = useRef(null);
  const lampRef = useRef(null);
  const pipsRef = useRef(null);
  const headRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [camera, setCamera] = useState("off");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 16 };
      const boxRect = root.getBoundingClientRect();
      if (boxRect.width >= 900) return { top: 96 };
      const head = headRef.current?.getBoundingClientRect();
      return { top: head ? head.bottom - boxRect.top + 16 : 150 };
    };
    const start = async () => {
      try {
        const { createBoothEngine } = await import("./boothEngine");
        if (cancelled) return;
        engine = createBoothEngine({
          root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          flash: flashRef.current,
          lamp: lampRef.current,
          pips: Array.from(pipsRef.current?.children || []),
          insets,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
        });
        engineRef.current = engine;
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
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    },
    [],
  );

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    engineRef.current?.setCamera(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("off");
  };

  const toggleCamera = async () => {
    if (camera === "on") {
      stopCamera();
      return;
    }
    if (camera === "pending") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("blocked");
      return;
    }
    setCamera("pending");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      engineRef.current?.setCamera(video);
      setCamera("on");
    } catch {
      setCamera("blocked");
    }
  };

  const shoot = () => {
    engineRef.current?.print();
  };

  const onStageKey = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      shoot();
    } else if (e.key === "t" || e.key === "T" || e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      engineRef.current?.tearOff();
    }
  };

  const Root = embedded ? "div" : "main";
  const cameraLabel = camera === "on" ? "Camera on" : camera === "pending" ? "Asking…" : camera === "blocked" ? "No camera" : "Use camera";

  return (
    <Root
      ref={rootRef}
      className="photo-booth"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
      data-camera={camera}
    >
      <div ref={stageRef} className="photo-booth-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL} onKeyDown={onStageKey}>
        <div className="photo-booth-plate" aria-hidden="true">
          <span className="photo-booth-screw" />
          <span className="photo-booth-slit" />
          <span className="photo-booth-screw" />
        </div>
        <div className="photo-booth-tray" aria-hidden="true" />
        <canvas ref={canvasRef} className="photo-booth-canvas" />
        <div className="photo-booth-controls" data-pb-ui="">
          <div className="photo-booth-lamp" aria-hidden="true">
            <span ref={lampRef} className="photo-booth-lamp-digit" />
          </div>
          <div ref={pipsRef} className="photo-booth-pips" aria-hidden="true">
            <span className="photo-booth-pip" />
            <span className="photo-booth-pip" />
            <span className="photo-booth-pip" />
            <span className="photo-booth-pip" />
          </div>
          <button type="button" className="photo-booth-button" aria-label="Take four photos" onClick={shoot}>
            <span className="photo-booth-button-cap" />
          </button>
          {embedded ? null : (
            <button type="button" className="photo-booth-camera" aria-pressed={camera === "on"} onClick={toggleCamera}>
              <span className="photo-booth-camera-eye" aria-hidden="true">
                <video ref={videoRef} className="photo-booth-camera-video" muted playsInline />
              </span>
              <span>{cameraLabel}</span>
            </button>
          )}
        </div>
        <div ref={flashRef} className="photo-booth-flash" aria-hidden="true" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="photo-booth-head">
          <h1 className="photo-booth-title">Photo Booth</h1>
          <p className="photo-booth-lede">
            Press for four frames. Pull the strip <em>sideways</em> to tear it off.
          </p>
        </header>
      )}

      {failed ? <p className="photo-booth-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
