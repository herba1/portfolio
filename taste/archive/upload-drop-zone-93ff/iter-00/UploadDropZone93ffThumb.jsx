import { Film } from "lucide-react";

export default function UploadDropZone93ffThumb({ file, develop }) {
  const inner = () => {
    if (file.kind === "audio") {
      return (
        <span className="udz-thumb-bars">
          {file.waveform.map((bar, index) => (
            <span key={index} className="udz-thumb-bar" style={{ height: `${bar}px` }} />
          ))}
        </span>
      );
    }
    if (file.kind === "doc") {
      return (
        <span className="udz-thumb-rules">
          {file.rules.map((rule, index) => (
            <span key={index} className="udz-thumb-rule" style={{ width: `${rule}%` }} />
          ))}
        </span>
      );
    }
    return (
      <span className="block h-full w-full" style={{ background: file.preview }}>
        {file.kind === "video" ? (
          <Film size={14} strokeWidth={2} className="text-ink-inverse absolute bottom-1 left-1" />
        ) : null}
      </span>
    );
  };

  return (
    <span className="udz-thumb">
      <span className="udz-thumb-inner" style={{ "--udz-dev": develop }}>
        {inner()}
      </span>
    </span>
  );
}
