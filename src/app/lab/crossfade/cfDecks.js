import { albumById } from "@/app/lab/_music/catalog";

const deck = (album, title, bpm) => {
  const a = albumById(album);
  return { id: album, title, bpm, album: a.title, artist: a.artist, year: a.year, cover: a.cover };
};

export const DECKS = [
  deck("abbey-road", "Come Together", 82),
  deck("revolver", "Taxman", 129),
  deck("rubber-soul", "Drive My Car", 124),
  deck("help", "Help!", 95),
  deck("let-it-be", "Get Back", 123),
  deck("magical-mystery-tour", "Penny Lane", 113),
  deck("a-hard-days-night", "A Hard Day's Night", 139),
];
