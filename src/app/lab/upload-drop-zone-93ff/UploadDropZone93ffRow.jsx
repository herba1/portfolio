import { RotateCw, X } from "lucide-react";

import UploadDropZone93ffRing from "./UploadDropZone93ffRing";
import UploadDropZone93ffRoll from "./UploadDropZone93ffRoll";
import UploadDropZone93ffThumb from "./UploadDropZone93ffThumb";
import { megabytes } from "./uploadDropZone93ffData";

function Meta({ file }) {
  const total = megabytes(file.bytes);

  if (file.status === "queued") return <span>Waiting · {total} MB</span>;
  if (file.status === "retrying") return <span>Reconnecting · {total} MB</span>;
  if (file.status === "done") return <span>Uploaded · {total} MB</span>;
  if (file.status === "error") {
    return (
      <span className="text-negative-ink">
        Connection dropped at <span className="udz-num">{Math.round(file.progress * 100)}</span>%
      </span>
    );
  }

  return (
    <span className="flex items-start">
      <span className="udz-num">{megabytes(file.bytes * file.progress)}</span>
      <span>&nbsp;of {total} MB ·&nbsp;</span>
      <UploadDropZone93ffRoll value={Math.max(1, Math.ceil((1 - file.progress) / file.speed))} />
      <span>s left</span>
    </span>
  );
}

export default function UploadDropZone93ffRow({ file, exiting, focus, onFocus, onRemove, onRetry }) {
  const percent = Math.round(file.progress * 100);
  const showPercent =
    file.status === "uploading" || file.status === "queued" || file.status === "retrying";

  return (
    <li
      className="udz-row"
      data-status={file.status}
      data-exiting={exiting ? "true" : "false"}
      data-focus={focus ? "true" : "false"}
      style={{ "--udz-delay": `${file.enterDelay}ms` }}
      onPointerEnter={() => onFocus(file.id)}
      onPointerLeave={() => onFocus(null)}
    >
      <div className="udz-row-clip">
        <div className="udz-row-body flex items-center gap-3 px-4 py-3">
          <UploadDropZone93ffThumb file={file} />

          <div className="min-w-0 flex-1">
            <p className="text-heading-sm text-ink truncate">{file.name}</p>
            <div key={file.status} className="udz-swap text-ui text-ink-secondary mt-1 flex">
              <Meta file={file} />
            </div>
          </div>

          <div className="flex flex-none items-center gap-3">
            <span className="udz-rail-slot">
              {file.status === "error" ? (
                <button
                  type="button"
                  onClick={() => onRetry(file.id)}
                  className="udz-swap udz-press udz-focus text-ui text-ink border-line bg-surface-raised hover:border-line-strong flex items-center gap-1 rounded-lg border px-2 py-1"
                >
                  <RotateCw size={13} strokeWidth={2.25} />
                  Retry
                </button>
              ) : showPercent ? (
                <span className="udz-swap text-ui text-ink flex items-start">
                  <UploadDropZone93ffRoll value={percent} minChars={2} pace="live" />
                  <span>%</span>
                </span>
              ) : null}
            </span>

            <UploadDropZone93ffRing progress={file.progress} />

            <button
              type="button"
              onClick={() => onRemove(file.id)}
              aria-label={`Remove ${file.name}`}
              className="udz-press udz-focus text-ink-secondary hover:bg-surface-sunken hover:text-ink flex h-7 w-7 items-center justify-center rounded-lg"
            >
              <X size={15} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
