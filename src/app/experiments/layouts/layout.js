import { pageMetadata } from "@/lib/seo";
import Switcher from "./Switcher";
import "./layouts.css";

// Prototypes for an all-at-once experiments index. Every piece runs live in
// its own frame; nothing needs a click to be seen. Kept out of search.
export const metadata = pageMetadata({
  title: "Experiments — layouts",
  description: "Prototype layouts that show every experiment live on one page.",
  path: "/experiments/layouts",
  noindex: true,
});

export default function LayoutsLayout({ children }) {
  return (
    <div className="xl-root">
      {children}
      <Switcher />
    </div>
  );
}
