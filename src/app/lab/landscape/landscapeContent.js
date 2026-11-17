// One structured text, written for the piece: the making of a record, as a
// four-level hierarchy. Every plane is authored at the size it reads at when
// the camera frames it, and `rel` is its scale relative to the plane that
// owns it. All planes stand parallel, on one shared grid.
//
// A plane is placed by how it reads in its owner's poster: seen from the
// owner's viewpoint it appears at `k` times its true size, with the left end
// of its first baseline `dx` right of and `dy` below the owner's (screen px
// at the reference frame). Its depth follows from k, so each level stands
// in front of the one that owns it, and the same placement read the other
// way decides how large and where the owner passes behind it when the camera
// frames the child. `dy: "below"` hangs it under the owner's last line, and
// `dy: "after"` under the sibling before it (see placePlanes).

export const PLANES = [
  {
    id: "title",
    kind: "title",
    rel: 1,
    k: 1, dx: 0, dy: 0,
    kicker: "The making of a record",
    title: "Slow Weather",
    sub: "Nine songs, written in a rented house by the estuary and recorded in one room, January to November.",
  },

  // Chapters hang from one baseline just under the title's, clear of its
  // letters, in the four columns of the grid, each a step further back
  // than the last.
  {
    id: "writing",
    kind: "chapter",
    parent: "title",
    rel: 0.3,
    k: 0.5, dx: 0, dy: 48,
    n: "01",
    when: "January to March",
    title: "Writing",
    line: "Forty-one voice memos, nine of them kept.",
  },
  {
    id: "tracking",
    kind: "chapter",
    parent: "title",
    rel: 0.26,
    k: 0.4, dx: 256, dy: 48,
    n: "02",
    when: "April to June",
    title: "Tracking",
    line: "Eleven days in one room, live, to tape.",
  },
  {
    id: "mixing",
    kind: "chapter",
    parent: "title",
    rel: 0.22,
    k: 0.32, dx: 512, dy: 48,
    n: "03",
    when: "July to September",
    title: "Mixing",
    line: "Fewer faders every week.",
  },
  {
    id: "cutting",
    kind: "chapter",
    parent: "title",
    rel: 0.18,
    k: 0.25, dx: 768, dy: 48,
    n: "04",
    when: "October and November",
    title: "Cutting",
    line: "Lacquer, a test pressing, a sleeve.",
  },

  // Entries run down their chapter's column, each a step further back.
  {
    id: "ferry",
    kind: "entry",
    parent: "writing",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "below",
    date: "9 Jan",
    title: "The ferry riff",
    body: "Hummed on the 7:40 crossing and sung into a phone held inside a coat against the wind. It became the opening of side one.",
  },
  {
    id: "key",
    kind: "entry",
    parent: "writing",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "2 Feb",
    title: "A key change, refused",
    body: "The chorus went up a tone for a week. It sounded braver and meant less. Back down.",
  },
  {
    id: "nine",
    kind: "entry",
    parent: "writing",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "21 Mar",
    title: "Nine",
    body: "Index cards pinned to the kitchen wall in running order. Two were cut the next morning and two more arrived to replace them.",
  },
  {
    id: "room",
    kind: "entry",
    parent: "tracking",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "below",
    date: "14 Apr",
    title: "One room",
    body: "The band set up in a circle with no screens between them. Spill was accepted as part of the sound.",
  },
  {
    id: "take",
    kind: "entry",
    parent: "tracking",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "22 Apr",
    title: "Take seven",
    body: "The title song, played eleven times in an afternoon. The seventh had a dropped beat in the bridge and was the only one anyone wanted to hear again.",
  },
  {
    id: "strings",
    kind: "entry",
    parent: "tracking",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "3 Jun",
    title: "Overdubs, mostly not",
    body: "Strings were written for four songs and recorded for one.",
  },
  {
    id: "roughs",
    kind: "entry",
    parent: "mixing",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "below",
    date: "8 Jul",
    title: "Rough mixes",
    body: "Played in the car on the coast road, the only speakers that mattered.",
  },
  {
    id: "out",
    kind: "entry",
    parent: "mixing",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "19 Aug",
    title: "Taking things out",
    body: "Every pass ended with a mute. The vocal on track five lost its double, then its reverb, then got louder.",
  },
  {
    id: "sequence",
    kind: "entry",
    parent: "mixing",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "26 Sep",
    title: "Sequence",
    body: "Side one ends quietly, so the record is turned over in silence.",
  },
  {
    id: "lacquer",
    kind: "entry",
    parent: "cutting",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "below",
    date: "6 Oct",
    title: "Lacquer",
    body: "Cut at 33⅓ with the loudest song moved to the outside edge, where the groove runs fastest.",
  },
  {
    id: "pressing",
    kind: "entry",
    parent: "cutting",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "30 Oct",
    title: "Test pressing",
    body: "Five copies. One played start to finish without anyone talking. Approved.",
  },
  {
    id: "sleeve",
    kind: "entry",
    parent: "cutting",
    rel: 0.6,
    k: 0.66, dx: 0, dy: "after",
    date: "18 Nov",
    title: "Sleeve",
    body: "Warm white board, black type, one red line.",
  },

  // Notes: the smallest layer, hung under the entry they belong to.
  {
    id: "ferry-note",
    kind: "note",
    parent: "ferry",
    rel: 0.75,
    k: 0.8, dx: 0, dy: "below",
    lines: ["memo_0109_0741.m4a", "0:48, D minor, 72 bpm", "Wind at 0:31,", "kept on the record"],
  },
  {
    id: "room-note",
    kind: "note",
    parent: "room",
    rel: 0.75,
    k: 0.8, dx: 0, dy: "below",
    lines: ["Drums: one ribbon overhead,", "one on the kick", "Bass: DI and a 1x15 cab", "Guitars: in everything"],
  },
  {
    id: "take-note",
    kind: "note",
    parent: "take",
    rel: 0.75,
    k: 0.8, dx: 0, dy: "below",
    lines: ["Reel 4, 2-inch, 15 ips", "Take 7 of 11, 4:52", "Dropped beat at 3:06,", "left in"],
  },
  {
    id: "out-note",
    kind: "note",
    parent: "out",
    rel: 0.75,
    k: 0.8, dx: 0, dy: "below",
    lines: ["Mix 5, version 14", "Vocal +1.5 dB", "Plate reverb off"],
  },
  {
    id: "lacquer-note",
    kind: "note",
    parent: "lacquer",
    rel: 0.75,
    k: 0.8, dx: 0, dy: "below",
    lines: ["Side A 19:40", "Side B 21:12", "Inner groove 2 mm wider"],
  },
  {
    id: "sleeve-note",
    kind: "note",
    parent: "sleeve",
    rel: 0.75,
    k: 0.8, dx: 0, dy: "below",
    lines: ["Board: 350 gsm, uncoated", "Ink: black, and one", "line of warm red"],
  },
];

// The tour: each viewpoint frames one plane head-on at its true size, with
// the left end of its first baseline on the grid's margin and baseline.
export const VIEWS = [
  { plane: "title" },
  { plane: "writing" },
  { plane: "ferry" },
  { plane: "ferry-note" },
  { plane: "tracking" },
  { plane: "room" },
  { plane: "room-note" },
  { plane: "mixing" },
  { plane: "roughs" },
  { plane: "cutting" },
  { plane: "lacquer" },
  { plane: "lacquer-note" },
];
