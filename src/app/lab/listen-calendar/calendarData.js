import { ALBUMS } from "@/app/lab/_music/catalog";

const YEAR = 2025;
const DAY_MS = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIGHTS = {
  "abbey-road": 6,
  revolver: 5,
  "rubber-soul": 5,
  "sgt-pepper": 3,
  "white-album": 0,
  "let-it-be": 3,
  "magical-mystery-tour": 2,
  help: 2,
  "a-hard-days-night": 2,
  "please-please-me": 1,
  "with-the-beatles": 1,
  "beatles-for-sale": 1,
};

function pickWeighted(rand) {
  const total = ALBUMS.reduce((s, a) => s + (WEIGHTS[a.id] ?? 1), 0);
  let r = rand() * total;
  for (const a of ALBUMS) {
    r -= WEIGHTS[a.id] ?? 1;
    if (r <= 0) return a;
  }
  return ALBUMS[0];
}

const pad = (n) => String(n).padStart(2, "0");

function buildYear() {
  const rand = mulberry32(1966);
  const start = Date.UTC(YEAR, 0, 1);
  const count = (Date.UTC(YEAR + 1, 0, 1) - start) / DAY_MS;
  const offset = new Date(start).getUTCDay();
  const days = [];
  let phaseAlbum = pickWeighted(rand);
  let phaseLeft = 0;
  for (let i = 0; i < count; i += 1) {
    if (phaseLeft <= 0) {
      phaseAlbum = pickWeighted(rand);
      phaseLeft = 2 + Math.floor(rand() * 6);
    }
    phaseLeft -= 1;
    const date = new Date(start + i * DAY_MS);
    const weekday = date.getUTCDay();
    const month = date.getUTCMonth();
    const weekend = weekday === 0 || weekday === 6;
    const season = Math.sin(((i - 20) / count) * Math.PI * 2) * 6;
    const away = (i >= 214 && i <= 222) || (i >= 355 && i <= 359);
    let plays = 0;
    if (!away && rand() > 0.1) {
      const base = 18 + (weekend ? 14 : 0) + season;
      plays = Math.max(1, Math.round(base * (0.25 + rand() * 1.3)));
    }
    const songs = [];
    if (plays) {
      const n = Math.min(plays, 3 + Math.floor(rand() * 4));
      let minute = (7 + Math.floor(rand() * 4)) * 60 + Math.floor(rand() * 60);
      for (let s = 0; s < n; s += 1) {
        const album = s === 0 || rand() < 0.62 ? phaseAlbum : pickWeighted(rand);
        const title = album.tracks[Math.floor(rand() * album.tracks.length)];
        songs.push({ title, album: album.title, cover: album.cover, time: `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}` });
        minute += 40 + Math.floor(rand() * 150);
      }
    }
    days.push({
      i,
      cell: i + offset,
      week: Math.floor((i + offset) / 7),
      weekday,
      month,
      date: date.getUTCDate(),
      dateLabel: `${WEEKDAYS[weekday]}, ${date.getUTCDate()} ${MONTHS[month]}`,
      shortLabel: `${MONTHS[month].slice(0, 3)} ${date.getUTCDate()}`,
      plays,
      minutes: Math.round(plays * (2.6 + rand() * 0.8)),
      album: plays ? phaseAlbum : null,
      songs,
    });
  }
  const sorted = days.map((d) => d.plays).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  for (const d of days) d.level = !d.plays ? 0 : d.plays <= cuts[0] ? 1 : d.plays <= cuts[1] ? 2 : d.plays <= cuts[2] ? 3 : 4;

  let streak = 0;
  let longest = 0;
  for (const d of days) {
    streak = d.plays ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const byAlbum = new Map();
  for (const d of days) if (d.album) byAlbum.set(d.album.id, (byAlbum.get(d.album.id) ?? 0) + d.plays);
  const topId = [...byAlbum.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const months = MONTHS.map((name, m) => ({ name: name.slice(0, 3), week: days.find((d) => d.month === m).week }));
  return {
    year: YEAR,
    days,
    weeks: days[days.length - 1].week + 1,
    offset,
    months,
    stats: {
      minutes: days.reduce((s, d) => s + d.minutes, 0),
      plays: days.reduce((s, d) => s + d.plays, 0),
      active: days.filter((d) => d.plays).length,
      longest,
      top: ALBUMS.find((a) => a.id === topId),
    },
  };
}

export const CALENDAR = buildYear();
