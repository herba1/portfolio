"use client";

import { useEffect, useState } from "react";
import { FALLBACK_TRACKS } from "./catalog";

let cache = null;

function load() {
  if (!cache) {
    cache = fetch("/api/spotify/recent")
      .then((res) => (res.ok ? res.json() : { tracks: [] }))
      .then((data) => {
        const tracks = (data.tracks || []).filter((t) => t.image);
        return tracks.length ? tracks : FALLBACK_TRACKS;
      })
      .catch(() => FALLBACK_TRACKS);
  }
  return cache;
}

export function useTopSongs(limit = 12) {
  const [tracks, setTracks] = useState(() => FALLBACK_TRACKS.slice(0, limit));
  const [live, setLive] = useState(false);
  useEffect(() => {
    let alive = true;
    load().then((list) => {
      if (!alive) return;
      setTracks(list.slice(0, limit));
      setLive(list !== FALLBACK_TRACKS);
    });
    return () => {
      alive = false;
    };
  }, [limit]);
  return { tracks, live };
}
