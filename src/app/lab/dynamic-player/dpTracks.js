import { albumById } from "@/app/lab/_music/catalog";

const pick = (album, title, duration, bpm) => {
  const a = albumById(album);
  return { id: `${album}-${title}`, title, artist: a.artist, album: a.title, cover: a.cover, duration, bpm };
};

export const TRACKS = [
  pick("abbey-road", "Here Comes the Sun", 185, 129),
  pick("revolver", "Taxman", 159, 129),
  pick("rubber-soul", "In My Life", 146, 103),
  pick("sgt-pepper", "Lucy in the Sky with Diamonds", 208, 135),
  pick("let-it-be", "Get Back", 189, 123),
  pick("magical-mystery-tour", "Penny Lane", 180, 113),
  pick("help", "Ticket to Ride", 190, 123),
  pick("a-hard-days-night", "Can't Buy Me Love", 132, 171),
];
