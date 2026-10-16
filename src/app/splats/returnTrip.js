// Coming back from an article. The back link arms the return with the slug
// you were reading; the index centres that card in the rail in a layout
// effect before the first paint, so the splat you came back with flies into a
// card that is already on screen — even if you paged through several
// articles with "Next" first.

let returning = null;

export function armReturn(slug) {
  returning = slug;
}

export function takeReturn() {
  const slug = returning;
  returning = null;
  return slug;
}
