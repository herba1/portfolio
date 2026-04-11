"use client";

import TransitionLink from "@/app/ui/TransitionLink";
import posthog from "posthog-js";

export default function BlogPostLink({ slug, children }) {
  return (
    <TransitionLink
      href={`/${slug}`}
      className="group block"
      onClick={() => posthog.capture("blog_post_clicked", { slug })}
    >
      {children}
    </TransitionLink>
  );
}
