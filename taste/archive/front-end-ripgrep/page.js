import FrontEndRipgrepExperience from "./FrontEndRipgrepExperience";

export const metadata = {
  title: "Ripgrep",
  description: "A mock repo of Rust, JS and Markdown you can search live — type a pattern and watch matches light up while files under node_modules, target and .git stay skipped, just like a real .gitignore.",
};

export default function FrontEndRipgrepPage() {
  return <FrontEndRipgrepExperience />;
}
