"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

export default function UploadZone({ onFiles, compact }) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef(null);

  function openPicker() {
    inputRef.current?.click();
  }

  function handleDragEnter(event) {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  }

  function handleChange(event) {
    if (event.target.files.length) onFiles(event.target.files);
    event.target.value = "";
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`updz-dropzone${dragging ? " updz-dropzone--active" : ""}${compact ? " updz-dropzone--compact" : ""}`}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <UploadCloud size={compact ? 18 : 26} strokeWidth={1.5} className="updz-dropzone__icon" />
      <div className="updz-dropzone__copy">
        <span className="text-ui-lg">Drop files to upload</span>
        {!compact && <span className="updz-dropzone__hint text-ui text-ink-secondary">or click to browse</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="updz-dropzone__input"
        onChange={handleChange}
        tabIndex={-1}
      />
    </div>
  );
}
