// How each piece is played, shown on its tile until the visitor first takes
// hold of it: a line of instruction, and a ghost hand acting it out.
//
//   text     the line on a desktop
//   touch    the line on a touch screen, when it differs
//   gesture  "tap" | "hold" | "drag" | "hover" (a pass with no press)
//   from/to  where the hand starts and ends, as fractions of the tile
//
// A lab manifest's own `hint` (same shape) wins over the entry here.
export const HINTS = {
  "/lab/skin": { text: "Click a song to hear it in 8-bit", touch: "Tap a song to hear it in 8-bit", gesture: "tap", from: [0.5, 0.72] },
  "/lab/moire": { text: "Drag to slide the top screen", gesture: "drag", from: [0.35, 0.5], to: [0.65, 0.55] },
  "/lab/field": { text: "Move through it, or type a word", touch: "Swipe through the field", gesture: "hover", from: [0.25, 0.5], to: [0.75, 0.5] },
  "/lab/justify": { text: "Drag the right edge", gesture: "drag", from: [0.8, 0.35], to: [0.6, 0.38] },
  "/lab/scope": { text: "Type anything to draw it", touch: "Tap, then type to draw it", gesture: "tap", from: [0.5, 0.5] },
  "/lab/generation-loss": { text: "Drag sideways through the copies", gesture: "drag", from: [0.3, 0.42], to: [0.7, 0.42] },
  "/lab/blob-track": { text: "Move to steer the tracker", touch: "Drag to steer the tracker", gesture: "hover", from: [0.3, 0.4], to: [0.7, 0.6] },
  "/lab/terminal": { text: "Click a record to play it", touch: "Tap a record to play it", gesture: "tap", from: [0.3, 0.45] },
  "/lab/kern": { text: "Pull a letter, or type a word", touch: "Pull a letter", gesture: "drag", from: [0.45, 0.5], to: [0.62, 0.36] },
  "/lab/t9": { text: "Type to take over the phone", touch: "Tap, then type", gesture: "tap", from: [0.5, 0.5] },
  "/lab/smear": { text: "Drag across the words", gesture: "drag", from: [0.25, 0.45], to: [0.75, 0.5] },
  "/lab/focus-pull": { text: "Click a line to pull focus", touch: "Tap a line to pull focus", gesture: "tap", from: [0.5, 0.4] },
  "/lab/select": { text: "Drag a selection handle", gesture: "drag", from: [0.42, 0.5], to: [0.62, 0.62] },
  "/lab/steam": { text: "Move across the words", touch: "Swipe across the words", gesture: "hover", from: [0.2, 0.5], to: [0.8, 0.5] },
  "/lab/hold-menu": { text: "Press and hold a cover", gesture: "hold", from: [0.25, 0.35] },
  "/lab/coverflow": { text: "Drag the covers sideways", touch: "Swipe the covers sideways", gesture: "drag", from: [0.65, 0.45], to: [0.35, 0.45] },
  "/lab/pull-vinyl": { text: "Pull the list down", touch: "Tap Focus, then pull the list down", gesture: "drag", from: [0.5, 0.3], to: [0.5, 0.6] },
  "/lab/ascii-bust": { text: "Drag to turn the bust", touch: "Swipe to turn the bust", gesture: "drag", from: [0.35, 0.5], to: [0.65, 0.5] },
  "/lab/film-leader": { text: "Pull the film out of the canister", gesture: "drag", from: [0.5, 0.6], to: [0.68, 0.82] },
  "/lab/erase": { text: "Click a song to rewrite it", touch: "Tap a song to rewrite it", gesture: "tap", from: [0.42, 0.4] },
  "/lab/ghost-setlist": { text: "Scroll or drag through the songs", touch: "Tap Focus, then drag through the songs", gesture: "drag", from: [0.5, 0.65], to: [0.5, 0.35] },
  "/lab/light-table": { text: "Drag the film around", gesture: "drag", from: [0.45, 0.55], to: [0.65, 0.45] },
  "/lab/raking-light": { text: "Move the lamp", touch: "Drag the lamp", gesture: "hover", from: [0.3, 0.4], to: [0.7, 0.6] },
  "/lab/refractor": { text: "Click the disc to turn it over", touch: "Tap the disc to turn it over", gesture: "tap", from: [0.5, 0.5] },
  "/lab/typewriter": { text: "Type on your keyboard", touch: "Tap the page, then type", gesture: "tap", from: [0.5, 0.4] },
  "/lab/amorph": { text: "Click the print to burst it", touch: "Tap the print to burst it", gesture: "tap", from: [0.5, 0.5] },
  "/lab/crumple": { text: "Press to crumple the print", touch: "Tap to crumple the print", gesture: "tap", from: [0.5, 0.5] },
  "/lab/ink-drag": { text: "Drag through the ink", gesture: "drag", from: [0.3, 0.5], to: [0.7, 0.45] },
  "/lab/dandelion": { text: "Swipe to blow the seeds", gesture: "drag", from: [0.3, 0.55], to: [0.75, 0.45] },
  "/lab/iris": { text: "Turn the ring to stop down", touch: "Swipe the ring to stop down", gesture: "drag", from: [0.36, 0.3], to: [0.64, 0.3] },
  "/lab/loupe": { text: "Slide the loupe over the print", gesture: "drag", from: [0.4, 0.5], to: [0.65, 0.4] },
  "/lab/mirrorball": { text: "Drag to spin it faster", touch: "Swipe to spin it faster", gesture: "drag", from: [0.3, 0.5], to: [0.7, 0.5] },
  "/lab/split-flap": { text: "Click below to switch films", touch: "Tap below to switch films", gesture: "tap", from: [0.5, 0.86] },
  "/lab/sticker-peel": { text: "Peel the sticker from its corner", gesture: "drag", from: [0.62, 0.36], to: [0.42, 0.55] },
  "/scorch": { text: "Press and drag to burn the print", touch: "Drag to burn the print", gesture: "drag", from: [0.4, 0.45], to: [0.62, 0.6] },
  "/stir": { text: "Swipe along a row to stir it", gesture: "drag", from: [0.25, 0.4], to: [0.75, 0.4] },
  "/taffy": { text: "Pull a letter out of the word", gesture: "drag", from: [0.4, 0.45], to: [0.58, 0.72] },
  "/counter": { text: "Click to fall through the o", touch: "Tap to fall through the o", gesture: "tap", from: [0.5, 0.5] },
  "/one-line": { text: "Click a tab to thread it", touch: "Tap a tab to thread it", gesture: "tap", from: [0.6, 0.78] },
  "/wet-ink": { text: "Drag to take the brush", gesture: "drag", from: [0.35, 0.4], to: [0.65, 0.6] },
  "/cover-ring": { text: "Drag to spin the ring", touch: "Swipe to spin the ring", gesture: "drag", from: [0.35, 0.55], to: [0.65, 0.55] },
  "/blobs": { text: "Click to change the flowers", touch: "Tap to change the flowers", gesture: "tap", from: [0.5, 0.5] },
  "/ink": { text: "Click to change the print", touch: "Tap to change the print", gesture: "tap", from: [0.5, 0.5] },
  "/refract": { text: "Click to change the plate", touch: "Tap to change the plate", gesture: "tap", from: [0.5, 0.5] },
  "/halftone": { text: "Click to change the plate", touch: "Tap to change the plate", gesture: "tap", from: [0.5, 0.5] },
  "/backdrop": { text: "Press play", gesture: "tap", from: [0.5, 0.64] },
  "/song-search": { text: "Click the bar and search a song", touch: "Tap the bar and search a song", gesture: "tap", from: [0.5, 0.8] },
  "/deck": { text: "Drag through the stack, click to fan it out", touch: "Swipe sideways, tap to fan it out", gesture: "drag", from: [0.65, 0.55], to: [0.4, 0.55] },
  "/flyout": { text: "Click a heart to add a song", touch: "Tap a heart to add a song", gesture: "tap", from: [0.42, 0.3] },
  "/tuner": { text: "Allow the mic and play a note", touch: "Allow the mic and play a note", gesture: "tap", from: [0.5, 0.5] },
};

// Any other piece still says it can be played.
export const DEFAULT_HINT = { text: "Click or drag to play", touch: "Tap or swipe to play", gesture: "tap", from: [0.5, 0.5] };
