"use client";

import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;
const CANVAS_PX = 28;
const GLYPH_PX = 16;
const BITMAP_RATIO = 6;
const LAP_S = 2;
const EASE_RATE = 8;
const FOCAL = 3.4;
const SHIMMER_BASE_ALPHA = 0.8;
const MODE_REPAINT_MS = 700;

const LENS = { x: -0.13, y: -0.13, r: 0.44 };
const HANDLE = { from: 0.2, to: 0.7 };
const STROKE = 0.15;
const GLYPH_UNIT_SCALE = 1.18;
const RING_STEPS = 40;

function rotate([x, y, z], ax, ay, az) {
  let c = Math.cos(ax);
  let s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay);
  s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az);
  s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function project([x, y, z], unit) {
  const k = FOCAL / (FOCAL - z);
  return [x * k * unit, y * k * unit, k];
}

function parseColor(value) {
  const [r, g, b] = (value.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
  return [r, g, b];
}

function pose(time, amount) {
  const a = (time * TAU) / LAP_S;
  return {
    shift: [Math.cos(a) * 0.24 * amount, Math.sin(a) * 0.14 * amount, Math.sin(a) * 0.6 * amount],
    ay: -Math.sin(a) * 1.2 * amount,
    ax: Math.cos(a) * 0.32 * amount,
    az: Math.cos(a) * 0.2 * amount,
    lens: 1 - 0.14 * amount,
    shimmer: (time / LAP_S) * 1.3,
  };
}

function paint(context, size, color, time, amount) {
  const unit = (GLYPH_PX / 2) * GLYPH_UNIT_SCALE;
  const { shift, ay, ax, az, lens, shimmer } = pose(time, amount);
  const place = (point) => {
    const rotated = rotate([point[0] * lens, point[1] * lens, 0], ax, ay, az);
    return project([rotated[0] + shift[0], rotated[1] + shift[1], rotated[2] + shift[2]], unit);
  };

  context.setTransform(BITMAP_RATIO, 0, 0, BITMAP_RATIO, (size * BITMAP_RATIO) / 2, (size * BITMAP_RATIO) / 2);
  context.clearRect(-size, -size, size * 2, size * 2);

  const [red, green, blue] = color;
  const sweep = ((shimmer % 1.6) - 0.3) * 2 - 1;
  const gradient = context.createLinearGradient(-unit, -unit, unit, unit);
  const band = (offset, alpha) =>
    gradient.addColorStop(Math.min(1, Math.max(0, 0.5 + sweep * 0.5 + offset)), `rgba(${red}, ${green}, ${blue}, ${alpha})`);
  if (amount < 0.02) {
    context.strokeStyle = `rgba(${red}, ${green}, ${blue}, 1)`;
  } else {
    const base = SHIMMER_BASE_ALPHA + (1 - SHIMMER_BASE_ALPHA) * (1 - amount);
    gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${base})`);
    band(-0.22, base);
    band(0, 1);
    band(0.22, base);
    gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, ${base})`);
    context.strokeStyle = gradient;
  }

  context.lineCap = "round";
  context.lineJoin = "round";

  const ring = [];
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * TAU;
    ring.push(place([LENS.x + Math.cos(angle) * LENS.r, LENS.y + Math.sin(angle) * LENS.r]));
  }
  const ringScale = ring.reduce((sum, q) => sum + q[2], 0) / ring.length;
  context.lineWidth = unit * STROKE * ringScale;
  context.beginPath();
  ring.forEach((q, i) => (i ? context.lineTo(q[0], q[1]) : context.moveTo(q[0], q[1])));
  context.closePath();
  context.stroke();

  const a = place([HANDLE.from, HANDLE.from]);
  const b = place([HANDLE.to, HANDLE.to]);
  context.lineWidth = unit * STROKE * ((a[2] + b[2]) / 2);
  context.beginPath();
  context.moveTo(a[0], a[1]);
  context.lineTo(b[0], b[1]);
  context.stroke();
}

export default function SearchGlyph({ busy, mode }) {
  const canvasRef = useRef(null);
  const busyRef = useRef(busy);
  const frameRef = useRef(0);
  const amountRef = useRef(0);
  const repaintUntilRef = useRef(0);
  const wakeRef = useRef(null);

  busyRef.current = busy;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let previous = 0;

    const draw = (now) => {
      const color = parseColor(getComputedStyle(canvas).color);
      paint(context, CANVAS_PX, color, now / 1000, amountRef.current);
    };

    const loop = (now) => {
      const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0.016;
      previous = now;
      const target = busyRef.current && !reduced ? 1 : 0;
      amountRef.current += (target - amountRef.current) * (1 - Math.exp(-EASE_RATE * dt));
      if (!target && amountRef.current < 0.004) amountRef.current = 0;
      draw(now);
      const settled = !target && amountRef.current === 0 && now > repaintUntilRef.current;
      if (settled) {
        frameRef.current = 0;
        previous = 0;
        return;
      }
      frameRef.current = requestAnimationFrame(loop);
    };

    wakeRef.current = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(loop);
    };
    wakeRef.current();
    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, []);

  useEffect(() => {
    wakeRef.current?.();
  }, [busy]);

  useEffect(() => {
    repaintUntilRef.current = performance.now() + MODE_REPAINT_MS;
    wakeRef.current?.();
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className="bd-dock__glyph"
      width={CANVAS_PX * BITMAP_RATIO}
      height={CANVAS_PX * BITMAP_RATIO}
      aria-hidden="true"
    />
  );
}
