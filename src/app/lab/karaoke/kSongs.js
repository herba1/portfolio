import { albumById } from "@/app/lab/_music/catalog";

const song = (album, title, writer, duration, rows) => {
  const a = albumById(album);
  return { id: `${album}-${title}`, title, writer, artist: a.artist, album: a.title, year: a.year, cover: a.cover, duration, lines: build(rows, duration) };
};

function build(rows, duration) {
  return rows.map(([t, section, text], i) => {
    const end = i + 1 < rows.length ? rows[i + 1][0] : duration;
    const tokens = text.split(" ");
    const span = Math.min(end - t - 0.4, Math.max(2.4, tokens.length * 0.5 + 1.6));
    const weights = tokens.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    let at = t;
    const words = tokens.map((w, j) => {
      const d = (weights[j] / total) * span;
      const word = { text: w, start: at, end: at + d };
      at += d;
      return word;
    });
    return { start: t, end, section, words };
  });
}

export const SONGS = [
  song("abbey-road", "Here Comes the Sun", "George Harrison", 185, [
    [0, "Intro", "Acoustic guitar, capo on the seventh fret"],
    [14, "Verse", "George Harrison sings the lead"],
    [24, "Verse", "Written in Eric Clapton's garden, spring 1969"],
    [31, "Chorus", "A Moog synthesiser colours the chorus"],
    [44, "Verse", "Paul on bass and harmony, Ringo on drums"],
    [56, "Verse", "John is away, recovering from a car crash"],
    [80, "Bridge", "The bridge runs in 11/8, 4/4 and 7/8"],
    [96, "Bridge", "Handclaps keep time through the changes"],
    [108, "Verse", "Strings and woodwind are added in August"],
    [125, "Chorus", "Recorded at Abbey Road from 7 July 1969"],
    [150, "Outro", "The guitar figure returns to close it"],
    [168, "Outro", "Abbey Road, side two, track one"],
  ]),
  song("magical-mystery-tour", "Penny Lane", "Lennon–McCartney", 180, [
    [0, "Verse", "Paul McCartney on piano and lead vocal"],
    [16, "Verse", "A real street in south Liverpool"],
    [34, "Chorus", "Brass and flutes lift the chorus"],
    [50, "Verse", "Sessions begin at the end of December 1966"],
    [69, "Chorus", "George Martin writes out the orchestral parts"],
    [84, "Solo", "Piccolo trumpet solo by David Mason"],
    [94, "Solo", "Played in the spirit of Bach's Brandenburg No. 2"],
    [108, "Verse", "Released as a single in February 1967"],
    [124, "Chorus", "A double A-side with Strawberry Fields Forever"],
    [146, "Outro", "Later gathered onto Magical Mystery Tour"],
  ]),
  song("rubber-soul", "In My Life", "Lennon–McCartney", 146, [
    [0, "Intro", "A clean guitar figure opens the song"],
    [10, "Verse", "John Lennon looks back on Liverpool"],
    [31, "Chorus", "Paul and George sing the harmonies"],
    [48, "Verse", "Ringo keeps the drums light and steady"],
    [88, "Solo", "George Martin plays the piano solo"],
    [97, "Solo", "Taped at half speed, it sounds like a harpsichord"],
    [106, "Verse", "Recorded at Abbey Road, October 1965"],
    [120, "Chorus", "Rubber Soul, side two, track four"],
    [134, "Outro", "John's falsetto closes the song"],
  ]),
];
