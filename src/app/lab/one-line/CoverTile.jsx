"use client";

import { useEffect, useRef } from "react";

const PIXEL_STEPS = [32, 16, 8];
const FALLBACK_COUNT = 12;

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

function fallbackImage(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return `/flyout/card-${String((hash % FALLBACK_COUNT) + 1).padStart(2, "0")}.jpg`;
}

export default function CoverTile({ cover, order }) {
  const coverRef = useRef(null);
  const artRef = useRef(null);
  const fineRef = useRef(null);
  const mediumRef = useRef(null);
  const coarseRef = useRef(null);

  useEffect(() => {
    const node = coverRef.current;
    const art = artRef.current;
    if (!node || !art) return undefined;
    const fallback = fallbackImage(String(cover.id ?? cover.image));
    let stage = art.getAttribute("src") === fallback && cover.image !== fallback ? 2 : art.hasAttribute("crossorigin") ? 0 : 1;

    const reveal = (pixelate) => {
      let drawn = false;
      if (pixelate) {
        try {
          drawn = drawPixelSteps(art, [fineRef.current, mediumRef.current, coarseRef.current]);
        } catch {
          drawn = false;
        }
      }
      if (drawn) node.removeAttribute("data-plain");
      else node.setAttribute("data-plain", "");
      node.setAttribute("data-ready", "");
    };

    const onLoad = () => reveal(stage !== 1);

    const onError = () => {
      if (stage === 0 && cover.image !== fallback) {
        stage = 1;
        art.removeAttribute("crossorigin");
        art.setAttribute("src", cover.image);
        return;
      }
      if (stage < 2 && cover.image !== fallback) {
        stage = 2;
        art.setAttribute("src", fallback);
        return;
      }
      stage = 3;
      node.setAttribute("data-empty", "");
      node.setAttribute("data-plain", "");
      node.setAttribute("data-ready", "");
    };

    art.addEventListener("load", onLoad);
    art.addEventListener("error", onError);
    if (art.complete) {
      if (art.naturalWidth) onLoad();
      else if (art.getAttribute("src")) onError();
    }
    return () => {
      art.removeEventListener("load", onLoad);
      art.removeEventListener("error", onError);
      node.removeAttribute("data-ready");
      node.removeAttribute("data-plain");
      node.removeAttribute("data-empty");
    };
  }, [cover.id, cover.image]);

  return (
    <li className="ol-tile" style={{ "--ol-i": order }}>
      <div ref={coverRef} className="ol-cover">
        <canvas ref={coarseRef} className="ol-cover__pix" data-step="8" aria-hidden="true" />
        <canvas ref={mediumRef} className="ol-cover__pix" data-step="16" aria-hidden="true" />
        <canvas ref={fineRef} className="ol-cover__pix" data-step="32" aria-hidden="true" />
        <img
          ref={artRef}
          className="ol-cover__art"
          src={cover.image}
          crossOrigin="anonymous"
          decoding="async"
          draggable={false}
          alt={`${cover.title} by ${cover.artist}`}
        />
      </div>
      <p className="ol-tile__title text-ui-sm">{cover.title}</p>
      <p className="ol-tile__artist text-ui-sm">{cover.artist}</p>
    </li>
  );
}
