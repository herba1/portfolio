const LABELS = [
  { paper: "#1d1b19", ink: "#f1e9d6" },
  { paper: "#ece4cf", ink: "#1d1b19" },
  { paper: "#c8432b", ink: "#f6efe2" },
  { paper: "#2f5d8a", ink: "#f2ede2" },
  { paper: "#e2b13c", ink: "#1d1b19" },
];

export const MAX_SLEEVES = 10;

export function toSleeves(tracks) {
  const seen = new Set();
  const sleeves = [];
  for (const track of tracks) {
    const src = track.imageLarge || track.image;
    const key = track.album || src;
    if (!src || seen.has(key)) continue;
    seen.add(key);
    sleeves.push({
      id: track.id || key,
      src,
      title: track.album || track.title,
      song: track.title,
      artist: track.artist,
      label: LABELS[sleeves.length % LABELS.length],
    });
    if (sleeves.length === MAX_SLEEVES) break;
  }
  return sleeves;
}
