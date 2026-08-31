export const GRID = 6;
export const CELL_COUNT = GRID * GRID;

const BASE = 100 / GRID;
const CELL = BASE * 0.82;
const CENTER = (GRID - 1) / 2;

const HUES = ["var(--btjb-a)", "var(--btjb-b)", "var(--btjb-c)", "var(--btjb-d)"];

function rc(i) {
  return { row: Math.floor(i / GRID), col: i % GRID };
}

function centerPct(row, col) {
  return { left: ((col + 0.5) / GRID) * 100, top: ((row + 0.5) / GRID) * 100 };
}

function identityCell(i, overrides = {}) {
  const { row, col } = rc(i);
  return {
    ...centerPct(row, col),
    size: CELL,
    color: HUES[0],
    opacity: 1,
    delay: 0,
    ...overrides,
  };
}

const LAYOUTS = [
  (i) => identityCell(i, i % 3 === 2 ? { size: 0, opacity: 0 } : { size: CELL * 1.28 }),

  (i) => {
    const { row, col } = rc(i);
    return { ...centerPct(col, GRID - 1 - row), size: CELL, color: HUES[1], opacity: 1, delay: 0 };
  },

  (i) => {
    const { row, col } = rc(i);
    const dx = col - CENTER;
    const dy = row - CENTER;
    const maxD = Math.sqrt(2) * CENTER;
    const d = Math.sqrt(dx * dx + dy * dy) / maxD;
    const ring = Math.min(3, Math.floor(d * 4));
    return identityCell(i, { color: HUES[3 - ring] });
  },

  (i) => {
    const { row, col } = rc(i);
    const blockRow = Math.floor(row / 2);
    const blockCol = Math.floor(col / 2);
    const block = { left: ((blockCol * 2 + 1) / GRID) * 100, top: ((blockRow * 2 + 1) / GRID) * 100 };
    const survivor = row % 2 === 0 && col % 2 === 0;
    return {
      ...block,
      size: survivor ? CELL * 1.9 : 0,
      color: HUES[2],
      opacity: survivor ? 1 : 0,
      delay: 0,
    };
  },

  (i) => {
    const { col } = rc(i);
    const band = Math.min(3, Math.floor((col * 4) / GRID));
    return identityCell(i, { color: HUES[band] });
  },

  (i) => {
    const { row, col } = rc(i);
    const band = (row < GRID / 2 ? 0 : 2) + (col < GRID / 2 ? 0 : 1);
    return identityCell(i, { color: HUES[band] });
  },

  (i) => {
    const { row, col } = rc(i);
    const d = Math.max(Math.abs(row - CENTER), Math.abs(col - CENTER));
    const ring = d < 1 ? 0 : d < 2 ? 1 : 2;
    const scale = [1.32, 1, 0.62][ring];
    const opacity = [1, 0.9, 0.72][ring];
    const color = [HUES[3], HUES[2], HUES[0]][ring];
    return identityCell(i, { size: CELL * scale, opacity, color });
  },

  (i) => identityCell(i, { color: HUES[3] }),

  (i) => identityCell(i, { color: HUES[1], delay: i * 14 }),

  (i) => identityCell(i, { color: HUES[3] }),
];

export function layoutForTip(tipIndex) {
  const layout = LAYOUTS[tipIndex] ?? LAYOUTS[0];
  return Array.from({ length: CELL_COUNT }, (_, i) => layout(i));
}

export const TIPS = [
  {
    n: 1,
    title: "Keep the scale sane",
    blurb: "Work in real-world units in Blender, so glTF's meter-based export never fights your camera or your physics.",
  },
  {
    n: 2,
    title: "Match your axes, once",
    blurb: "Blender is Z-up, Three.js is Y-up — let the exporter make the turn so you never bake it into a mesh by hand.",
  },
  {
    n: 3,
    title: "Bake what doesn't move",
    blurb: "Static light becomes a lightmap in Cycles, so Three.js can skip real-time shadows on anything that never moves.",
  },
  {
    n: 4,
    title: "Let Draco carry the geometry",
    blurb: "Draco compression shrinks vertex data by an order of magnitude with no loss you'd see at render size.",
  },
  {
    n: 5,
    title: "Compress textures separately",
    blurb: "KTX2 with Basis Universal keeps textures small on disk and small on the GPU — a JPEG only ever wins one of those.",
  },
  {
    n: 6,
    title: "One atlas beats twenty textures",
    blurb: "Merge materials in Blender before export, so Three.js opens one draw call instead of a dozen.",
  },
  {
    n: 7,
    title: "Ship LODs, not one hero mesh",
    blurb: "A decimate modifier makes the cheap stand-ins Three.js can swap in as an object recedes from camera.",
  },
  {
    n: 8,
    title: "Instance the repeats",
    blurb: "Anything that repeats in Blender — bolts, leaves, crates — becomes one InstancedMesh, not a thousand draw calls.",
  },
  {
    n: 9,
    title: "Let the agent do the boring part",
    blurb: "Blender MCP scripts the export, the naming and the cleanup, so the fiddly half of the pipeline runs itself.",
  },
  {
    n: 10,
    title: "Round-trip, then iterate",
    blurb: "Bring the Three.js render back into Blender as reference and go again — the pipeline is a loop, not a one-way trip.",
  },
];

export const SPEEDS = [
  { id: "slow", label: "Slow", ms: 3600 },
  { id: "normal", label: "Normal", ms: 2200 },
  { id: "fast", label: "Fast", ms: 1200 },
];

export const DEFAULT_SPEED = "normal";
