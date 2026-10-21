export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

function bounds(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function chaikin(pts, rounds) {
  let out = pts;
  for (let r = 0; r < rounds; r += 1) {
    if (out.length < 3) return out;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i += 1) {
      const [ax, ay] = out[i];
      const [bx, by] = out[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function trimHead(pts) {
  const start = pts[0];
  let far = 0;
  let farIndex = pts.length - 1;
  pts.forEach(([x, y], i) => {
    const d = Math.hypot(x - start[0], y - start[1]);
    if (d > far) {
      far = d;
      farIndex = i;
    }
  });
  const end = pts[pts.length - 1];
  const back = far - Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (back > far * 0.08 && farIndex > pts.length * 0.5) return pts.slice(0, farIndex + 1);
  return pts;
}

function lineAt(layout, y) {
  let best = null;
  let bestD = Infinity;
  for (const line of layout.lines) {
    const mid = (line.top + line.bottom) / 2;
    const d = Math.abs(y - mid);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  return best;
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1, a1 - a0);
}

function wordsInRange(layout, lineId, x0, x1) {
  return layout.words.filter((w) => w.line === lineId && overlap(w.left, w.right, x0, x1) >= 0.5).map((w) => w.id);
}

function nearestWord(layout, x, y, reach) {
  let best = null;
  let bestD = reach;
  for (const w of layout.words) {
    const dx = Math.max(w.left - x, 0, x - w.right);
    const dy = Math.max(w.top - y, 0, y - w.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

export function recognize(raw, layout) {
  if (raw.length < 2) return null;
  const pts = raw.map((p) => [p[0], p[1]]);
  const length = pathLength(pts);
  if (length < 14) return null;
  const box = bounds(pts);
  const start = pts[0];
  const end = pts[pts.length - 1];
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const size = Math.max(box.w, box.h);
  const W = layout.width;
  const H = layout.height;

  if (chord < size * 0.32 && length > size * 2.2 && box.w > 16 && box.h > 10) {
    const ids = layout.words
      .filter((w) => {
        const cy = (w.top + w.bottom) / 2;
        return overlap(w.left, w.right, box.minX, box.maxX) >= 0.6 && cy > box.minY && cy < box.maxY;
      })
      .map((w) => w.id);
    if (ids.length) return { type: "circle", words: ids };
    return { type: "loop", box: [box.minX / W, box.minY / H, box.maxX / W, box.maxY / H] };
  }

  const trimmed = trimHead(pts);
  const tEnd = trimmed[trimmed.length - 1];
  const tChord = Math.hypot(tEnd[0] - start[0], tEnd[1] - start[1]);
  const tLength = pathLength(trimmed);
  const straight = tChord / Math.max(1, tLength);
  const angle = Math.atan2(tEnd[1] - start[1], tEnd[0] - start[0]);
  const horizontal = Math.abs(Math.sin(angle)) < 0.34;
  const vertical = Math.abs(Math.cos(angle)) < 0.42;
  const arrowHead = trimmed.length < pts.length - 2;

  if (straight > 0.86 && horizontal && !arrowHead) {
    const midY = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
    const line = lineAt(layout, midY);
    if (line) {
      const h = line.bottom - line.top;
      const rel = (midY - line.top) / h;
      const ids = wordsInRange(layout, line.id, box.minX, box.maxX);
      if (ids.length && rel > 0.22 && rel < 0.68) return { type: "strike", words: ids };
      if (ids.length && rel >= 0.68 && rel < 1.45) return { type: "underline", words: ids };
    }
  }

  if (straight > 0.8 && vertical && !arrowHead && box.h > 20) {
    const inLeft = box.maxX < layout.textLeft + 6;
    const inRight = box.minX > layout.textRight - 40;
    if (inLeft || inRight) {
      const covered = layout.lines.filter((l) => l.bottom > box.minY + 4 && l.top < box.maxY - 4);
      if (covered.length) {
        return { type: "bracket", lines: [covered[0].id, covered[covered.length - 1].id], side: inLeft ? "left" : "right" };
      }
    }
  }

  if (tChord > 36 && straight > 0.55) {
    let bend = 0;
    const nx = -(tEnd[1] - start[1]) / tChord;
    const ny = (tEnd[0] - start[0]) / tChord;
    for (const [x, y] of trimmed) {
      const d = (x - start[0]) * nx + (y - start[1]) * ny;
      if (Math.abs(d) > Math.abs(bend)) bend = d;
    }
    const word = nearestWord(layout, start[0], start[1], 14);
    const from = word
      ? { word: word.id, fx: (start[0] - word.left) / Math.max(1, word.right - word.left), fy: (start[1] - word.top) / Math.max(1, word.bottom - word.top) }
      : { x: start[0] / W, y: start[1] / H };
    return { type: "arrow", from, to: { x: tEnd[0] / W, y: tEnd[1] / H }, bend: Math.max(-0.4, Math.min(0.4, bend / tChord)) };
  }

  return { type: "free", pts: chaikin(pts, 2).map(([x, y]) => [x / W, y / H]) };
}

function unionBox(layout, ids) {
  const words = layout.words.filter((w) => ids.includes(w.id));
  if (!words.length) return null;
  return {
    left: Math.min(...words.map((w) => w.left)),
    right: Math.max(...words.map((w) => w.right)),
    top: Math.min(...words.map((w) => w.top)),
    bottom: Math.max(...words.map((w) => w.bottom)),
  };
}

function hline(x0, x1, y, rnd, sag, steps = 14) {
  const out = [];
  const slope = (rnd() - 0.5) * 2.4;
  const phase = rnd() * 6;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push([x0 + (x1 - x0) * t, y + slope * (t - 0.5) + Math.sin(t * Math.PI) * sag + Math.sin(phase + t * 5) * 0.5]);
  }
  return out;
}

export function geometry(spec, layout, seed) {
  const rnd = mulberry(seed);
  const W = layout.width;
  const H = layout.height;
  if (spec.type === "underline" || spec.type === "strike") {
    const box = unionBox(layout, spec.words);
    if (!box) return null;
    const h = box.bottom - box.top;
    const y = spec.type === "underline" ? box.bottom - h * 0.12 + 2 : box.top + h * 0.56;
    const x0 = box.left - 4 - rnd() * 3;
    const x1 = box.right + 4 + rnd() * 4;
    const strokes = [hline(x0, x1, y, rnd, spec.type === "underline" ? 1.4 : -0.6)];
    return { strokes };
  }
  if (spec.type === "circle" || spec.type === "loop") {
    let box;
    if (spec.type === "circle") box = unionBox(layout, spec.words);
    else box = { left: spec.box[0] * W, top: spec.box[1] * H, right: spec.box[2] * W, bottom: spec.box[3] * H };
    if (!box) return null;
    const h = box.bottom - box.top;
    const cx = (box.left + box.right) / 2;
    const cy = box.top + h * 0.56;
    const rx = (box.right - box.left) / 2 + 7 + h * 0.22;
    const ry = h * 0.46 + 4 + Math.min(10, (box.right - box.left) * 0.03);
    const start = -2.5 + rnd() * 0.5;
    const turns = 1.1 + rnd() * 0.06;
    const steps = 48;
    const phase = rnd() * 6;
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const a = start + t * Math.PI * 2 * turns;
      const grow = 1 + (t - 0.5) * 0.08;
      const wob = 1 + Math.sin(a * 2 + phase) * 0.035;
      pts.push([cx + Math.cos(a) * rx * grow * wob, cy + Math.sin(a) * ry * grow * wob - t * 1.5]);
    }
    return { strokes: [pts] };
  }
  if (spec.type === "bracket") {
    const lines = layout.lines.filter((l) => l.id >= spec.lines[0] && l.id <= spec.lines[1]);
    if (!lines.length) return null;
    const top = lines[0].top + 2;
    const bottom = lines[lines.length - 1].bottom - 2;
    const left = spec.side === "left";
    const x = left ? layout.textLeft - 20 : Math.max(...lines.map((l) => l.right)) + 22;
    const dir = left ? 1 : -1;
    const tick = 9;
    const lean = (rnd() - 0.5) * 2;
    return {
      strokes: [
        [
          [x + dir * tick, top - 1],
          [x + dir * 2, top],
          [x, top + 4],
          [x + lean * 0.5, (top + bottom) / 2],
          [x + lean, bottom - 4],
          [x + dir * 2 + lean, bottom],
          [x + dir * tick + lean, bottom + 1],
        ],
      ],
    };
  }
  if (spec.type === "arrow") {
    let sx;
    let sy;
    if (spec.from.word !== undefined) {
      const w = layout.words.find((word) => word.id === spec.from.word);
      if (!w) return null;
      sx = w.left + (w.right - w.left) * spec.from.fx;
      sy = w.top + (w.bottom - w.top) * spec.from.fy;
    } else {
      sx = spec.from.x * W;
      sy = spec.from.y * H;
    }
    const ex = spec.to.x * W;
    const ey = spec.to.y * H;
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bend = spec.bend * len * 0.9 + (spec.bend === 0 ? len * 0.06 : 0);
    const cx = sx + dx / 2 + nx * bend;
    const cy = sy + dy / 2 + ny * bend;
    const shaft = [];
    const steps = 28;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      shaft.push([u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey]);
    }
    const tangent = Math.atan2(ey - cy, ex - cx);
    const head = Math.min(14, 6 + len * 0.05);
    const spread = 0.5 + rnd() * 0.12;
    const a1 = tangent + Math.PI - spread;
    const a2 = tangent + Math.PI + spread;
    return {
      strokes: [
        shaft,
        [
          [ex + Math.cos(a1) * head, ey + Math.sin(a1) * head],
          [ex, ey],
          [ex + Math.cos(a2) * head * 0.92, ey + Math.sin(a2) * head * 0.92],
        ],
      ],
      end: { x: ex, y: ey, angle: tangent },
    };
  }
  if (spec.type === "free") return { strokes: [spec.pts.map(([x, y]) => [x * W, y * H])] };
  return null;
}

export function strokeLength(strokes) {
  return strokes.reduce((sum, s) => sum + pathLength(s), 0);
}
