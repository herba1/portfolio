const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const withDuration = (track) => ({ ...track, duration: track.duration || 128 + (hash(track.id || track.title) % 150) });
