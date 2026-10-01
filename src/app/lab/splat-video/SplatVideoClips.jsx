"use client";

import { KIND_LABELS } from "./splatVideoParams";

function clipLabel({ name, kind }) {
  const kindLabel = KIND_LABELS[kind];
  return kindLabel ? `${name} · ${kindLabel}` : name;
}

export default function SplatVideoClips({ clips, current, onSelect }) {
  if (clips.length === 0) return null;
  return (
    <nav className="splat-video-clips" aria-label="Clips">
      {clips.map((clip) => {
        const selected = clip.name === current;
        return (
          <button
            key={clip.name}
            type="button"
            className="splat-video-clips__pill text-ui"
            data-active={selected}
            aria-pressed={selected}
            onClick={() => onSelect(clip.name)}
          >
            {clipLabel(clip)}
          </button>
        );
      })}
    </nav>
  );
}
