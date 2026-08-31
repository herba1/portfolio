import { Check, RotateCw } from "lucide-react";

const SIZE = 40;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ProgressRing({ progress, status, onRetry, label }) {
  const offset = CIRCUMFERENCE * (1 - progress / 100);

  return (
    <div className={`updz-ring updz-ring--${status}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          className="updz-ring__track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          className="updz-ring__fill"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <div className="updz-ring__center">
        {status === "done" && <Check size={16} strokeWidth={2.5} />}
        {status === "failed" && (
          <button
            type="button"
            className="updz-ring__retry"
            onClick={onRetry}
            aria-label={label}
          >
            <RotateCw size={15} strokeWidth={2.25} />
          </button>
        )}
        {status === "uploading" && (
          <span className="updz-ring__percent text-ui-2xs">{Math.round(progress)}</span>
        )}
      </div>
    </div>
  );
}
