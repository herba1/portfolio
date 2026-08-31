export function sanitise(incoming, defaults) {
  if (!incoming || typeof incoming !== "object") return null;
  const next = { ...defaults };
  let matched = 0;
  for (const key of Object.keys(defaults)) {
    const value = incoming[key];
    if (value === undefined) continue;
    if (typeof value !== typeof defaults[key]) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    next[key] = value;
    matched += 1;
  }
  return matched > 0 ? next : null;
}

export function loadStored(key, defaults) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return sanitise(JSON.parse(raw), defaults);
  } catch {
    return null;
  }
}

export function storeParams(key, params) {
  try {
    window.localStorage.setItem(key, JSON.stringify(params));
  } catch {
    /* storage unavailable or full */
  }
}

export function clearStored(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export async function copyParams(params) {
  const text = JSON.stringify(params, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}

export async function readParams(defaults) {
  let text = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = window.prompt("Paste a saved config");
  }
  if (!text) return null;
  try {
    return sanitise(JSON.parse(text), defaults);
  } catch {
    return null;
  }
}
