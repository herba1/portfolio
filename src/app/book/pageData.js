const TONE = "#f1f5f9"; // --color-light, matches site bg

const ON_PAPER = `Paper keeps what the mind misplaces. A mark made in the margin at ten past four means something the whole composition could not.

There is the paper with grain you feel under your thumb, and the paper that is only itself — smooth, white, and indifferent. A letter prefers the first; a form, the second. The hand adjusts without being told.

When a page is turned, a small volume of air moves from one side of the spine to the other. It is the closest thing a book has to breath.`;

const ON_LIGHT = `Light is not a thing but a relationship. It falls across a table and the table becomes a tableau. Put a glass where the light lands and the room has a protagonist.

Morning light is forgiving. Noon light is indifferent. Afternoon light is editorial — it underlines, it highlights, it leaves certain sentences in shadow. Evening light, of course, is a draft with revisions pending.

The quality I trust most is the light that leaks under a door. It tells you someone is awake, or at work, or has simply forgotten the lamp.`;

const ON_HANDS = `The hand is the first draft of thought. It reaches before the sentence is ready, pulls back when a conclusion changes, taps the table when patience runs thin.

Two hands do not agree on everything. The dominant one writes; the other steadies the page. Between them a small negotiation takes place every time a letter is finished — the paper moves a quarter inch, the pen settles, the cursor of attention advances.

To watch a craftsperson work is to watch a conversation between hands. Neither speaks. Both are understood.`;

const ON_TIME = `A morning is not eight hours long. It is three, sometimes four, and the rest is afternoon pretending. Anyone who has tried to begin a difficult sentence after lunch knows this.

Calendars measure duration; attention measures time. An hour in a library and an hour in a waiting room are not the same hour — only an accountant would insist otherwise.

The oldest units of time are still the truest: a breath, a pour, a page. Everything else is approximation.`;

const ON_QUIET = `Quiet is not the absence of sound but the presence of the hum — the refrigerator, the wind against the window, the muffled footfall three rooms away. Remove these and you get silence, which is something stranger and less hospitable.

A quiet room sharpens the hearing until small noises grow teeth. The pen, left too long uncapped, becomes audible by its drying. The paper, turned slowly, reveals a small crackle no one has any reason to notice.

I do not seek silence. I seek a room quiet enough that thinking sounds loud.`;

const ON_TURNING = `To turn a page is to make a small architectural decision. You are adjourning one room and opening another. The previous sentence continues behind you; the next begins with every advantage of newness.

A page that will not turn cleanly is a page that wants to be reread. A page that turns itself is a page that has given up on being remembered.

The best books teach the reader a rhythm — a pace of turning — and then break it exactly once, late, when the effect will matter most.`;

export const PAGES = [
  { title: "herb.art", subtitle: "a small book", tone: TONE, body: "" },
  { title: "i.", subtitle: "on paper", tone: TONE, body: ON_PAPER },
  { title: "ii.", subtitle: "on light", tone: TONE, body: ON_LIGHT },
  { title: "iii.", subtitle: "on hands", tone: TONE, body: ON_HANDS },
  { title: "iv.", subtitle: "on time", tone: TONE, body: ON_TIME },
  { title: "v.", subtitle: "on quiet", tone: TONE, body: ON_QUIET },
  { title: "vi.", subtitle: "on turning", tone: TONE, body: ON_TURNING },
  { title: "—", subtitle: "end.", tone: TONE, body: "" },
];

// Unit square — the Book group scales X by viewport aspect at runtime,
// so the mesh always matches the viewport exactly (no overflow, no bands).
export const PAGE_WIDTH = 1;
export const PAGE_HEIGHT = 1;
export const PAGE_DEPTH = 0.003;
export const PAGE_SEGMENTS = 30;
export const SEGMENT_WIDTH = PAGE_WIDTH / PAGE_SEGMENTS;
export const PAGE_TONE = TONE;
