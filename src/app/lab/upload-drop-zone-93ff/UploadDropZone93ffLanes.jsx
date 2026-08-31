import { planLanes, seconds } from "./uploadDropZone93ffData";

const fillOf = (file) => {
  if (file.status === "done") return 100;
  if (file.status === "queued" || file.status === "retrying") return 0;
  return Math.round(file.progress * 100);
};

export const stateOf = (file) => {
  if (file.status === "done") return "landed";
  if (file.status === "error") return `stalled at ${Math.round(file.progress * 100)}%`;
  if (file.status === "retrying") return "reconnecting";
  if (file.status === "queued") return `booked for ${seconds(file).toFixed(1)}s`;
  return `running, ${Math.round(file.progress * 100)}%`;
};

export default function UploadDropZone93ffLanes({ files, focus, onFocus }) {
  const lanes = planLanes(files);

  return (
    <div className="udz-lanes" data-any={focus == null ? "false" : "true"}>
      {lanes.map((lane, index) => (
        <div key={index} className="udz-lane">
          {lane.length ? (
            lane.map(({ file, planned, share }) => (
              <button
                key={file.id}
                type="button"
                className="udz-seg udz-focus"
                data-status={file.status}
                data-planned={planned ? "true" : "false"}
                data-focus={focus === file.id ? "true" : "false"}
                style={{ width: `${share}%` }}
                onPointerEnter={() => onFocus(file.id)}
                onPointerLeave={() => onFocus(null)}
                onFocus={() => onFocus(file.id)}
                onBlur={() => onFocus(null)}
                aria-label={`${file.name}, ${stateOf(file)}`}
              >
                <span className="udz-seg-fill" style={{ width: `${fillOf(file)}%` }} />
              </button>
            ))
          ) : (
            <span className="udz-lane-idle" />
          )}
        </div>
      ))}
    </div>
  );
}
