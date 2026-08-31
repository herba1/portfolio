import DetentV2V2Experience from "./DetentV2V2Experience";

export const metadata = {
  title: "Odometer Detent",
  description: "A rotary dial that spins on its own momentum and clicks to rest like the real thing. The ticks it passes flare and pulse with the turn, and the count below rolls digit by digit like a mechanical odometer.",
};

export default function DetentV2V2Page() {
  return <DetentV2V2Experience />;
}
