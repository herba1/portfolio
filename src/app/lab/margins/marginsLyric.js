export const TITLE = "the walk home";
export const META = "words, second draft";

export const STANZAS = [
  ["the streetlights go soft around eleven", "and the last bus runs late like it always does", "i keep your voice on the walk home", "low, like a song i only half remember"],
  ["we can stay out till the city forgets us", "nothing good comes easy but it comes", "you don't have to be anyone tonight", "still here? how are you? i'm still here"],
  ["it will take a while to feel like this again", "so i'm writing it down before it goes"],
];

export const NOTES = ["every time", "yes. this.", "say it slower", "keep this one", "the whole song is here", "true", "again?", "for later", "this is the line"];

export function buildWords() {
  let id = 0;
  return STANZAS.map((stanza) =>
    stanza.map((line) =>
      line.split(" ").map((text) => {
        const word = { id, text };
        id += 1;
        return word;
      }),
    ),
  );
}
