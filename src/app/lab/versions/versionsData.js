// Thirteen saved states of one short note, oldest first. Each is a small,
// believable edit of the one before it: a word swapped, a clause added, a
// sentence tightened. The piece shows them newest first.
const DRAFTS = [
  {
    title: "North light",
    body: "The studio faces north, so the light never moves much. In the morning it is grey and in the afternoon it is still grey. I used to think this was a problem.",
  },
  {
    title: "North light",
    body: "The studio faces north, so the light never moves much. In the morning it is grey and in the afternoon it is still grey. I used to think this was a problem. Now I think it is the reason I can work here.",
  },
  {
    title: "North light",
    body: "The studio faces north, so the light barely moves. In the morning it is grey and by the afternoon it is still grey. I used to think this was a problem. Now I think it is the reason I can work here.",
  },
  {
    title: "North light",
    body: "The studio faces north, so the light barely moves. In the morning it is grey and by the afternoon it is still grey. A colour mixed at nine looks the same at four. I used to think this was a problem. Now I think it is the reason I can work here.",
  },
  {
    title: "North light",
    body: "The studio faces north, so the light barely moves all day. In the morning it is grey and by the afternoon it is still grey. A colour mixed at nine is the same colour at four. I used to think this was a problem. Now I think it is the reason I can work here at all.",
  },
  {
    title: "The north window",
    body: "The studio faces north, so the light barely moves all day. It arrives grey in the morning and by the afternoon it is still grey. A colour mixed at nine is the same colour at four. I used to think this was a problem. Now I think it is the reason I can work here at all.",
  },
  {
    title: "The north window",
    body: "The studio faces north, so the light barely moves all day. It arrives grey in the morning and leaves grey in the evening. A colour mixed at nine is the same colour at four. I used to think this was a problem. Now I think it is the reason I can work here at all.",
  },
  {
    title: "The north window",
    body: "The studio faces north, so the light barely moves all day. It arrives grey in the morning and leaves grey in the evening, and nothing in between asks to be looked at. A colour mixed at nine is the same colour at four. I used to think this was a problem. Now I think it is the reason I can work here at all.",
  },
  {
    title: "The north window",
    body: "My studio faces north, so the light barely moves all day. It arrives grey in the morning and leaves grey in the evening, and nothing in between asks to be looked at. A colour mixed at nine is still the same colour at four. For years I thought this was a problem. Now I think it is the reason I can work here at all.",
  },
  {
    title: "The north window",
    body: "My studio faces north, so the light barely moves all day. It arrives grey in the morning and leaves grey in the evening, and nothing in between asks to be looked at. A colour mixed at nine is still the same colour at four. For years I thought this was a flaw in the room. Now I think it is the reason I can work here at all.",
  },
  {
    title: "The north window",
    body: "My studio faces north, so the light barely moves. It arrives grey in the morning and leaves grey in the evening, and nothing in between asks to be looked at. A colour mixed at nine is still the same colour at four. For years I thought this was a flaw in the room. I now think it is the whole reason I can work here.",
  },
  {
    title: "The north window",
    body: "My studio faces north, so the light barely moves. It arrives grey in the morning and leaves grey in the evening, and nothing in between asks to be looked at. A blue mixed at nine is still the same blue at four. For years I thought this was a flaw in the room. I now think it is the whole reason I can work here.",
  },
  {
    title: "The north window",
    body: "My studio faces north, so the light hardly moves. It arrives grey in the morning and leaves grey in the evening, and nothing in between asks to be looked at. A blue mixed at nine is still the same blue at four. For years I took this for a flaw in the room. I now think it is the whole reason I can work here.",
  },
];

// When each state was saved, newest first, as Time Machine would say it.
const WHEN = [
  "Now",
  "Today 14:02",
  "Today 11:47",
  "Today 09:31",
  "Yesterday 22:15",
  "Yesterday 17:40",
  "Wed 16:05",
  "Wed 10:22",
  "Tue 19:48",
  "Mon 08:56",
  "2 Nov 21:10",
  "30 Oct 15:34",
  "24 Oct 11:02",
];

const words = (s) => s.split(/\s+/).filter(Boolean);

// Two words match if they differ only in case or trailing punctuation, so
// "moves." becoming "moves all day." marks "all day." and not "moves".
const key = (w) => w.toLowerCase().replace(/[.,;:!?]+$/, "");

// Word-level diff of `next` against `prev`, as the sequence of operations
// that turns one into the other: each word kept, added or removed, in
// reading order. An LCS is plenty for seventy words.
function align(prev, next) {
  const a = words(prev);
  const b = words(next);
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i][j] = key(a[i]) === key(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && key(a[i]) === key(b[j])) {
      ops.push({ op: "keep", word: b[j] });
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) {
      ops.push({ op: "del", word: a[i] });
      i += 1;
    } else {
      ops.push({ op: "add", word: b[j] });
      j += 1;
    }
  }
  return ops;
}

// The same diff as the front card reads it: every word of `next` tagged
// kept or added, and a count of words removed just before each of them (and
// after the last).
function tag(ops) {
  const out = [];
  let removed = 0;
  ops.forEach(({ op, word }) => {
    if (op === "del") {
      removed += 1;
      return;
    }
    out.push({ word, added: op === "add", removedBefore: removed });
    removed = 0;
  });
  return { tokens: out, removedAfter: removed };
}

// The edit as a proofreader would mark it: added words gathered into runs,
// and two runs with at most two kept words between them joined into one,
// so "looks the same" becoming "is the same colour" reads as one rewritten
// phrase rather than two single-word islands. A run never crosses the end
// of a sentence.
const GAP = 2;
const ends = (w) => /[.!?]$/.test(w);
function runs({ tokens, removedAfter }) {
  const marked = tokens.map((t) => t.added);
  let last = -1;
  tokens.forEach((t, k) => {
    if (!t.added) return;
    const gap = k - last - 1;
    if (last >= 0 && gap > 0 && gap <= GAP && !tokens.slice(last, k).some((x) => ends(x.word))) {
      for (let g = last + 1; g < k; g += 1) marked[g] = true;
    }
    last = k;
  });
  const out = [];
  tokens.forEach((t, k) => {
    const prev = out[out.length - 1];
    if (prev && prev.added === marked[k]) prev.tokens.push(t);
    else out.push({ added: marked[k], tokens: [t] });
  });
  return { runs: out, removedAfter };
}

// What one save changed, as a spine can say it in a line: each edit
// gathered the way the front card gathers its runs (two edits with at most
// two kept words between them, inside one sentence, are one phrase), then
// set as the words it wrote, as "old → new" for a single word swapped, or
// as the struck words when it only took something out. Trailing stops are
// dropped: a spine names a change, it does not quote a sentence.
const bare = (list) => list.join(" ").replace(/[.,;:]+$/, "");
function edits(ops) {
  const hunks = [];
  let open = null;
  // Kept words since the last edit (to judge whether the next one joins
  // it), and since the last added word (to set inside the phrase if it
  // does).
  let kept = [];
  let carry = [];
  ops.forEach(({ op, word }) => {
    if (op === "keep") {
      if (open) {
        kept.push(word);
        carry.push(word);
      }
      return;
    }
    const near = open && kept.length <= GAP && !kept.some(ends) && !(open.add.length && ends(open.add[open.add.length - 1]));
    if (open && !near) {
      hunks.push(open);
      open = null;
    }
    if (!open) {
      open = { add: [], del: [] };
      carry = [];
    }
    if (op === "add") {
      open.add.push(...carry, word);
      carry = [];
    } else open.del.push(word);
    kept = [];
  });
  if (open) hunks.push(open);
  const seen = new Set();
  return hunks
    .map(({ add, del }) => {
      if (!add.length) return { cut: bare(del) };
      if (add.length === 1 && del.length === 1) return { from: bare(del), to: bare(add) };
      return { to: bare(add) };
    })
    .filter((e) => {
      const id = `${e.cut}|${e.from}|${e.to}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

// A spine has one line, its whole measure (the date sits out in the
// margin), so the edits are set until the line is full and no further. Cut
// only at a word: a long phrase keeps its first words and an ellipsis, and
// edits that no longer fit are left as a closing "…" after the last slash.
// The budget is in characters of the grotesk at the meta rung, LINE on the
// front card's 376px measure. Spine type recedes with its sheet, so every
// save keeps the whole measure at whatever depth it sits. CSS still
// ellipsises if a guess runs over.
const LINE = 50;
// The stack's depth, shared with versionsEngine.js: perspective and the
// depth between saves, so a sheet twelve saves back is set at about half
// size.
export const PERSP = 1000;
export const DZ = 70;
// A shortened phrase never ends on a word that leans on the next one.
const WEAK = new Set(["a", "an", "the", "i", "it", "is", "at", "in", "of", "to", "and", "for", "so"]);
const SEP = 2; // a spaced slash or arrow, in characters
const len = (e) => (e.cut ?? "").length + (e.from != null ? e.from.length + SEP : 0) + (e.to ?? "").length;
function fit(list) {
  let room = LINE;
  const out = [];
  for (const e of list) {
    const need = len(e) + (out.length ? SEP : 0);
    if (need <= room) {
      out.push(e);
      room -= need;
      continue;
    }
    // Shorten a phrase to its first words if two or more of them fit.
    const field = e.cut != null ? "cut" : "to";
    const head = [];
    let left = room - (out.length ? SEP : 0) - 1 - (e.from != null ? e.from.length + SEP : 0);
    for (const w of e[field].split(" ")) {
      if (w.length + (head.length ? 1 : 0) > left) break;
      left -= w.length + (head.length ? 1 : 0);
      head.push(w);
    }
    while (head.length && WEAK.has(head[head.length - 1].toLowerCase())) head.pop();
    if (head.length >= 2) out.push({ ...e, [field]: `${head.join(" ").replace(/[,;:]$/, "")}…` });
    else out.push({ more: true });
    break;
  }
  return out;
}

// Newest first. Each version carries its diff against the state it
// replaced, worked out once here: tagged for the front card's mark-up, and
// summed up as the edits its spine sets. The first draft has nothing to
// compare with, so nothing is marked and its spine names what it began.
export const VERSIONS = DRAFTS.map((d, k) => {
  const prev = DRAFTS[k - 1];
  const plain = (s) => words(s).map((word) => ({ op: "keep", word }));
  const title = prev ? align(prev.title, d.title) : plain(d.title);
  const body = prev ? align(prev.body, d.body) : plain(d.body);
  return {
    when: WHEN[DRAFTS.length - 1 - k],
    title: runs(tag(title)),
    body: runs(tag(body)),
    change: fit(prev ? [...edits(title), ...edits(body)] : [{ to: d.title }]),
  };
}).reverse();

export const COUNT = VERSIONS.length;
