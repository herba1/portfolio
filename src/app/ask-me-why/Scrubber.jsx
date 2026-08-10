"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

const PLAYED = "#1a1a1a";
const AHEAD = "#cbd5e1";
const ONSET = "#a05ac8";
const HEAD = "#dc2626";

const Scrubber = forwardRef(function Scrubber(
  { peaks, durationMs, lineOnsets, driftMs, height = 56, onSeek, onScrubbing },
  ref,
) {
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const posRef = useRef(0);
  const sizeRef = useRef({ w: 0 });
  const [dragging, setDragging] = useState(false);

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
    sizeRef.current = { w };
  }, [height]);

  const draw = useCallback(
    (ms) => {
      if (ms != null) posRef.current = ms;
      const canvas = canvasRef.current;
      const { w } = sizeRef.current;
      if (!canvas || !w || !durationMs) return;

      const ctx = canvas.getContext("2d");
      const h = height;
      ctx.clearRect(0, 0, w, h);

      const mid = h / 2;
      const headX = (posRef.current / durationMs) * w;

      if (peaks) {
        const step = Math.max(1, Math.floor(peaks.data.length / w));
        for (let x = 0; x < w; x++) {
          let peak = 0;
          const i = x * step;
          for (let j = i; j < Math.min(peaks.data.length, i + step); j++) {
            if (peaks.data[j] > peak) peak = peaks.data[j];
          }
          const amp = Math.max(0.6, peak * (mid - 4));
          ctx.strokeStyle = x <= headX ? PLAYED : AHEAD;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, mid - amp);
          ctx.lineTo(x + 0.5, mid + amp);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = AHEAD;
        ctx.beginPath();
        ctx.moveTo(0, mid + 0.5);
        ctx.lineTo(w, mid + 0.5);
        ctx.stroke();
      }

      ctx.strokeStyle = ONSET;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (const onset of lineOnsets || []) {
        const x = ((onset - driftMs) / durationMs) * w;
        if (x < 0 || x > w) continue;
        ctx.moveTo(x, h - 8);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = HEAD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(headX, 0);
      ctx.lineTo(headX, h);
      ctx.stroke();
    },
    [peaks, durationMs, lineOnsets, driftMs, height],
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

  const msFromEvent = useCallback(
    (clientX) => {
      const rect = boxRef.current.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * durationMs;
    },
    [durationMs],
  );

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onScrubbing?.(true);
    const ms = msFromEvent(e.clientX);
    draw(ms);
    onSeek?.(ms);
  };

  const move = (e) => {
    if (!dragging) return;
    const ms = msFromEvent(e.clientX);
    draw(ms);
    onSeek?.(ms);
  };

  const up = (e) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    onScrubbing?.(false);
  };

  return (
    <div
      ref={boxRef}
      className="scrub"
      data-dragging={dragging}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <canvas ref={canvasRef} />
    </div>
  );
});

export default Scrubber;
