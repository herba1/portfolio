"use client";

import Link from "next/link";
import posthog from "posthog-js";

export default function BlogPostLink({ slug, children }) {
  return (
    <Link
      href={`/${slug}`}
      className="group block"
      onClick={() => posthog.capture("blog_post_clicked", { slug })}
    >
      {children}
    </Link>
  );
}
