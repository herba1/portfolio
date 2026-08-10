"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

const INK = "#1a1a1a";
const RAIL = "#cbd5e1";
const ONSET = "#2563eb";
const LINE_ONSET = "#a05ac8";
const HEAD = "#dc2626";

const AlignmentScope = forwardRef(function AlignmentScope(
  { peaks, windowMs, wordOnsets, lineOnsets, driftMs, height = 96, headAt = 0.5, onSeek },
  ref,
) {
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const centerRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: height });

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = box.clientWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeRef.current = { w, h: height };
  }, [height]);

  const draw = useCallback(
    (centerMs) => {
      if (centerMs != null) centerRef.current = centerMs;
      const canvas = canvasRef.current;
      const { w, h } = sizeRef.current;
      if (!canvas || !w) return;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);

      const center = centerRef.current;
      const startMs = center - windowMs * headAt;
      const mid = h / 2;
      const toX = (ms) => ((ms - startMs) / windowMs) * w;

      ctx.strokeStyle = RAIL;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(w, mid + 0.5);
      ctx.stroke();

      if (peaks) {
        const step = Math.max(1, Math.round((windowMs / w / 1000) * peaks.rate));
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const ms = startMs + (x / w) * windowMs;
          const i = Math.round((ms / 1000) * peaks.rate);
          if (i < 0 || i >= peaks.data.length) continue;
          let peak = 0;
          for (let j = i; j < Math.min(peaks.data.length, i + step); j++) {
            if (peaks.data[j] > peak) peak = peaks.data[j];
          }
          const amp = peak * (mid - 6);
          ctx.moveTo(x + 0.5, mid - amp);
          ctx.lineTo(x + 0.5, mid + amp);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = LINE_ONSET;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const ms of lineOnsets || []) {
        const x = toX(ms - driftMs);
        if (x < -2 || x > w + 2) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();

      ctx.strokeStyle = ONSET;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const ms of wordOnsets || []) {
        const x = toX(ms - driftMs);
        if (x < -2 || x > w + 2) continue;
        ctx.moveTo(x, mid - 14);
        ctx.lineTo(x, mid + 14);
      }
      ctx.stroke();

      const headX = toX(center);
      ctx.strokeStyle = HEAD;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(headX, 0);
      ctx.lineTo(headX, h);
      ctx.stroke();
    },
    [peaks, windowMs, wordOnsets, lineOnsets, driftMs, headAt],
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);

  useEffect(() => {
    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [resize, draw]);

  const click = (e) => {
    if (!onSeek) return;
    const rect = boxRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(centerRef.current - windowMs * headAt + ratio * windowMs);
  };

  return (
    <div ref={boxRef} className="scope" onClick={click}>
      <canvas ref={canvasRef} />
    </div>
  );
});

export default AlignmentScope;
