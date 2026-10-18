import { albumById } from "@/app/lab/_music/catalog";

const PICKS = [
  ["abbey-road", "Here Comes the Sun", "3:05"],
  ["revolver", "Eleanor Rigby", "2:08"],
  ["rubber-soul", "In My Life", "2:24"],
  ["let-it-be", "Across the Universe", "3:48"],
  ["magical-mystery-tour", "Strawberry Fields Forever", "4:07"],
  ["sgt-pepper", "A Day in the Life", "5:37"],
  ["help", "Ticket to Ride", "3:10"],
  ["white-album", "Blackbird", "2:18"],
  ["a-hard-days-night", "And I Love Her", "2:30"],
  ["abbey-road", "Something", "3:03"],
  ["revolver", "Tomorrow Never Knows", "2:57"],
  ["rubber-soul", "Norwegian Wood", "2:05"],
  ["magical-mystery-tour", "Penny Lane", "3:00"],
];

const seconds = (t) => {
  const [m, s] = t.split(":").map(Number);
  return m * 60 + s;
};

export const TRACKS = PICKS.map(([albumId, title, length], i) => {
  const album = albumById(albumId);
  return { id: `q${i}`, title, length, seconds: seconds(length), album: album.title, artist: album.artist, cover: album.cover };
});

export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
