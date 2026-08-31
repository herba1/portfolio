"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "./UploadZone";
import FileRow from "./FileRow";
import {
  FAILURE_RATE,
  TICK_MS,
  kindForFile,
  randomFailureReason,
  speedMsForFile,
  tickProgress,
} from "./uploadEngine";
import "./upload-drop-zone.css";

function buildEntry(file) {
  const willFail = Math.random() < FAILURE_RATE;
  const kind = kindForFile(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    kind,
    previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
    progress: 0,
    status: "uploading",
    speedMs: speedMsForFile(file),
    willFail,
    failAt: willFail ? 30 + Math.random() * 55 : null,
    errorReason: null,
  };
}

export default function UploadDropZoneExperience() {
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef(entries);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    const id = setInterval(() => {
      setEntries((prev) => {
        if (!prev.some((entry) => entry.status === "uploading")) return prev;
        return prev.map((entry) => {
          if (entry.status !== "uploading") return entry;
          const progress = tickProgress(entry.progress, entry.speedMs);
          if (entry.willFail && progress >= entry.failAt) {
            return {
              ...entry,
              progress: entry.failAt,
              status: "failed",
              errorReason: randomFailureReason(),
            };
          }
          if (progress >= 100) {
            return { ...entry, progress: 100, status: "done" };
          }
          return { ...entry, progress };
        });
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      entriesRef.current.forEach((entry) => {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      });
    };
  }, []);

  function handleFiles(fileList) {
    const added = Array.from(fileList).map(buildEntry);
    setEntries((prev) => [...prev, ...added]);
  }

  function handleRetry(id) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== id) return entry;
        const willFail = Math.random() < FAILURE_RATE * 0.5;
        return {
          ...entry,
          status: "uploading",
          progress: 0,
          willFail,
          failAt: willFail ? 30 + Math.random() * 55 : null,
          errorReason: null,
        };
      })
    );
  }

  function handleRemove(id) {
    setEntries((prev) => {
      const target = prev.find((entry) => entry.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((entry) => entry.id !== id);
    });
  }

  const summary = useMemo(() => {
    if (entries.length === 0) return null;
    const uploading = entries.filter((entry) => entry.status === "uploading").length;
    const done = entries.filter((entry) => entry.status === "done").length;
    const failed = entries.filter((entry) => entry.status === "failed").length;
    const parts = [`${entries.length} file${entries.length === 1 ? "" : "s"}`];
    if (uploading) parts.push(`${uploading} uploading`);
    if (done) parts.push(`${done} done`);
    if (failed) parts.push(`${failed} failed`);
    return parts.join(" · ");
  }, [entries]);

  return (
    <main className="updz-page bg-surface">
      <h1 className="updz-title text-title-sm text-ink">Upload drop zone</h1>

      <div className="updz-stage">
        <UploadZone onFiles={handleFiles} compact={entries.length > 0} />

        {summary && <p className="updz-summary text-ui-sm text-ink-secondary">{summary}</p>}

        {entries.length > 0 && (
          <ul className="updz-list">
            {entries.map((entry) => (
              <FileRow key={entry.id} entry={entry} onRetry={handleRetry} onRemove={handleRemove} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
