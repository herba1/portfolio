// Gives each entry of a *Takes.js its key and name, so the engine can ask
// the render worker for it by name (a function cannot cross to a worker).
export function label(key, takes) {
  for (const [name, spec] of Object.entries(takes)) Object.assign(spec, { key, name });
  return takes;
}
