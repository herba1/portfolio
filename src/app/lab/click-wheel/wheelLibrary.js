import { ALBUMS } from "@/app/lab/_music/catalog";

const LENGTHS = {
  "I Saw Her Standing There": 175,
  Misery: 109,
  "Anna (Go to Him)": 177,
  "Please Please Me": 120,
  "Love Me Do": 142,
  "Twist and Shout": 153,
  "It Won't Be Long": 133,
  "All I've Got to Do": 125,
  "All My Loving": 128,
  "Roll Over Beethoven": 165,
  "Money (That's What I Want)": 169,
  "A Hard Day's Night": 154,
  "I Should Have Known Better": 163,
  "If I Fell": 139,
  "And I Love Her": 150,
  "Can't Buy Me Love": 132,
  "Things We Said Today": 155,
  "No Reply": 135,
  "I'm a Loser": 151,
  "Baby's in Black": 124,
  "Eight Days a Week": 164,
  "I'll Follow the Sun": 106,
  "Help!": 138,
  "The Night Before": 154,
  "You've Got to Hide Your Love Away": 129,
  "Ticket to Ride": 190,
  Yesterday: 125,
  "Drive My Car": 150,
  "Norwegian Wood": 125,
  "Nowhere Man": 164,
  Michelle: 162,
  Girl: 153,
  "In My Life": 147,
  Taxman: 159,
  "Eleanor Rigby": 128,
  "I'm Only Sleeping": 181,
  "Here, There and Everywhere": 145,
  "Yellow Submarine": 160,
  "Got to Get You into My Life": 151,
  "Tomorrow Never Knows": 177,
  "Sgt. Pepper's Lonely Hearts Club Band": 122,
  "With a Little Help from My Friends": 164,
  "Lucy in the Sky with Diamonds": 208,
  "Getting Better": 168,
  "She's Leaving Home": 215,
  "A Day in the Life": 337,
  "Magical Mystery Tour": 168,
  "The Fool on the Hill": 180,
  "I Am the Walrus": 275,
  "Hello, Goodbye": 207,
  "Strawberry Fields Forever": 250,
  "Penny Lane": 180,
  "Back in the U.S.S.R.": 163,
  "Dear Prudence": 236,
  "While My Guitar Gently Weeps": 285,
  Blackbird: 138,
  Julia: 174,
  "Helter Skelter": 269,
  "Come Together": 260,
  Something: 183,
  "Here Comes the Sun": 185,
  Because: 165,
  "You Never Give Me Your Money": 242,
  "The End": 125,
  "Two of Us": 216,
  "Across the Universe": 228,
  "I Me Mine": 145,
  "Let It Be": 243,
  "The Long and Winding Road": 218,
  "Get Back": 189,
};

function hashLength(title) {
  let h = 2166136261;
  for (let i = 0; i < title.length; i += 1) h = Math.imul(h ^ title.charCodeAt(i), 16777619) >>> 0;
  return 150 + (h % 90);
}

export const lengthOf = (title) => LENGTHS[title] ?? hashLength(title);

const sortKey = (s) => s.replace(/^(the|a)\s+/i, "").toLowerCase();
export const bySortKey = (get) => (a, b) => sortKey(get(a)).localeCompare(sortKey(get(b)));

export const LIBRARY_ALBUMS = ALBUMS.map((album) => ({
  ...album,
  songs: album.tracks.map((title) => ({ title, artist: album.artist, album: album.title, cover: album.cover, length: lengthOf(title) })),
})).sort(bySortKey((a) => a.title));

export const LIBRARY_SONGS = LIBRARY_ALBUMS.flatMap((a) => a.songs).sort(bySortKey((s) => s.title));

export const fromTopSong = (t) => ({
  title: t.title,
  artist: t.artist || "Unknown Artist",
  album: t.album || "",
  cover: t.imageLarge || t.image || null,
  length: lengthOf(t.title),
});

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
