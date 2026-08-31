import { FileAudio2, FileText, FileVideo2, File as FileIcon, X } from "lucide-react";
import ProgressRing from "./ProgressRing";
import { formatBytes } from "./uploadEngine";

const KIND_ICON = {
  video: FileVideo2,
  audio: FileAudio2,
  document: FileText,
  file: FileIcon,
};

const STATUS_LABEL = {
  uploading: "Uploading",
  done: "Done",
  failed: "Failed",
};

export default function FileRow({ entry, onRetry, onRemove }) {
  const Icon = KIND_ICON[entry.kind] ?? FileIcon;
  const statusText =
    entry.status === "failed" ? `Failed — ${entry.errorReason}` : STATUS_LABEL[entry.status];

  return (
    <li className={`updz-row updz-row--${entry.status}`}>
      <div className="updz-row__thumb">
        {entry.previewUrl ? (
          <img src={entry.previewUrl} alt="" />
        ) : (
          <Icon size={18} strokeWidth={1.75} />
        )}
      </div>

      <div className="updz-row__meta">
        <span className="updz-row__name text-ui">{entry.name}</span>
        <span className="updz-row__status text-ui-sm">
          {formatBytes(entry.size)} · {statusText}
        </span>
      </div>

      <ProgressRing
        progress={entry.progress}
        status={entry.status}
        onRetry={() => onRetry(entry.id)}
        label={`Retry ${entry.name}`}
      />

      <button
        type="button"
        className="updz-row__remove"
        onClick={() => onRemove(entry.id)}
        aria-label={`Remove ${entry.name}`}
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </li>
  );
}
