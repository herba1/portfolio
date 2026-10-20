const LETTERS = { 2: "abc", 3: "def", 4: "ghi", 5: "jkl", 6: "mno", 7: "pqrs", 8: "tuv", 9: "wxyz" };

export const PUNCT = [".", ",", "?", "!", "'", "-", "1"];

const KEY_OF = {};
for (const [k, letters] of Object.entries(LETTERS)) for (const ch of letters) KEY_OF[ch] = k;

const WORDS = `the of and to a in is you that it was for on are as with his they i at be this have from or one had by but not what all were we when your can said there an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more go see no way could people my than first been call who its now find long down day did get come made may part good home gone hood hoof me us still keep voice walk sun run rum outside here comes bones x take tale while feel again land hey really love miss night soon text back tonight later okay yes yeah sorry thanks hello sleep think always know song record play listen around tell went just need want home late early sea sky light window coat rain walking talk talking soft stay night city last song songs ever best world still need dear morning new open close kind nice warm cold slow ok oh he if in go`
  .split(/\s+/)
  .filter(Boolean);

const ORDERED = [];
const seen = new Set();
for (const w of WORDS) {
  if (seen.has(w)) continue;
  seen.add(w);
  ORDERED.push(w);
}

export function keyFor(ch) {
  return KEY_OF[ch] || null;
}

export function lettersFor(key) {
  return LETTERS[key] || "";
}

export function digitsOf(word) {
  return [...word].map((c) => KEY_OF[c] || "").join("");
}

const BY_DIGITS = new Map();
for (const w of ORDERED) {
  const d = digitsOf(w);
  if (!BY_DIGITS.has(d)) BY_DIGITS.set(d, []);
  BY_DIGITS.get(d).push(w);
}

export function candidates(digits) {
  const exact = BY_DIGITS.get(digits);
  if (exact && exact.length) return exact;
  for (const w of ORDERED) {
    const d = digitsOf(w);
    if (d.length > digits.length && d.startsWith(digits)) return [w.slice(0, digits.length)];
  }
  return [[...digits].map((k) => LETTERS[k]?.[0] ?? "").join("")];
}
