import LiveStatCardsBdecExperience from "./LiveStatCardsBdecExperience";

export const metadata = {
  title: "Live stat cards",
  description: "A row of stat cards with sparklines, deltas coloured by direction, numbers that tick live in tabular figures, and a hover that reveals the last 7 points.",
};

export default function LiveStatCardsBdecPage() {
  return <LiveStatCardsBdecExperience />;
}
