import { Film } from "lucide-react";

import { CELLS, mosaicLevel } from "./uploadDropZone93ffData";

function Content({ file }) {
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
}

export default function UploadDropZone93ffThumb({ file }) {
  const level = mosaicLevel(file.progress);

  return (
    <span className="udz-thumb">
      <span className="udz-thumb-inner">
        <Content file={file} />
      </span>
      <span
        className="udz-mosaic"
        data-level={level}
        style={{ "--udz-p": file.progress }}
        aria-hidden="true"
      >
        {Array.from({ length: CELLS }, (_, index) => (
          <span
            key={index}
            className="udz-mos"
            style={{
              "--c0": file.mosaic[0][index],
              "--c1": file.mosaic[1][index],
              "--c2": file.mosaic[2][index],
              "--udz-t": file.dissolve[index],
            }}
          />
        ))}
      </span>
    </span>
  );
}
