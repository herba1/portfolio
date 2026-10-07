"use client";

import { useEffect, useImperativeHandle, useRef } from "react";

import SignaturePad from "./SignaturePad";

const BLOT_STEPS = {
  arrive: 40,
  press: 480,
  absorb: 560,
  release: 700,
  turn: 880,
  booked: 1080,
  leave: 2200,
  gone: 2900,
};

export default function SignatureField({ ref, params, locked, onSigned, onIntroDone }) {
  const surfaceRef = useRef(null);
  const hostRef = useRef(null);
  const nibRef = useRef(null);
  const blotterRef = useRef(null);
  const printRef = useRef(null);
  const padRef = useRef(null);
  const timersRef = useRef([]);
  const callbacksRef = useRef({ onSigned, onIntroDone });

  useEffect(() => {
    callbacksRef.current = { onSigned, onIntroDone };
  }, [onSigned, onIntroDone]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const pad = new SignaturePad({
      surface,
      host: hostRef.current,
      nib: nibRef.current,
      callbacks: {
        onSigned: (value) => callbacksRef.current.onSigned?.(value),
        onIntroDone: () => callbacksRef.current.onIntroDone?.(),
        onPainted: () => surface.setAttribute("data-painted", "true"),
        onEngine: (kind) => surface.setAttribute("data-engine", kind),
      },
    });
    padRef.current = pad;
    pad.start();
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.length = 0;
      pad.destroy();
      padRef.current = null;
    };
  }, []);

  useEffect(() => {
    padRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    padRef.current?.lock(locked);
  }, [locked]);

  useImperativeHandle(
    ref,
    () => {
      const later = (ms, fn) => {
        timersRef.current.push(window.setTimeout(fn, ms));
      };
      const stage = (name) => blotterRef.current?.setAttribute("data-stage", name);
      const face = (name) => blotterRef.current?.setAttribute("data-face", name);
      const printOffprint = (image) => {
        const canvas = printRef.current;
        if (!canvas || !image) return;
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")?.putImageData(image, 0, 0);
      };
      return {
        clear: () => padRef.current?.clear(),
        signForMe: () => padRef.current?.signForMe(),
        reset: () => {
          timersRef.current.forEach((id) => window.clearTimeout(id));
          timersRef.current.length = 0;
          stage("off");
          face("blank");
          padRef.current?.reset();
        },
        blot: (onBooked) => {
          const pad = padRef.current;
          if (!pad) return;
          pad.lock(true);
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            pad.blot();
            onBooked();
            return;
          }
          face("blank");
          stage("ready");
          blotterRef.current?.getBoundingClientRect();
          later(BLOT_STEPS.arrive, () => stage("in"));
          later(BLOT_STEPS.press, () => stage("press"));
          later(BLOT_STEPS.absorb, () => printOffprint(pad.blot()));
          later(BLOT_STEPS.release, () => stage("turn"));
          later(BLOT_STEPS.turn, () => {
            face("print");
            stage("shown");
          });
          later(BLOT_STEPS.booked, onBooked);
          later(BLOT_STEPS.leave, () => stage("out"));
          later(BLOT_STEPS.gone, () => {
            stage("off");
            face("blank");
          });
        },
      };
    },
    [],
  );

  const onKeyDown = (e) => {
    if (locked) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      padRef.current?.signForMe();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      padRef.current?.clear();
    }
  };

  return (
    <div
      ref={surfaceRef}
      className="wi-field"
      data-locked={locked ? "true" : "false"}
      role="application"
      tabIndex={0}
      aria-label="Signature. Draw with a mouse, finger or pen. Press Enter to sign for you, Backspace to clear."
      onKeyDown={onKeyDown}
    >
      <div ref={hostRef} className="wi-paper" />
      <span className="wi-field__line" aria-hidden="true" />
      <span className="wi-field__mark text-heading" aria-hidden="true">
        x
      </span>
      <span ref={nibRef} className="wi-nib" data-visible="false" data-down="false" aria-hidden="true" />
      <div ref={blotterRef} className="wi-blotter" data-stage="off" data-face="blank" aria-hidden="true">
        <canvas ref={printRef} className="wi-blotter__print" width={2} height={2} />
      </div>
    </div>
  );
}
