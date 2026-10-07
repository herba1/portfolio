"use client";

import TransitionLink from "@/app/ui/transitions/TransitionLink";
import posthog from "posthog-js";
import { OPEN_DETAIL } from "@/app/ui/transitions/types";

const OPEN = [OPEN_DETAIL];

export default function BlogPostLink({ slug, children }) {
  return (
    <TransitionLink
      href={`/${slug}`}
      transitionTypes={OPEN}
      className="group block"
      onClick={() => posthog.capture("blog_post_clicked", { slug })}
    >
      {children}
    </TransitionLink>
  );
}
