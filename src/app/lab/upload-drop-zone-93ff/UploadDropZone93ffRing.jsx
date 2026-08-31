export default function UploadDropZone93ffRing({ progress }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="udz-ring flex-none">
      <circle className="udz-ring-track" cx="14" cy="14" r="12" fill="none" strokeWidth="2.5" />
      <circle className="udz-ring-disc" cx="14" cy="14" r="6" fill="none" strokeWidth="0" />
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
      <circle className="udz-ring-eye" cx="14" cy="14" r="3.5" />
    </svg>
  );
}
