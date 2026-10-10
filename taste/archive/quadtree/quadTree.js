export const SIDE = 512;
export const MAX_LEVEL = 9;
export const ROW = SIDE + 1;

export const LEVEL_OFFSET = (() => {
  const offsets = new Int32Array(MAX_LEVEL + 2);
  let total = 0;
  for (let level = 0; level <= MAX_LEVEL + 1; level += 1) {
    offsets[level] = total;
    total += 4 ** level;
  }
  return offsets;
})();

export const NODE_COUNT = LEVEL_OFFSET[MAX_LEVEL + 1];

export function nodeIndex(level, x, y) {
  return LEVEL_OFFSET[level] + y * (1 << level) + x;
}

function waitForIdle() {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 80 });
    else setTimeout(resolve, 0);
  });
}

function readPixels(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const crop = Math.min(width, height);
  context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, SIDE, SIDE);
  return context.getImageData(0, 0, SIDE, SIDE).data;
}

export function fillRows(tables, pixels, fromRow, toRow) {
  const { red, green, blue, squares } = tables;
  for (let y = fromRow; y < toRow; y += 1) {
    let rowRed = 0;
    let rowGreen = 0;
    let rowBlue = 0;
    let rowSquares = 0;
    const above = y * ROW;
    const here = (y + 1) * ROW;
    for (let x = 0; x < SIDE; x += 1) {
      const at = (y * SIDE + x) * 4;
      const r = pixels[at];
      const g = pixels[at + 1];
      const b = pixels[at + 2];
      rowRed += r;
      rowGreen += g;
      rowBlue += b;
      rowSquares += r * r + g * g + b * b;
      const cell = x + 1;
      red[here + cell] = red[above + cell] + rowRed;
      green[here + cell] = green[above + cell] + rowGreen;
      blue[here + cell] = blue[above + cell] + rowBlue;
      squares[here + cell] = squares[above + cell] + rowSquares;
    }
  }
}

export function createTables() {
  const size = ROW * ROW;
  return {
    red: new Uint32Array(size),
    green: new Uint32Array(size),
    blue: new Uint32Array(size),
    squares: new Float64Array(size),
  };
}

export async function buildSource(src) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.src = src;
  await image.decode();
  const pixels = readPixels(image);
  const tables = createTables();
  await waitForIdle();
  fillRows(tables, pixels, 0, SIDE / 2);
  await waitForIdle();
  fillRows(tables, pixels, SIDE / 2, SIDE);
  const stats = new Float64Array(4);
  regionStats(tables, 0, 0, 0, stats);
  return { src, tables, mean: [stats[0], stats[1], stats[2]] };
}

export function regionStats(tables, level, x, y, out) {
  const span = SIDE >> level;
  const left = x * span;
  const top = y * span;
  const a = top * ROW + left;
  const b = a + span;
  const c = a + span * ROW;
  const d = c + span;
  const area = span * span;
  const { red, green, blue, squares } = tables;
  const meanRed = (red[d] - red[b] - red[c] + red[a]) / area;
  const meanGreen = (green[d] - green[b] - green[c] + green[a]) / area;
  const meanBlue = (blue[d] - blue[b] - blue[c] + blue[a]) / area;
  const meanSquares = (squares[d] - squares[b] - squares[c] + squares[a]) / area;
  const variance = meanSquares - meanRed * meanRed - meanGreen * meanGreen - meanBlue * meanBlue;
  out[0] = meanRed / 255;
  out[1] = meanGreen / 255;
  out[2] = meanBlue / 255;
  out[3] = Math.sqrt(Math.max(0, variance / 3));
  return out;
}

export function createSplitHeap(capacity) {
  const level = new Uint8Array(capacity);
  const column = new Uint16Array(capacity);
  const row = new Uint16Array(capacity);
  const priority = new Float64Array(capacity);
  let size = 0;

  const swap = (i, j) => {
    const l = level[i];
    const c = column[i];
    const r = row[i];
    const p = priority[i];
    level[i] = level[j];
    column[i] = column[j];
    row[i] = row[j];
    priority[i] = priority[j];
    level[j] = l;
    column[j] = c;
    row[j] = r;
    priority[j] = p;
  };

  return {
    get size() {
      return size;
    },
    clear() {
      size = 0;
    },
    push(l, x, y, p) {
      if (size >= capacity) return;
      let i = size;
      size += 1;
      level[i] = l;
      column[i] = x;
      row[i] = y;
      priority[i] = p;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (priority[parent] >= priority[i]) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop(out) {
      out[0] = level[0];
      out[1] = column[0];
      out[2] = row[0];
      out[3] = priority[0];
      size -= 1;
      if (size > 0) {
        level[0] = level[size];
        column[0] = column[size];
        row[0] = row[size];
        priority[0] = priority[size];
        let i = 0;
        for (;;) {
          const left = i * 2 + 1;
          const right = left + 1;
          let largest = i;
          if (left < size && priority[left] > priority[largest]) largest = left;
          if (right < size && priority[right] > priority[largest]) largest = right;
          if (largest === i) break;
          swap(i, largest);
          i = largest;
        }
      }
      return out;
    },
  };
}

const restStats = new Float64Array(4);
const popped = new Float64Array(4);
const FLAT_ERROR = 2.5;

export function buildRestTree(tables, restSplit, { splits, areaPower, maxLevel }) {
  restSplit.fill(0);
  const heap = createSplitHeap(splits * 3 + 8);
  const priorityOf = (level, x, y) => {
    regionStats(tables, level, x, y, restStats);
    if (restStats[3] < FLAT_ERROR) return 0;
    const span = SIDE >> level;
    return restStats[3] * Math.pow(span * span, areaPower);
  };
  heap.push(0, 0, 0, priorityOf(0, 0, 0));
  let done = 0;
  while (done < splits && heap.size > 0) {
    heap.pop(popped);
    const level = popped[0];
    const x = popped[1];
    const y = popped[2];
    if (popped[3] <= 0) break;
    restSplit[nodeIndex(level, x, y)] = 1;
    done += 1;
    const childLevel = level + 1;
    if (childLevel >= maxLevel) continue;
    for (let i = 0; i < 4; i += 1) {
      const cx = x * 2 + (i & 1);
      const cy = y * 2 + (i >> 1);
      const priority = priorityOf(childLevel, cx, cy);
      if (priority > 0) heap.push(childLevel, cx, cy, priority);
    }
  }
  return done;
}
