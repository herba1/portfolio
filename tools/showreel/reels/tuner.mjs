import { piece } from "./_piece.mjs";
// A tuner. Tap to listen; a steady test tone stands in for the guitar.
export default piece({
  url: "/tuner",
  // Chromium's fake microphone plays a steady beep: something for the needle to find.
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"], ready: ".tuner__gate",
  hide: [".tuner__modes"],
  beats: [
    { click: ".tuner__gate", duration: 900, pause: 4500 },
  ],
});
