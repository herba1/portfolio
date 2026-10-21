// Hand the main thread back so a long bake splits into short tasks: input,
// scrolling and every other piece's frame get a turn in between.
export default function yieldToMain() {
  return new Promise((resolve) => {
    if (globalThis.scheduler?.yield) globalThis.scheduler.yield().then(resolve);
    else setTimeout(resolve, 0);
  });
}
