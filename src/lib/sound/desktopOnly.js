// Interface sound is for a mouse and speakers. On a phone or any touch-first
// screen the pieces stay silent: clicks and foley under a thumb, in a pocket
// or on a bus, are noise. Music a visitor starts on purpose is not covered.
export const soundAllowed = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
