export const WEFT_LINES = [
  ["the room holds its breath before the drop", "00:47"],
  ["someone left their coat on the monitor", "01:02"],
  ["the kick drum keeps time for all of us", "01:11"],
  ["strobe catches your hands mid sentence", "01:20"],
  ["we said one more song four songs ago", "01:34"],
  ["a dropped glass lands on the hi hat", "01:41"],
  ["the bassline walks you home in the rain", "01:53"],
  ["cables coiled asleep beside the stage", "02:06"],
  ["your name lost in the fog machine", "02:14"],
  ["the bartender counting down in minor keys", "02:22"],
  ["blue light, slow fade, nobody leaves", "02:31"],
  ["headphones half on, half the world away", "02:40"],
  ["last train gone, the floor still moving", "02:52"],
  ["sweat on the sleeve, smoke in the lights", "03:03"],
  ["the encore nobody asked for, everybody wanted", "03:12"],
  ["cloakroom ticket two one four, still in my pocket", "03:21"],
  ["outside the city hums the same chord", "03:29"],
  ["the needle lifts and the room exhales", "03:38"],
  ["we danced until the windows went grey", "03:46"],
  ["the set ends where the morning starts", "03:58"],
  ["every song tonight sounds like leaving", "04:05"],
  ["the last chord rings in the empty hall", "04:12"],
];

export const WARP_LINES = [
  "turn it up and let the dark hold us",
  "one more loop before the lights come on",
  "your heartbeat under the bassline",
  "the speakers breathe like a sleeping animal",
  "nobody here remembers how we got here",
  "the floor is warm from all of us",
  "hold the note until the morning finds it",
  "we were louder than the rain tonight",
  "the low end hums inside my ribs",
  "sing it back, the room already knows",
  "a slow fade written in red light",
  "we kept dancing after the music stopped",
  "the echo follows us out the door",
  "tape hiss and taillights all the way home",
  "every face a little brighter in the smoke",
  "stay until the chorus comes around again",
  "the crowd sways like a field of wheat",
  "you laughed right on the downbeat",
];

export const TONES = [
  [0.953, 0.929, 0.882],
  [0.929, 0.898, 0.835],
  [0.965, 0.945, 0.906],
  [0.906, 0.871, 0.8],
  [0.886, 0.847, 0.773],
  [0.71, 0.33, 0.18],
];

export const INK = [0.13, 0.11, 0.095];
export const INK_ON_ACCENT = [0.96, 0.92, 0.85];
export const ACCENT_TONE = 5;

export function weftTone(i) {
  if (i % 7 === 4) return ACCENT_TONE;
  return [0, 2, 1, 2, 0, 1, 2][i % 7];
}

export function warpTone(i) {
  if (i % 9 === 6) return ACCENT_TONE;
  return [3, 4, 3, 1, 4, 3, 4, 3, 1][i % 9];
}

export const WEAVES = [
  { id: "plain", label: "Plain", note: "One over, one under" },
  { id: "twill", label: "Twill", note: "Two over, two under, stepped into a diagonal" },
  { id: "basket", label: "Basket", note: "Pairs over pairs" },
];
