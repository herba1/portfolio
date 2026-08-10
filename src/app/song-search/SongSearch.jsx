"use client";

import { useState } from "react";
import BackdropDock from "../backdrop/BackdropDock";
import { readTone, toneMode } from "../backdrop/tone";
import "./song-search.css";

export default function SongSearch() {
  const [mode, setMode] = useState("dark");
  const [picked, setPicked] = useState(null);

  function adoptTone(node) {
    if (!node?.complete || !node.naturalWidth) return;
    const tone = readTone(node);
    if (tone) setMode(toneMode(tone));
  }

  return (
    <main className="ss-page" data-mode={mode}>
      <div className="ss-stage">
        {picked ? (
          <figure className="ss-pick" key={picked.id}>
            <img
              src={picked.artwork}
              alt=""
              crossOrigin="anonymous"
              ref={adoptTone}
              onLoad={(event) => adoptTone(event.currentTarget)}
            />
            <figcaption>
              <span className="ss-pick__title">{picked.title}</span>
              <span className="ss-pick__artist">{picked.artist}</span>
            </figcaption>
          </figure>
        ) : (
          <p className="ss-hint">Search a song to load its cover and preview.</p>
        )}
      </div>

      <button
        type="button"
        className="ss-toggle"
        onClick={() => setMode((current) => (current === "dark" ? "light" : "dark"))}
      >
        {mode === "dark" ? "Light ground" : "Dark ground"}
      </button>

      <BackdropDock onSelect={setPicked} mode={mode} />
    </main>
  );
}
