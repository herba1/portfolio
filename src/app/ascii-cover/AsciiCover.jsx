"use client";

import { useEffect, useRef, useState } from "react";

import useCovers from "@/app/ui/useCovers";
import "./ascii-cover.css";

const TAU = Math.PI * 2;
const RAMP = " .,:;-~=+*#%@";
const COLUMNS = 64;
const CELL_RATIO = 1.7;
const EDGE_THRESHOLD = 0.36;
const INK_MIX = 0.62;
const WAVE_PX_PER_MS = 0.9;
const WAVE_FRONT_PX = 260;
const WAVE_RINGS = 12;
const WAVE_ALPHA = 0.2;
const WAVE_WARP = 0.045;

function smooth(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function sampleGrid(element, columns, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(element, 0, 0, columns, rows);
  return context.getImageData(0, 0, columns, rows).data;
}

function edgeChar(gx, gy) {
  const angle = (Math.atan2(gy, gx) * 180) / Math.PI;
  const folded = ((angle % 180) + 180) % 180;
  if (folded < 22.5 || folded >= 157.5) return "|";
  if (folded < 67.5) return "\\";
  if (folded < 112.5) return "-";
  return "/";
}

function inkFor(red, green, blue, light) {
  if (light > 0.55) return `rgb(${Math.round(red * (1 - INK_MIX))} ${Math.round(green * (1 - INK_MIX))} ${Math.round(blue * (1 - INK_MIX))})`;
  return `rgb(${Math.round(red + (255 - red) * INK_MIX)} ${Math.round(green + (255 - green) * INK_MIX)} ${Math.round(blue + (255 - blue) * INK_MIX)})`;
}

function buildCells(data, columns, rows, mode, title) {
  const letters = title.replace(/\s+/g, "");
  const lights = [];
  for (let index = 0; index < columns * rows; index += 1) {
    const at = index * 4;
    lights.push((0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255);
  }
  const lightAt = (column, row) => lights[Math.min(rows - 1, Math.max(0, row)) * columns + Math.min(columns - 1, Math.max(0, column))];
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const at = index * 4;
      const red = data[at];
      const green = data[at + 1];
      const blue = data[at + 2];
      const light = lights[index];
      const gx = lightAt(column + 1, row) - lightAt(column - 1, row);
      const gy = lightAt(column, row + 1) - lightAt(column, row - 1);
      let char = RAMP[Math.min(RAMP.length - 1, Math.floor((1 - light) * RAMP.length))];
      if (mode === "title") char = letters[index % letters.length];
      else if (Math.hypot(gx, gy) > EDGE_THRESHOLD) char = edgeChar(gx, gy);
      cells.push({ char, bg: `rgb(${red} ${green} ${blue})`, ink: inkFor(red, green, blue, light) });
    }
  }
  return cells;
}

export default function AsciiCover({ covers = [], embedded = false }) {
  const items = useCovers(covers);
  const canvasRef = useRef(null);
  const [hero, setHero] = useState(0);
  const mode = "symbols";
  const memory = useRef({ layer: null, hero: -1, mode: "", side: 0, clickX: 0, clickY: 0 });
  const cache = useRef(new Map());

  useEffect(() => {
    if (!items.length) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const state = { width: 0, height: 0, ratio: 1, side: 0, left: 0, top: 0, rowsHeight: 0, layer: null, transition: null, frame: 0, idle: 0 };

    const layerFor = (index) => {
      const key = `${index}|${mode}|${state.side}|${state.ratio}|${state.width}x${state.height}`;
      const hit = cache.current.get(key);
      if (hit) return hit;
      const cellWidth = state.side / COLUMNS;
      const cellHeight = cellWidth * CELL_RATIO;
      const rows = Math.floor(state.side / cellHeight);
      const left = (state.width - state.side) / 2;
      const top = (state.height - rows * cellHeight) / 2;
      const cells = buildCells(sampleGrid(items[index].element, COLUMNS, rows), COLUMNS, rows, mode, items[index].title);
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const layerContext = layer.getContext("2d");
      layerContext.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
      layerContext.font = `600 ${cellHeight * 0.9}px ${getComputedStyle(canvas).fontFamily}`;
      layerContext.textBaseline = "top";
      cells.forEach((cell, at) => {
        const x = left + (at % COLUMNS) * cellWidth;
        const y = top + Math.floor(at / COLUMNS) * cellHeight;
        layerContext.fillStyle = cell.bg;
        layerContext.fillRect(x, y, cellWidth + 0.5, cellHeight + 0.5);
        if (cell.char !== " ") {
          layerContext.fillStyle = cell.ink;
          layerContext.fillText(cell.char, x, y);
        }
      });
      cache.current.set(key, layer);
      return layer;
    };

    const showStill = (layer) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
    };

    const drawWave = (time) => {
      const { transition, width, height } = state;
      const front = (time - transition.start) * WAVE_PX_PER_MS;
      const reach = Math.max(
        Math.hypot(transition.x, transition.y),
        Math.hypot(width - transition.x, transition.y),
        Math.hypot(transition.x, height - transition.y),
        Math.hypot(width - transition.x, height - transition.y),
      );
      if (front - WAVE_FRONT_PX > reach) {
        state.transition = null;
        showStill(state.layer);
        return;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(transition.from, 0, 0);
      ctx.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
      const step = WAVE_FRONT_PX / WAVE_RINGS;
      for (let ring = 0; ring < WAVE_RINGS; ring += 1) {
        const radius = front - ring * step;
        if (radius <= 0) continue;
        const warp = 1 + WAVE_WARP * (1 - ring / WAVE_RINGS);
        ctx.save();
        ctx.beginPath();
        ctx.rect(state.left, state.top, state.side, state.rowsHeight);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(transition.x, transition.y, radius, 0, TAU);
        ctx.clip();
        ctx.globalAlpha = WAVE_ALPHA;
        ctx.translate(transition.x, transition.y);
        ctx.scale(warp, warp);
        ctx.translate(-transition.x, -transition.y);
        ctx.drawImage(state.layer, 0, 0, width, height);
        ctx.restore();
      }
      const solid = front - WAVE_FRONT_PX;
      if (solid > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(state.left, state.top, state.side, state.rowsHeight);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(transition.x, transition.y, solid, 0, TAU);
        ctx.clip();
        ctx.drawImage(state.layer, 0, 0, width, height);
        ctx.restore();
      }
    };

    const loop = (time) => {
      drawWave(time);
      state.frame = state.transition ? requestAnimationFrame(loop) : 0;
    };

    const prebuild = () => {
      const next = (hero + 1) % items.length;
      state.idle = window.setTimeout(() => layerFor(next), 120);
    };

    const rebuild = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      state.ratio = ratio;
      state.width = canvas.clientWidth;
      state.height = canvas.clientHeight;
      const pixelWidth = Math.round(state.width * ratio);
      const pixelHeight = Math.round(state.height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      state.side = Math.floor(Math.min(state.width, state.height));
      if (state.side < 1) return;
      const rowHeight = (state.side / COLUMNS) * CELL_RATIO;
      const rows = Math.floor(state.side / rowHeight);
      state.rowsHeight = rows * rowHeight;
      state.left = (state.width - state.side) / 2;
      state.top = (state.height - state.rowsHeight) / 2;
      state.layer = layerFor(hero);
      const previous = memory.current;
      if (previous.layer && previous.hero !== hero && previous.mode === mode && previous.side === state.side) {
        state.transition = { from: previous.layer, start: performance.now(), x: previous.clickX, y: previous.clickY };
      }
      memory.current = { ...previous, layer: state.layer, hero, mode, side: state.side };
      if (state.transition) {
        drawWave(state.transition.start);
        if (!state.frame) state.frame = requestAnimationFrame(loop);
      } else {
        showStill(state.layer);
      }
      clearTimeout(state.idle);
      prebuild();
    };

    rebuild();
    const resizeObserver = new ResizeObserver(rebuild);
    resizeObserver.observe(canvas);
    return () => {
      cancelAnimationFrame(state.frame);
      clearTimeout(state.idle);
      resizeObserver.disconnect();
    };
  }, [items, hero]);

  return (
    <div className="ac" data-embedded={embedded || undefined}>
      <canvas
        ref={canvasRef}
        className="ac__canvas"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          memory.current.clickX = event.clientX - rect.left;
          memory.current.clickY = event.clientY - rect.top;
          setHero((current) => (current + 1) % Math.max(items.length, 1));
        }}
        role="img"
        aria-label="A cover drawn in characters. Click for the next one."
      />
    </div>
  );
}
