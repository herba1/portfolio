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

// Word-level diff of `next` against `prev`: every word of `next` tagged
// kept or added, and a count of words removed just before each of them (and
// after the last). An LCS is plenty for seventy words.
function diff(prev, next) {
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
  const out = [];
  let removed = 0;
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && key(a[i]) === key(b[j])) {
      out.push({ word: b[j], added: false, removedBefore: removed });
      removed = 0;
      i += 1;
      j += 1;
    } else if (i < n && L[i + 1][j] >= L[i][j + 1]) {
      removed += 1;
      i += 1;
    } else {
      out.push({ word: b[j], added: true, removedBefore: removed });
      removed = 0;
      j += 1;
    }
  }
  return { tokens: out, removedAfter: removed + (n - i) };
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

// Newest first. Each version carries its diff against the state it replaced;
// the first draft has nothing to compare with, so nothing is marked.
export const VERSIONS = DRAFTS.map((d, k) => {
  const prev = DRAFTS[k - 1];
  const plain = (s) => ({ tokens: words(s).map((word) => ({ word, added: false, removedBefore: 0 })), removedAfter: 0 });
  return {
    when: WHEN[DRAFTS.length - 1 - k],
    title: runs(prev ? diff(prev.title, d.title) : plain(d.title)),
    body: runs(prev ? diff(prev.body, d.body) : plain(d.body)),
  };
}).reverse();

export const COUNT = VERSIONS.length;
