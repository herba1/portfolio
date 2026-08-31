import Link from "next/link";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";
import { listManifests } from "@/lib/taste/store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lab",
  robots: { index: false, follow: false },
};

export default async function LabIndex() {
  if (isProdView()) notFound();
  const items = await listManifests();
  return (
    <div className="bg-surface min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <h1 className="text-ink text-title-lg mb-2">Lab</h1>
        <p className="text-ink-secondary text-body mb-8">
          {items.length} generated candidate{items.length === 1 ? "" : "s"}. Judge them in{" "}
          <Link href="/taste" className="text-accent">
            Taste
          </Link>
          .
        </p>
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.slug} className="border-line flex items-baseline justify-between gap-4 border-b pb-4">
              <div className="min-w-0">
                <Link href={`/lab/${item.slug}`} className="text-ink text-heading hover:text-accent">
                  {item.title}
                </Link>
                <p className="text-ink-secondary text-ui-lg mt-1">{item.description}</p>
              </div>
              <span className="text-ink text-ui-sm shrink-0">{item.status}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
