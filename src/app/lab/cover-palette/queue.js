import { ALBUMS, FALLBACK_TRACKS } from "@/app/lab/_music/catalog";

const LENGTHS = {
  "I Saw Her Standing There": "2:55",
  Misery: "1:49",
  "Anna (Go to Him)": "2:57",
  "Please Please Me": "2:00",
  "Love Me Do": "2:22",
  "Twist and Shout": "2:33",
  "It Won't Be Long": "2:13",
  "All I've Got to Do": "2:02",
  "All My Loving": "2:07",
  "Roll Over Beethoven": "2:44",
  "Money (That's What I Want)": "2:49",
  "A Hard Day's Night": "2:34",
  "I Should Have Known Better": "2:43",
  "If I Fell": "2:19",
  "And I Love Her": "2:30",
  "Can't Buy Me Love": "2:12",
  "Things We Said Today": "2:35",
  "No Reply": "2:15",
  "I'm a Loser": "2:31",
  "Baby's in Black": "2:04",
  "Eight Days a Week": "2:44",
  "I'll Follow the Sun": "1:46",
  "Help!": "2:18",
  "The Night Before": "2:33",
  "You've Got to Hide Your Love Away": "2:08",
  "Ticket to Ride": "3:10",
  Yesterday: "2:05",
  "Drive My Car": "2:25",
  "Norwegian Wood": "2:05",
  "Nowhere Man": "2:44",
  Michelle: "2:42",
  Girl: "2:30",
  "In My Life": "2:24",
  Taxman: "2:39",
  "Eleanor Rigby": "2:08",
  "I'm Only Sleeping": "3:01",
  "Here, There and Everywhere": "2:25",
  "Yellow Submarine": "2:38",
  "Got to Get You into My Life": "2:29",
  "Tomorrow Never Knows": "2:57",
  "Sgt. Pepper's Lonely Hearts Club Band": "2:02",
  "With a Little Help from My Friends": "2:44",
  "Lucy in the Sky with Diamonds": "3:28",
  "Getting Better": "2:47",
  "She's Leaving Home": "3:35",
  "A Day in the Life": "5:37",
  "Magical Mystery Tour": "2:48",
  "The Fool on the Hill": "3:00",
  "I Am the Walrus": "4:35",
  "Hello, Goodbye": "3:27",
  "Strawberry Fields Forever": "4:07",
  "Penny Lane": "3:00",
  "Back in the U.S.S.R.": "2:43",
  "Dear Prudence": "3:56",
  "While My Guitar Gently Weeps": "4:45",
  Blackbird: "2:18",
  Julia: "2:54",
  "Helter Skelter": "4:29",
  "Come Together": "4:20",
  Something: "3:03",
  "Here Comes the Sun": "3:05",
  Because: "2:45",
  "You Never Give Me Your Money": "4:02",
  "The End": "2:05",
  "Two of Us": "3:36",
  "Across the Universe": "3:48",
  "I Me Mine": "2:25",
  "Let It Be": "4:03",
  "The Long and Winding Road": "3:38",
  "Get Back": "3:09",
};

const seconds = (text) => {
  if (!text) return null;
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
};

const byTitle = new Map(ALBUMS.map((a) => [a.title.toLowerCase(), a]));

const spread = (key) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 150 + (h % 90);
};

export function queueFrom(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const cover = t.imageLarge || t.image;
    if (!cover || seen.has(cover)) continue;
    seen.add(cover);
    const known = t.album ? byTitle.get(String(t.album).toLowerCase()) : null;
    const length = t.durationMs ? Math.round(t.durationMs / 1000) : seconds(LENGTHS[t.title]) ?? spread(`${t.artist}${t.title}`);
    out.push({
      id: String(t.id ?? cover),
      title: t.title,
      artist: t.artist,
      album: t.album || known?.title || null,
      year: t.year ?? known?.year ?? null,
      cover,
      remote: /^https?:/.test(cover),
      length,
    });
    if (out.length === 12) break;
  }
  return out.length < 4 && tracks !== FALLBACK_TRACKS ? queueFrom(FALLBACK_TRACKS) : out;
}
