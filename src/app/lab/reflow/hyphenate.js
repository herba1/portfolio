import { PATTERNS, EXCEPTIONS } from "./hyphenPatterns";

// Liang's algorithm (TeX's hyphenation): every pattern is a letter string
// with digits between its letters. Slide each pattern that matches over the
// dotted word, keep the highest digit at each gap, break at the odd ones.
// Two letters before the first break and two after the last: the Swiss
// minimum rather than TeX's three, so a narrow measure beside the letter has
// enough places to break ("feath-er", "nev-er").

const LEFT_MIN = 2;
const RIGHT_MIN = 2;

let trie = null;
let exceptions = null;

function build() {
  trie = new Map();
  for (const pat of PATTERNS.split(/\s+/)) {
    if (!pat) continue;
    const letters = pat.replace(/\d/g, "");
    const points = [];
    let gap = 0;
    for (const ch of pat) {
      if (ch >= "0" && ch <= "9") points[gap] = +ch;
      else gap += 1;
    }
    for (let i = 0; i <= letters.length; i += 1) points[i] = points[i] || 0;
    trie.set(letters, points);
  }
  exceptions = new Map();
  for (const e of EXCEPTIONS.split(/\s+/)) if (e) exceptions.set(e.replace(/-/g, ""), e.split("-"));
}

const cache = new Map();

// Splits a lowercase-insensitive alphabetic word into its syllables for
// breaking: "rosemary" -> ["rose", "mary"].
export function syllables(word) {
  let hit = cache.get(word);
  if (hit) return hit;
  if (!trie) build();
  const lower = word.toLowerCase();
  if (word.length < LEFT_MIN + RIGHT_MIN || !/^[a-z]+$/.test(lower)) hit = [word];
  else if (exceptions.has(lower)) {
    hit = [];
    let at = 0;
    for (const part of exceptions.get(lower)) {
      hit.push(word.slice(at, at + part.length));
      at += part.length;
    }
  } else {
    const dotted = `.${lower}.`;
    const pts = new Array(dotted.length + 1).fill(0);
    for (let i = 0; i < dotted.length; i += 1) {
      for (let j = i + 1; j <= dotted.length; j += 1) {
        const p = trie.get(dotted.slice(i, j));
        if (!p) continue;
        for (let k = 0; k < p.length; k += 1) if (p[k] > pts[i + k]) pts[i + k] = p[k];
      }
    }
    // pts[g] is the gap before dotted[g]; dotted[g] is word[g - 1].
    hit = [];
    let start = 0;
    for (let i = LEFT_MIN; i <= word.length - RIGHT_MIN; i += 1) {
      if (pts[i + 1] % 2 === 1) {
        hit.push(word.slice(start, i));
        start = i;
      }
    }
    hit.push(word.slice(start));
  }
  cache.set(word, hit);
  return hit;
}

// Hyphenates a token that may carry punctuation: "rosemary," keeps the comma
// on its last part and "peacock’s" breaks only before its apostrophe.
export function hyphenateToken(token) {
  const m = /^([^A-Za-z]*)([A-Za-z]+)((?:[’'][a-z]{1,2})?[^A-Za-z]*)$/.exec(token);
  if (!m) return [token];
  const parts = syllables(m[2]).slice();
  parts[0] = m[1] + parts[0];
  parts[parts.length - 1] += m[3];
  return parts;
}
