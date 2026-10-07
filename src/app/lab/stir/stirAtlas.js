const PROBE_WEIGHT = 477;
const PROBE_SIZE = 100;
const WEIGHT_CEILING = 900;

function fontOf(weight, size, family) {
  return `${weight} ${size}px ${family}`;
}

function ladder(anchor, step, floor) {
  const below = Math.floor((anchor - floor) / step);
  const above = Math.floor((WEIGHT_CEILING - anchor) / step + 1e-6);
  return Array.from({ length: below + above + 1 }, (_, index) => anchor + (index - below) * step);
}

export function supportsFineWeights(context, family) {
  context.font = fontOf(PROBE_WEIGHT, 10, family);
  return context.font.includes(String(PROBE_WEIGHT));
}

export function measureAdvance(context, family, weight) {
  context.font = fontOf(weight, PROBE_SIZE, family);
  const width = context.measureText("0").width;
  return width > 0 ? width / PROBE_SIZE : 0.6;
}

export function buildAtlas({ canvas, glyphs, family, fontPx, tileW, tileH, maxSize, restWeight, floorWeight, fineStep, coarseStep }) {
  const context = canvas.getContext("2d", { willReadFrequently: false });
  const coarse = ladder(restWeight, coarseStep, floorWeight);
  let weights = supportsFineWeights(context, family) ? ladder(restWeight, fineStep, floorWeight) : coarse;
  const columns = Math.max(1, Math.min(glyphs.length, Math.floor(maxSize / tileW)));
  const glyphRows = Math.max(1, Math.ceil(glyphs.length / columns));
  if (weights.length * glyphRows * tileH > maxSize) weights = coarse;

  context.font = fontOf(restWeight, fontPx, family);
  const capHeight = context.measureText("H").actualBoundingBoxAscent || fontPx * 0.7;
  const xHeight = context.measureText("x").actualBoundingBoxAscent || fontPx * 0.52;
  const baseline = Math.round(tileH / 2 + (capHeight + xHeight) / 4);

  canvas.width = columns * tileW;
  canvas.height = weights.length * glyphRows * tileH;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  weights.forEach((weight, master) => {
    context.font = fontOf(weight, fontPx, family);
    glyphs.forEach((glyph, slot) => {
      const left = (slot % columns) * tileW;
      const top = (master * glyphRows + Math.floor(slot / columns)) * tileH;
      const advance = context.measureText(glyph).width;
      context.save();
      context.beginPath();
      context.rect(left, top, tileW, tileH);
      context.clip();
      context.fillText(glyph, left + (tileW - advance) / 2, top + baseline);
      context.restore();
    });
  });

  return {
    columns,
    glyphRows,
    masters: weights.length,
    masterBase: weights[0],
    masterStep: weights.length > 1 ? weights[1] - weights[0] : 1,
    width: canvas.width,
    height: canvas.height,
  };
}
