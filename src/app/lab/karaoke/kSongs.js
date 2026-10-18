import { albumById } from "@/app/lab/_music/catalog";

const song = (album, title, duration, bpm, script) => {
  const a = albumById(album);
  return { id: `${album}-${title}`, title, artist: a.artist, album: a.title, year: a.year, cover: a.cover, duration, bpm, lines: build(script, duration) };
};

function build(script, duration) {
  const rows = [];
  let section = null;
  let part = "";
  for (const entry of script) {
    if (typeof entry === "string") {
      section = entry;
      part = entry;
      continue;
    }
    const [t, text] = entry;
    rows.push({ t, text, section, part });
    section = null;
  }
  return rows.map((row, i) => {
    const end = i + 1 < rows.length ? rows[i + 1].t : duration;
    if (row.text === "") return { kind: "gap", start: row.t, end, section: row.section, part: row.part, words: [] };
    const tokens = row.text.split(" ");
    const span = Math.min(end - row.t, Math.max(2.4, tokens.length * 0.62 + 1.4));
    const weights = tokens.map((w) => (w.endsWith("~") ? 3.2 : 1) * (w.replace("~", "").length + 2));
    const total = weights.reduce((a, b) => a + b, 0);
    let at = row.t;
    const words = tokens.map((w, j) => {
      const d = (weights[j] / total) * span;
      const word = { text: w.replace("~", ""), start: at, end: at + d, hold: w.endsWith("~") };
      at += d;
      return word;
    });
    return { kind: "line", start: row.t, end, section: row.section, part: row.part, words };
  });
}

export const SONGS = [
  song("abbey-road", "Here Comes the Sun", 185, 129, [
    "Intro",
    [0, ""],
    "Verse",
    [14.4, "Frost lets go of the window"],
    [18.4, "cold hands warming by the door"],
    [22.4, "the long grey months are folding"],
    [26.2, "we're not waiting any more~"],
    "Chorus",
    [31, "Look up, the light is breaking"],
    [35, "look up and stay~"],
    [39.5, ""],
    "Verse",
    [44, "Faces turning to the morning"],
    [48, "shadows shorten on the floor"],
    [52, "every street is slowly thawing"],
    [56, "like it never did before~"],
    "Chorus",
    [61, "Look up, the light is breaking"],
    [65, "look up and stay~"],
    [69.5, ""],
    "Bridge",
    [80, "Higher now and higher, rising~"],
    [85.5, "higher now and higher, rising~"],
    [91, "higher now and higher, rising~"],
    [96.5, "higher now and higher~"],
    [102, ""],
    "Verse",
    [108, "Water running off the gutters"],
    [112, "green is pushing through the stone"],
    [116, "all the windows thrown wide open"],
    [120, "and nobody walks alone~"],
    "Chorus",
    [125, "Look up, the light is breaking"],
    [129, "look up and stay~"],
    [133.5, ""],
    "Outro",
    [150, "Look up, the light is breaking"],
    [155, "look up, the light is breaking"],
    [160, "and we'll be fine~"],
    [167, "we'll be fine~"],
    [175, ""],
  ]),
  song("magical-mystery-tour", "Penny Lane", 180, 113, [
    "Intro",
    [0, ""],
    "Verse",
    [6, "On the corner by the bakery"],
    [10.5, "a postman whistles out of tune"],
    [15, "every doorway knows my name here"],
    [19.5, "and the bell rings half past noon~"],
    [24.5, "Paper boys and painted railings"],
    [29, "puddles holding up the sky"],
    "Chorus",
    [34, "Take me back along that road~"],
    [39, "where the morning paints it gold~"],
    [44, ""],
    "Verse",
    [50, "There's a barber with a radio"],
    [54.5, "and a queue outside the shop"],
    [59, "pigeons riding on the bus stop"],
    [63.5, "and the tram that doesn't stop~"],
    "Chorus",
    [69, "Take me back along that road~"],
    [74, "where the morning paints it gold~"],
    [79, ""],
    "Trumpet solo",
    [84, ""],
    "Verse",
    [102, "Rain comes sideways off the river"],
    [106.5, "and the shelter's full of song"],
    [111, "every stranger is a neighbour"],
    [115.5, "and the day is twice as long~"],
    "Chorus",
    [121, "Take me back along that road~"],
    [126, "where the morning paints it gold~"],
    [131, "take me back along that road~"],
    [136, "take me back~"],
    [142, ""],
  ]),
  song("rubber-soul", "In My Life", 146, 103, [
    "Intro",
    [0, ""],
    "Verse",
    [10, "There's a staircase I remember"],
    [15, "and a window over town"],
    [20, "some of the faces have gone quiet"],
    [25, "some still sing when I'm around~"],
    "Chorus",
    [31, "All the rooms I left behind me~"],
    [36.5, "hold a light I carry on~"],
    "Verse",
    [42.5, "There's a voice I keep forever"],
    [47.5, "in the hallway of my head"],
    [52.5, "every word we never finished"],
    [57.5, "all the kindest things we said~"],
    "Piano solo",
    [64, ""],
    "Verse",
    [84, "Still I know I'll never wander"],
    [89, "far from where my heart was born"],
    [94, "but the one I'm holding closer"],
    [99, "is the one who stayed till morn~"],
    "Chorus",
    [105, "All the rooms I left behind me~"],
    [110.5, "hold a light I carry on~"],
    [116, "and it lingers~"],
    [122, "it lingers on~"],
    [130, ""],
  ]),
];
