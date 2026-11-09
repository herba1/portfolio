import { piece } from "./_piece.mjs";
// Pull-to-refresh: drag the card down, the record rolls out of its sleeve; let go and it spins.
export default piece({
  url: "/lab/pull-vinyl", ready: ".pull-vinyl-screen",
  beats: [
    { press: [0.5, 0.36], duration: 800, settle: 150 },
    { move: [0.5, 0.72], duration: 1500, arc: 0.02, pause: 500 },
    { lift: true, pause: 3200 },
  ],
});
