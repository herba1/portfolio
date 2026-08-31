"use client";

import { memo } from "react";
import { Pause, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { SPEEDS } from "./blenderThreeJsBackParams";

function BlenderThreeJsBackControls({ playing, speedId, onTogglePlay, onStep, onSpeed }) {
  return (
    <div className="btjb__controls">
      <div className="btjb__transport" role="group" aria-label="Playback">
        <button type="button" className="btjb__transport-btn" onClick={() => onStep(-1)} aria-label="Previous tip">
          <ChevronLeft size={16} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          className="btjb__transport-btn btjb__transport-btn--main"
          onClick={onTogglePlay}
          aria-pressed={playing}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} strokeWidth={2.25} /> : <Play size={16} strokeWidth={2.25} />}
        </button>
        <button type="button" className="btjb__transport-btn" onClick={() => onStep(1)} aria-label="Next tip">
          <ChevronRight size={16} strokeWidth={2.25} />
        </button>
      </div>

      <div className="btjb__speeds" role="group" aria-label="Speed">
        {SPEEDS.map((speed) => (
          <button
            key={speed.id}
            type="button"
            className="btjb__speed text-ui-lg"
            data-active={speed.id === speedId ? "true" : undefined}
            aria-pressed={speed.id === speedId}
            onClick={() => onSpeed(speed.id)}
          >
            {speed.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(BlenderThreeJsBackControls);
