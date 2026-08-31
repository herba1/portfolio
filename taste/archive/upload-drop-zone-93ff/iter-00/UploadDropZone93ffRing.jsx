export default function UploadDropZone93ffRing({ progress }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="flex-none">
      <circle
        className="udz-ring-track"
        cx="14"
        cy="14"
        r="12"
        fill="none"
        strokeWidth="2.5"
      />
      <circle
        className="udz-ring-fill"
        cx="14"
        cy="14"
        r="12"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength="1"
        strokeDasharray="1 1"
        strokeDashoffset={1 - Math.min(1, Math.max(0, progress))}
        transform="rotate(-90 14 14)"
      />
      <path
        className="udz-ring-check"
        d="M8.6 14.3 12.2 17.9 19.4 10.4"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        strokeDasharray="1 1"
      />
    </svg>
  );
}
