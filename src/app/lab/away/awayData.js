export const PALETTE = ["#000000", "#000080", "#0000ff", "#008080", "#008000", "#800080", "#c71585", "#800000", "#ff4500", "#b8860b", "#4682b4", "#696969"];

export const SIZES = [
  { id: "small", label: "Small", px: 11, lh: 16 },
  { id: "normal", label: "Normal", px: 13, lh: 16 },
  { id: "large", label: "Large", px: 16, lh: 20 },
];

export const PRESET_MESSAGES = [
  { label: "walk home", text: "it must be out there.", color: "#000080" },
  { label: "streetlights", text: "out till the streetlights go soft. leave me something to read on the walk home", color: "#800080" },
  { label: "not tonight", text: "you don't have to be anyone tonight. neither do i.", color: "#008080" },
  { label: "sleeping", text: "asleep, probably dreaming about the sea. still here though", color: "#4682b4" },
];

export const BUDDIES = [
  { id: "seaglass", name: "seaglass", group: "Buddies", status: "online", since: 41 },
  { id: "streetlightsoft", name: "streetlightsoft", group: "Buddies", status: "away", color: "#800080", message: "out till the streetlights go soft. i'll read everything on the walk home", since: 23 },
  { id: "mae", name: "mae on the 6 train", group: "Buddies", status: "idle", idle: 14, since: 96 },
  { id: "littlewing", name: "littlewing04", group: "Buddies", status: "away", color: "#c71585", italic: true, message: "it will take a while to feel like this again", since: 8 },
  { id: "northbound", name: "northbound", group: "Buddies", status: "offline" },
  { id: "paperstar", name: "paperstar", group: "Buddies", status: "away", color: "#b8860b", message: "a lot will go wrong before everything goes right ☆", since: 52 },
  { id: "juniper", name: "juniper", group: "Buddies", status: "online", listening: "Blackbird", since: 12 },
  { id: "rooftop", name: "rooftop radio", group: "Buddies", status: "offline" },
  { id: "mom", name: "mom", group: "Family", status: "away", color: "#008000", message: "at the shop, call if you need anything. love you x", since: 31 },
  { id: "dad", name: "dad", group: "Family", status: "offline" },
  { id: "nina", name: "nina", group: "Family", status: "online", since: 64 },
];

export const IM_OPENERS = [
  { from: "seaglass", text: "you still up? just heard here comes the sun on the bus and thought of you" },
  { from: "juniper", text: "are you walking home? text me when you get in" },
  { from: "nina", text: "found that photo from the beach, the one with the fish" },
];

export const IM_REPLIES = ["ok :) talk tomorrow", "sleep well when you get there", "haha ok. same time tomorrow?"];
