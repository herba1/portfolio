"use client";

import { useEffect, useImperativeHandle, useRef } from "react";

import InkLoop from "./InkLoop";

export default function InkSheet({ ref, params }) {
  const surfaceRef = useRef(null);
  const hostRef = useRef(null);
  const nibRef = useRef(null);
  const loopRef = useRef(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    const loop = new InkLoop({
      surface,
      host: hostRef.current,
      nib: nibRef.current,
      callbacks: {
        onPainted: () => surface.setAttribute("data-painted", "true"),
        onEngine: (kind) => surface.setAttribute("data-engine", kind),
      },
    });
    loopRef.current = loop;
    loop.start();
    return () => {
      loop.destroy();
      loopRef.current = null;
    };
  }, []);

  useEffect(() => {
    loopRef.current?.setParams(params);
  }, [params]);

  useImperativeHandle(
    ref,
    () => ({
      next: () => loopRef.current?.next(),
      wipe: () => loopRef.current?.wipe(),
    }),
    [],
  );

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      loopRef.current?.next();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      loopRef.current?.wipe();
    }
  };

  return (
    <div
      ref={surfaceRef}
      className="wi-sheet"
      role="application"
      tabIndex={0}
      aria-label="Ink sheet. A brush draws here by itself; draw with a mouse, finger or pen to take it over. Press Enter for the next drawing, Backspace to clear."
      onKeyDown={onKeyDown}
    >
      <div ref={hostRef} className="wi-paper" />
      <span ref={nibRef} className="wi-nib" data-visible="false" data-down="false" aria-hidden="true" />
    </div>
  );
}
