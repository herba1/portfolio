import LiveStatCardsExperience from "./LiveStatCardsExperience";

export const metadata = {
  title: "Live Stat Cards",
  description: "Four numbers that breathe — listeners, revenue, requests and error rate ticking on their own clock, each flashing green or red as it moves. Hold on a card and the sparkline gives up its last seven readings.",
};

export default function LiveStatCardsPage() {
  return <LiveStatCardsExperience />;
}
