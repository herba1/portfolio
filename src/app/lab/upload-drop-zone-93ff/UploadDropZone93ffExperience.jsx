"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

import UploadDropZone93ffLanes, { stateOf } from "./UploadDropZone93ffLanes";
import UploadDropZone93ffRoll from "./UploadDropZone93ffRoll";
import UploadDropZone93ffRow from "./UploadDropZone93ffRow";
import {
  CONCURRENCY,
  MAX_FILES,
  POOL,
  SEED_FILES,
  TICK_MS,
  advance,
  kindOf,
  makeFile,
  megabytes,
} from "./uploadDropZone93ffData";
import "./upload-drop-zone-93ff.css";

export default function UploadDropZone93ffExperience() {
  const [files, setFiles] = useState(() =>
    SEED_FILES.map((spec, index) => makeFile(spec, index + 1, index * 40)),
  );
  const [exiting, setExiting] = useState(() => new Set());
  const [zone, setZone] = useState("idle");
  const [focus, setFocus] = useState(null);

  const nextId = useRef(SEED_FILES.length + 1);
  const poolAt = useRef(0);
  const dragDepth = useRef(0);
  const timers = useRef(new Set());

  useEffect(() => {
    const id = setInterval(() => setFiles(advance), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const full = files.length >= MAX_FILES;

  const addSpecs = useCallback((specs) => {
    setFiles((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) return prev;
      const added = specs.slice(0, room).map((spec, index) => {
        const id = nextId.current;
        nextId.current += 1;
        return makeFile(spec, id, index * 40);
      });
      return [...prev, ...added];
    });
  }, []);

  const addFromPool = useCallback(() => {
    const spec = POOL[poolAt.current % POOL.length];
    poolAt.current += 1;
    addSpecs([spec]);
  }, [addSpecs]);

  const remove = useCallback((id) => {
    setExiting((prev) => new Set(prev).add(id));
    const timer = setTimeout(() => {
      setFiles((prev) => prev.filter((file) => file.id !== id));
      setExiting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      timers.current.delete(timer);
    }, 260);
    timers.current.add(timer);
  }, []);

  const retry = useCallback((id) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === id && file.status === "error"
          ? { ...file, status: "retrying", progress: 0, attempt: 1, wait: 4 }
          : file,
      ),
    );
  }, []);

  const retryAll = useCallback(() => {
    setFiles((prev) =>
      prev.map((file) =>
        file.status === "error"
          ? { ...file, status: "retrying", progress: 0, attempt: 1, wait: 4 }
          : file,
      ),
    );
  }, []);

  const onDragEnter = (event) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (!full) setZone("drag");
  };

  const onDragLeave = (event) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setZone("idle");
  };

  const onDrop = (event) => {
    event.preventDefault();
    dragDepth.current = 0;
    setZone("idle");
    if (full) return;
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (!dropped.length) {
      addFromPool();
      return;
    }
    addSpecs(
      dropped.map((file) => ({
        name: file.name,
        bytes: file.size || 1_200_000,
        kind: kindOf(file.name),
        duration: Math.min(9, Math.max(2.2, 2 + (file.size || 1_200_000) / 24_000_000)),
      })),
    );
  };

  const totals = useMemo(() => {
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    const sent = files.reduce((sum, file) => sum + file.bytes * file.progress, 0);
    return {
      bytes,
      sent,
      done: files.filter((file) => file.status === "done").length,
      failed: files.filter((file) => file.status === "error").length,
      running: files.filter((file) => file.status === "uploading").length,
      waiting: files.filter((file) => file.status === "queued" || file.status === "retrying").length,
      percent: bytes ? (sent / bytes) * 100 : 0,
    };
  }, [files]);

  const settled = files.length > 0 && totals.done === files.length;
  const focused = files.find((file) => file.id === focus) ?? null;

  const caption = focused
    ? `${focused.name} · ${stateOf(focused)}`
    : settled
      ? `Both lanes clear · the run took ${CONCURRENCY} at a time`
      : `${totals.running} in the air · ${totals.waiting} booked in · ${Math.round(totals.percent)}% of the batch sent`;

  const zoneLabel = full
    ? "Queue is full"
    : zone === "drag"
      ? "Release to upload"
      : settled
        ? "Drop more files here"
        : "Drop files here";

  const zoneHint = full
    ? `${MAX_FILES} files is the batch limit`
    : settled
      ? "Everything queued has landed"
      : `Uploads run ${CONCURRENCY} at a time, the rest wait their turn`;

  return (
    <main className="udz-page bg-surface text-ink min-h-dvh px-4 py-16 md:py-24">
      <div className="mx-auto w-full max-w-[560px]">
        <h1 className="udz-enter text-title-sm text-ink">Press kit upload</h1>

        <section className="udz-enter border-line bg-surface-raised mt-8 overflow-hidden rounded-xl border" style={{ "--udz-delay": "60ms" }}>
          <div className="p-4">
            <button
              type="button"
              onClick={addFromPool}
              onPointerEnter={() => setZone((current) => (current === "drag" ? current : "hover"))}
              onPointerLeave={() => setZone((current) => (current === "drag" ? current : "idle"))}
              onPointerDown={() => setZone((current) => (current === "drag" ? current : "press"))}
              onPointerUp={() => setZone((current) => (current === "drag" ? current : "hover"))}
              onDragEnter={onDragEnter}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              disabled={full}
              data-zone={full ? "off" : zone}
              className="udz-zone udz-focus flex w-full flex-col items-center rounded-xl px-6 py-8"
            >
              <UploadCloud className="udz-zone-glyph text-ink-secondary" size={22} strokeWidth={1.75} />
              <span key={zoneLabel} className="udz-swap text-heading-sm text-ink mt-3">
                {zoneLabel}
              </span>
              <span key={zoneHint} className="udz-swap text-ui text-ink-secondary mt-1">
                {zoneHint}
              </span>
            </button>
          </div>

          {files.length ? (
            <ul className="divide-line-subtle border-line-subtle divide-y border-t">
              {files.map((file) => (
                <UploadDropZone93ffRow
                  key={file.id}
                  file={file}
                  exiting={exiting.has(file.id)}
                  focus={focus === file.id}
                  onFocus={setFocus}
                  onRemove={remove}
                  onRetry={retry}
                />
              ))}
            </ul>
          ) : (
            <div className="udz-enter border-line-subtle flex flex-col items-center border-t px-4 py-8">
              <p className="text-heading-sm text-ink">The queue is empty</p>
              <p className="text-ui text-ink-secondary mt-1">Drop something above to start it again</p>
            </div>
          )}

          <div className="border-line-subtle bg-surface-subtle border-t px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              {settled ? (
                <p key="settled" className="udz-swap text-ui text-ink">
                  All {files.length} files uploaded ·{" "}
                  <span className="udz-num">{megabytes(totals.bytes)}</span> MB
                </p>
              ) : (
                <p key="live" className="udz-swap text-ui text-ink flex items-start">
                  <UploadDropZone93ffRoll value={totals.done} />
                  <span>&nbsp;of&nbsp;</span>
                  <UploadDropZone93ffRoll value={files.length} />
                  <span>&nbsp;done ·&nbsp;</span>
                  <span className="udz-num">{megabytes(totals.sent)}</span>
                  <span>&nbsp;of {megabytes(totals.bytes)} MB</span>
                </p>
              )}
              <button
                type="button"
                onClick={retryAll}
                disabled={!totals.failed}
                className="udz-press udz-focus text-ui text-ink border-line bg-surface-raised hover:border-line-strong disabled:text-ink-disabled disabled:border-line-subtle flex-none rounded-lg border px-2 py-1"
              >
                Retry failed
              </button>
            </div>

            <div className="mt-3">
              <UploadDropZone93ffLanes files={files} focus={focus} onFocus={setFocus} />
            </div>

            <p
              key={focused ? focused.id : "idle"}
              className="udz-swap udz-caption text-ui text-ink-secondary mt-2 truncate"
              data-focused={focused ? "true" : "false"}
            >
              {caption}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
