"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import DandelionEngine from "./dandelionEngine";
import Breath, { micSupported } from "./dandelionMic";
import "./dandelion.css";

const PORTRAITS = [
  { name: "John", src: "/cast/john.webp" },
  { name: "Paul", src: "/cast/paul.webp" },
  { name: "George", src: "/cast/george.webp" },
];

const ARROWS = {
  ArrowRight: [1, -0.12],
  ArrowLeft: [-1, -0.12],
  ArrowUp: [0.1, -1],
  ArrowDown: [-0.1, 1],
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const pointerRef = useRef(null);
  const breathRef = useRef(null);
  const blowingRef = useRef(false);
  const [phase, setPhase] = useState("loading");
  const [current, setCurrent] = useState(0);
  const [mic, setMic] = useState("off");
  const [blowing, setBlowing] = useState(false);
  const [canMic, setCanMic] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const box = root.closest(".piece-box") ?? root;
    const engine = new DandelionEngine({
      canvas: canvasRef.current,
      box,
      portraits: PORTRAITS,
      embedded,
      onReady: () => {
        setPhase("ready");
        setCanMic(micSupported());
      },
      onError: () => setPhase("error"),
    });
    engineRef.current = engine;
    return () => {
      breathRef.current?.close();
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [embedded]);

  const choose = useCallback((index) => {
    setCurrent(index);
    engineRef.current?.setPortrait(index);
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (pointerRef.current != null) return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    engineRef.current?.pointerDown(event.clientX, event.clientY, event.pointerType === "mouse");
  }, []);

  const handlePointerMove = useCallback((event) => {
    const engine = engineRef.current;
    if (!engine) return;
    const mine = pointerRef.current === event.pointerId;
    if (mine || (pointerRef.current == null && event.pointerType === "mouse")) {
      engine.pointerMove(event.clientX, event.clientY, event.pointerType === "mouse");
    }
  }, []);

  const handlePointerUp = useCallback((event) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    engineRef.current?.pointerUp();
  }, []);

  const handlePointerLeave = useCallback((event) => {
    if (event.pointerType === "mouse" && pointerRef.current == null) engineRef.current?.pointerLeave();
  }, []);

  const handleKeyDown = useCallback(
    (event) => {
      const engine = engineRef.current;
      if (!engine || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!event.repeat) engine.gust(1, -0.12);
        return;
      }
      const arrow = ARROWS[event.key];
      if (arrow) {
        event.preventDefault();
        if (!event.repeat) engine.gust(arrow[0], arrow[1]);
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < PORTRAITS.length) {
        event.preventDefault();
        choose(index);
      }
    },
    [choose],
  );

  const allowMic = useCallback(async () => {
    setMic("asking");
    const breath = breathRef.current ?? new Breath();
    breathRef.current = breath;
    try {
      await breath.open();
      breath.close();
      setMic("ready");
    } catch {
      breath.close();
      setMic("denied");
    }
  }, []);

  const startBlow = useCallback(async () => {
    if (blowingRef.current) return;
    const breath = breathRef.current ?? new Breath();
    breathRef.current = breath;
    blowingRef.current = true;
    setBlowing(true);
    try {
      const opened = await breath.open();
      if (!opened || !blowingRef.current) {
        breath.close();
        return;
      }
      engineRef.current?.setBreath((dt) => breath.read(dt));
    } catch {
      blowingRef.current = false;
      setBlowing(false);
      setMic("denied");
    }
  }, []);

  const stopBlow = useCallback(() => {
    if (!blowingRef.current) return;
    blowingRef.current = false;
    setBlowing(false);
    breathRef.current?.close();
    engineRef.current?.setBreath(null);
  }, []);

  const handleMicPointerDown = useCallback(
    (event) => {
      if (mic !== "ready") return;
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startBlow();
    },
    [mic, startBlow],
  );

  const handleMicClick = useCallback(() => {
    if (mic === "off") setMic("ask");
  }, [mic]);

  const handleMicKeyDown = useCallback(
    (event) => {
      if (mic !== "ready" || event.repeat) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        startBlow();
      }
    },
    [mic, startBlow],
  );

  const handleMicKeyUp = useCallback(
    (event) => {
      if (event.key === " " || event.key === "Enter") stopBlow();
    },
    [stopBlow],
  );

  const preventMenu = useCallback((event) => event.preventDefault(), []);
  const portrait = PORTRAITS[current];

  const micNote =
    mic === "ask"
      ? null
      : mic === "asking"
        ? "Waiting for your browser to ask."
        : mic === "ready"
          ? blowing
            ? "Blow now."
            : "Hold the button and blow at the screen."
          : mic === "denied"
            ? "No mic, no problem. Swipe across the face instead."
            : null;

  return (
    <div
      ref={rootRef}
      className="dandelion"
      data-phase={phase}
      data-embedded={embedded || undefined}
    >
      <div
        className="dandelion__surface"
        tabIndex={0}
        role="application"
        aria-roledescription="seed portrait"
        aria-label={`Portrait of ${portrait.name} made of dandelion seeds. Swipe across it and the seeds lift off on the wind, then drift back and land. Enter or the arrow keys blow a gust, 1 to 3 change the portrait.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
        onContextMenu={preventMenu}
      >
        <canvas ref={canvasRef} className="dandelion__canvas" aria-hidden="true" />
      </div>

      {embedded ? null : (
        <header className="dandelion__head">
          <h1 className="dandelion__title">Dandelion</h1>
          <p className="dandelion__lede">
            Swipe across the face and the seeds <em>lift off</em>. Leave it, and the wind carries them home.
          </p>
        </header>
      )}

      <div className="dandelion__bar">
        <div className="dandelion__faces" role="radiogroup" aria-label="Portrait">
          {PORTRAITS.map((option, index) => (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={index === current}
              aria-label={option.name}
              className="dandelion__face"
              onClick={() => choose(index)}
            >
              <img className="dandelion__thumb" src={option.src} alt="" width={20} height={20} draggable={false} />
              <span className="dandelion__name">{option.name}</span>
            </button>
          ))}
        </div>

        {!embedded && canMic ? (
          <button
            type="button"
            className="dandelion__mic"
            data-state={mic}
            data-blowing={blowing || undefined}
            aria-pressed={mic === "ready" ? blowing : undefined}
            aria-label={mic === "ready" ? "Hold to blow into the microphone" : "Blow with your microphone"}
            disabled={mic === "asking" || mic === "denied"}
            onClick={handleMicClick}
            onPointerDown={handleMicPointerDown}
            onPointerUp={stopBlow}
            onPointerCancel={stopBlow}
            onLostPointerCapture={stopBlow}
            onKeyDown={handleMicKeyDown}
            onKeyUp={handleMicKeyUp}
            onBlur={stopBlow}
            onContextMenu={preventMenu}
          >
            <Mic className="dandelion__mic-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>{mic === "ready" ? (blowing ? "Blowing" : "Hold to blow") : "Blow"}</span>
          </button>
        ) : null}
      </div>

      {!embedded && mic === "ask" ? (
        <div className="dandelion__ask" role="dialog" aria-label="Use the microphone">
          <p className="dandelion__ask-text">
            Blow at the screen to scatter the seeds. This listens to your microphone only while you hold the button, and nothing is
            recorded.
          </p>
          <div className="dandelion__ask-actions">
            <button type="button" className="dandelion__ask-yes" onClick={allowMic}>
              Allow microphone
            </button>
            <button type="button" className="dandelion__ask-no" onClick={() => setMic("off")}>
              Just swipe
            </button>
          </div>
        </div>
      ) : null}

      {!embedded && micNote ? (
        <p className="dandelion__note" aria-live="polite">
          {micNote}
        </p>
      ) : null}

      {phase === "error" ? <p className="dandelion__error">This piece needs WebGL2 to grow its seeds.</p> : null}
    </div>
  );
}
