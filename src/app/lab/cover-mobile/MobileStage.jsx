"use client";

import { useEffect, useRef } from "react";

import { mountMobile } from "./mobileEngine";
import { MAX_COUNT, largeArt } from "./mobileParams";

const MESH_GRID = 8;

function meshFor(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = MESH_GRID;
    canvas.height = MESH_GRID;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, MESH_GRID, MESH_GRID);
    const { data } = context.getImageData(0, 0, MESH_GRID, MESH_GRID);
    const cell = (column, row) => {
      const at = (row * MESH_GRID + column) * 4;
      return `rgb(${data[at]} ${data[at + 1]} ${data[at + 2]})`;
    };
    const spots = [
      [cell(1, 1), "18% 18%"],
      [cell(6, 1), "82% 18%"],
      [cell(1, 6), "18% 82%"],
      [cell(6, 6), "82% 82%"],
      [cell(3, 4), "50% 55%"],
    ];
    const layers = spots.map(
      ([colour, at]) =>
        `radial-gradient(circle at ${at}, ${colour} 0%, ${colour.replace(")", " / 0.6)")} 28%, ${colour.replace(")", " / 0.2)")} 52%, transparent 72%)`,
    );
    return `${layers.join(", ")}, ${cell(4, 4)}`;
  } catch {
    return "";
  }
}

function handleArtLoad(event) {
  const image = event.currentTarget;
  const button = image.closest(".cm-cover");
  if (!button) return;
  button.dataset.loaded = "true";
  const back = button.querySelector(".cm-cover__back");
  const mesh = meshFor(image);
  if (back && mesh) back.style.background = mesh;
}

function handleArtError(event) {
  const button = event.currentTarget.closest(".cm-cover");
  if (!button) return;
  button.dataset.loaded = "true";
  button.dataset.missing = "true";
}

export default function MobileStage({
  covers,
  count,
  seed,
  physics,
  reducedMotion,
  embedded,
  playerRef,
  onPromote,
  onTopTap,
  onControllerReady,
}) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const coverRefs = useRef([]);
  const slotsRef = useRef([]);
  const configRef = useRef({ physics, reducedMotion, embedded, onPromote, onTopTap, onControllerReady });
  const hangable = covers.slice(0, MAX_COUNT);

  useEffect(() => {
    configRef.current = { physics, reducedMotion, embedded, onPromote, onTopTap, onControllerReady };
  }, [physics, reducedMotion, embedded, onPromote, onTopTap, onControllerReady]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    const engine = mountMobile({ stage, canvas, covers, count, seed, slotsRef, coverRefs, configRef, playerRef });
    return engine.destroy;
  }, [covers, count, seed, playerRef]);

  return (
    <div ref={stageRef} className="cm-stage" data-embedded={embedded ? "true" : undefined}>
      <canvas ref={canvasRef} className="cm-stage__wires" aria-hidden="true" />
      <div className="cm-stage__covers" role="group" aria-label="Mobile of recently played covers">
        {hangable.map((cover, index) => (
          <button
            key={cover.id}
            ref={(node) => {
              coverRefs.current[index] = node;
            }}
            type="button"
            className="cm-cover"
            data-index={index}
            data-hung="false"
            data-side="front"
            tabIndex={-1}
            aria-label={`Play ${cover.title} by ${cover.artist}`}
          >
            <span className="cm-cover__face">
              <span className="cm-cover__front">
                <img
                  className="cm-cover__art"
                  src={largeArt(cover.image)}
                  alt=""
                  crossOrigin="anonymous"
                  decoding="async"
                  draggable={false}
                  onLoad={handleArtLoad}
                  onError={handleArtError}
                />
                <span className="cm-cover__missing text-ui-sm">{cover.title}</span>
              </span>
              <span className="cm-cover__back" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
