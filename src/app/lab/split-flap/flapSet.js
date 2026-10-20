export const DRUM = " AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789:.,'-&/!?";

export const DRUM_INDEX = new Map([...DRUM].map((ch, i) => [ch, i]));

export const TRACKS = [
  { id: "taxman", title: "Taxman", dur: 159 },
  { id: "help", title: "Help!", dur: 138 },
  { id: "something", title: "Something", dur: 183 },
  { id: "penny-lane", title: "Penny Lane", dur: 180 },
  { id: "blackbird", title: "Blackbird", dur: 138 },
  { id: "get-back", title: "Get Back", dur: 189 },
  { id: "yesterday", title: "Yesterday", dur: 125 },
  { id: "hey-jude", title: "Hey Jude", dur: 431, encore: true },
];

const BY_ID = new Map(TRACKS.map((t) => [t.id, t]));

const SET_START = 21 * 60 * 60;

export const STATUS_WORDS = {
  11: { now: "Now playing", next: "Up next", later: "On time", encore: "Encore", played: "Played" },
  7: { now: "Playing", next: "Up next", later: "On time", encore: "Encore", played: "Played" },
};

export function initialSet() {
  return {
    rows: ["something", "penny-lane", "blackbird", "get-back", "yesterday", "hey-jude", "taxman", "help"],
    played: new Set(["taxman", "help"]),
    titles: new Map(),
  };
}

export function cleanTitle(value, max) {
  return [...value].filter((ch) => DRUM_INDEX.has(ch)).join("").slice(0, max);
}

export function titleOf(set, id) {
  return set.titles.has(id) ? set.titles.get(id) : BY_ID.get(id).title;
}

function clock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fit(text, n) {
  const clipped = text.length > n ? text.slice(0, n) : text;
  return clipped.padEnd(n, " ");
}

export function rowLines(set, layout) {
  const unplayed = set.rows.filter((id) => !set.played.has(id));
  const played = set.rows.filter((id) => set.played.has(id));
  const times = new Map();
  let t = SET_START;
  for (const id of [...played, ...unplayed]) {
    times.set(id, t);
    t += BY_ID.get(id).dur;
  }
  const words = STATUS_WORDS[layout.status];
  return set.rows.slice(0, layout.rows).map((id, i) => {
    let status = "";
    if (words) {
      if (set.played.has(id)) status = words.played;
      else if (i === 0) status = words.now;
      else if (i === 1) status = words.next;
      else if (BY_ID.get(id).encore) status = words.encore;
      else status = words.later;
    }
    return {
      id,
      time: clock(times.get(id)),
      title: fit(titleOf(set, id), layout.title),
      status: layout.status ? fit(status, layout.status) : "",
    };
  });
}

export function playRow(set, index) {
  const id = set.rows[index];
  const now = set.rows[0];
  if (!id || index === 0) return set;
  const played = new Set(set.played);
  played.add(now);
  played.delete(id);
  const rest = set.rows.filter((r) => r !== id && r !== now);
  const unplayed = rest.filter((r) => !played.has(r));
  const done = [...rest.filter((r) => played.has(r) && r !== now), now];
  return { ...set, rows: [id, ...unplayed, ...done], played };
}

export function moveRow(set, from, to) {
  if (from === to) return set;
  const rows = [...set.rows];
  const [id] = rows.splice(from, 1);
  rows.splice(to, 0, id);
  const played = new Set(set.played);
  const firstPlayed = rows.findIndex((r, i) => i !== to && played.has(r));
  const beforeIndex = firstPlayed === -1 ? rows.length : firstPlayed;
  if (to === 0 || to < beforeIndex) played.delete(id);
  else played.add(id);
  if (rows.every((r) => played.has(r))) played.delete(rows[0]);
  const unplayed = rows.filter((r) => !played.has(r));
  const done = rows.filter((r) => played.has(r));
  return { ...set, rows: [...unplayed, ...done], played };
}

export function renameRow(set, index, title) {
  const titles = new Map(set.titles);
  titles.set(set.rows[index], title);
  return { ...set, titles };
}
