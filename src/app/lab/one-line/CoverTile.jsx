"use client";

import { useEffect, useRef } from "react";

const PIXEL_STEPS = [32, 16, 8];

function drawPixelSteps(image, canvases) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return false;
  const side = Math.min(width, height);
  const offsetX = (width - side) / 2;
  const offsetY = (height - side) / 2;
  let previous = null;
  for (let index = 0; index < PIXEL_STEPS.length; index += 1) {
    const canvas = canvases[index];
    if (!canvas) return false;
    const size = PIXEL_STEPS[index];
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (previous) context.drawImage(previous, 0, 0, size, size);
    else context.drawImage(image, offsetX, offsetY, side, side, 0, 0, size, size);
    previous = canvas;
  }
  return true;
}

export default function CoverTile({ cover, item, order }) {
  const coverRef = useRef(null);
  const fineRef = useRef(null);
  const mediumRef = useRef(null);
  const coarseRef = useRef(null);

  useEffect(() => {
    const image = item?.element;
    const node = coverRef.current;
    if (!image || !node) return;
    try {
      if (drawPixelSteps(image, [fineRef.current, mediumRef.current, coarseRef.current])) node.setAttribute("data-ready", "");
    } catch {
      node.setAttribute("data-ready", "");
    }
  }, [item]);

  return (
    <li className="ol-tile" style={{ "--ol-i": order }}>
      <div ref={coverRef} className="ol-cover">
        <canvas ref={coarseRef} className="ol-cover__pix" data-step="8" aria-hidden="true" />
        <canvas ref={mediumRef} className="ol-cover__pix" data-step="16" aria-hidden="true" />
        <canvas ref={fineRef} className="ol-cover__pix" data-step="32" aria-hidden="true" />
        <div className="ol-cover__art" style={{ backgroundImage: `url(${cover.image})` }} role="img" aria-label={`${cover.title} by ${cover.artist}`} />
      </div>
      <p className="ol-tile__title text-ui-sm">{cover.title}</p>
      <p className="ol-tile__artist text-ui-sm">{cover.artist}</p>
    </li>
  );
}
