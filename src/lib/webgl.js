// Whether this browser will hand out a WebGL context right now. False when the
// GPU is blocklisted, or when Chrome has switched WebGL off after its GPU
// process crashed. Probed once with a throwaway 1×1 context, released at once,
// so a scene can render nothing instead of throwing inside three.js.
let available = null;

export function webglAvailable() {
  if (available !== null) return available;
  if (typeof document === "undefined") return false;
  const gl = document.createElement("canvas").getContext("webgl2") ??
    document.createElement("canvas").getContext("webgl");
  available = Boolean(gl && !gl.isContextLost());
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return available;
}
