"use client";

import { useEffect, useRef, useState } from "react";

import "./receipt.css";

function PrintIcon() {
  return (
    <svg className="receipt-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 6V2.5h8V6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path
        d="M4 11.5H2.8a.8.8 0 0 1-.8-.8V6.8a.8.8 0 0 1 .8-.8h10.4a.8.8 0 0 1 .8.8v3.9a.8.8 0 0 1-.8.8H12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M4.6 9.5h6.8v4H4.6z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [state, setState] = useState({ printing: false, canPrint: false });
  const [live, setLive] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const start = async () => {
      started = true;
      try {
        const { createReceipt } = await import("./receiptEngine");
        if (disposed) return;
        const made = await createReceipt({
          host: stage,
          root,
          embedded,
          reduced,
          onState: (next) => {
            if (!disposed) setState({ printing: next.printing, canPrint: next.canPrint });
          },
          onLive: (text) => {
            if (!disposed) setLive(text);
          },
        });
        if (!made) return;
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setStatus("ready");
        sync();
      } catch (error) {
        console.error(error);
        if (!disposed) setStatus("failed");
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !started) start();
        sync();
      },
      { rootMargin: "160px" },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === "p" || e.key === "P" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engine.print();
    } else if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      engine.tear();
    }
  };

  const Root = embedded ? "div" : "main";
  const label = state.printing ? "Printing" : state.canPrint ? "Print next" : "Tear it off first";

  return (
    <Root ref={rootRef} className="receipt-root" data-embedded={embedded ? "" : undefined} data-status={status}>
      <div
        ref={stageRef}
        className="receipt-stage"
        tabIndex={0}
        role="application"
        aria-label="A thermal receipt printer with tonight's tracklist curling out of it. Hover the paper to warm the coating, drag the end away to tear it off against the cutter, and drop it on the pile. Press P to print the next set and T to tear one off."
        onKeyDown={onKeyDown}
      />
      <div className="receipt-vignette" aria-hidden="true" />
      {embedded ? null : (
        <header className="receipt-head">
          <h1 className="receipt-title">Receipt</h1>
          <p className="receipt-hint">
            Linger to warm the paper. Pull the end to <em>tear it off</em>.
          </p>
        </header>
      )}
      {embedded ? null : (
        <div className="receipt-dock">
          <button
            type="button"
            className="receipt-print"
            disabled={status !== "ready" || !state.canPrint}
            data-printing={state.printing ? "" : undefined}
            onClick={() => engineRef.current?.print()}
          >
            <PrintIcon />
            <span>{label}</span>
            <kbd className="receipt-key">P</kbd>
          </button>
        </div>
      )}
      {status === "failed" ? <p className="receipt-fallback">This piece needs WebGL to print.</p> : null}
      <p className="receipt-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
