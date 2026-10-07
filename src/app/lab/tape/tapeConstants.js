export const TRACK = {
  artist: "The Beatles",
  title: "Ask Me Why",
  isrc: "GBAYE0601415",
  durationSec: 147,
};

export const AUDIO_SOURCES = [{ url: "/audio/ask-me-why.opus" }, { url: "/audio/ask-me-why.m4a" }, { preview: true }];

export const CLIP_OFFSET_SECONDS = 25.6;
export const CLIP_SECONDS = 30;
export const CLIP_TOLERANCE_SECONDS = 0.75;
export const FULL_RECORDING_SECONDS = 60;
export const LOOP_START_SECONDS = 0.22;
export const LOOP_SECONDS = 29;
export const SEAM_SECONDS = 0.12;

export const LEVEL_COUNT = 5;
export const COLUMNS_PER_SECOND = 160;
export const PRINT_BINS = 160;
export const PRINT_BANDS = 4;

export const SHUTTLE_CHIPS = [
  { value: -2, label: "−2×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 4, label: "4×" },
];

export const CAST = [
  { id: "john", name: "John", image: "/cast/john.webp" },
  { id: "paul", name: "Paul", image: "/cast/paul.webp" },
  { id: "george", name: "George", image: "/cast/george.webp" },
];
