export const ALBUMS = [
  { id: "meadow", title: "Meadow", artist: "Low Hours", year: 2023, cover: "/scorch/meadow.webp", first: "Second Light" },
  { id: "valley", title: "Valley Line", artist: "The Arbours", year: 2021, cover: "/scorch/valley.webp", first: "Switchback" },
  { id: "wires", title: "Wires", artist: "Kessler Ward", year: 2024, cover: "/scorch/wires.webp", first: "Overhead" },
  { id: "visitor", title: "Visitor", artist: "June Atlas", year: 2022, cover: "/scorch/visitor.webp", first: "Landing Lights" },
  { id: "reading", title: "Reading Room", artist: "Low Hours", year: 2019, cover: "/scorch/reading.webp", first: "Marginal" },
  { id: "beams", title: "Beams", artist: "Kessler Ward", year: 2024, cover: "/scorch/beams.webp", first: "Headlamps" },
];

export const ARTISTS = [
  { id: "low-hours", name: "Low Hours", songs: 24, photo: "/monovolt/abt10.webp", first: "Second Light" },
  { id: "arbours", name: "The Arbours", songs: 11, photo: "/monovolt/abt5.webp", first: "Switchback" },
  { id: "june-atlas", name: "June Atlas", songs: 9, photo: "/monovolt/abt7.webp", first: "Landing Lights" },
  { id: "kessler", name: "Kessler Ward", songs: 17, photo: "/monovolt/abt1.webp", first: "Overhead" },
];

export const SONGS = [
  { id: "second-light", title: "Second Light", artist: "Low Hours", album: "meadow", length: 214 },
  { id: "overhead", title: "Overhead", artist: "Kessler Ward", album: "wires", length: 187 },
  { id: "switchback", title: "Switchback", artist: "The Arbours", album: "valley", length: 242 },
  { id: "landing-lights", title: "Landing Lights", artist: "June Atlas", album: "visitor", length: 198 },
  { id: "marginal", title: "Marginal", artist: "Low Hours", album: "reading", length: 163 },
  { id: "headlamps", title: "Headlamps", artist: "Kessler Ward", album: "beams", length: 229 },
  { id: "cold-frame", title: "Cold Frame", artist: "The Arbours", album: "valley", length: 205 },
];

export const COVER = Object.fromEntries(ALBUMS.map((a) => [a.id, a.cover]));

export const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
