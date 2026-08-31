import GlitchText from "@/app/ui/GlitchText";
import TransitionLink from "@/app/ui/TransitionLink";
import { LAB } from "@/app/lab/registry";
import { EXPERIMENTS } from "./list";

const SHIPPED_FROM_LAB = LAB.filter((item) => item.status === "shipped").map((item) => ({
  slug: `/lab/${item.slug}`,
  title: item.title,
  description: item.description,
  tags: item.tags,
}));


const ALL_EXPERIMENTS = [...SHIPPED_FROM_LAB, ...EXPERIMENTS];

export default function ExperimentsIndex() {
  return (
    <div className="bg-surface min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <h1 className="text-ink text-title-xl md:text-display mb-8">
          <GlitchText text="Experiments" />
        </h1>
        <ul className="flex flex-col gap-6">
          {ALL_EXPERIMENTS.map((experiment, index) => (
            <li
              key={experiment.slug}
              className="blog-list-item"
              style={{ animationDelay: `${0.2 + index * 0.08}s` }}
            >
              <TransitionLink href={experiment.slug} className="group block">
                <article className="border-line ease-out-quart flex items-center justify-between gap-6 border-b pb-6 transition-transform duration-300 group-hover:translate-x-1">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-ink text-title-sm md:text-title group-hover:text-accent transition-colors">
                      {experiment.title}
                    </h2>
                    <p className="text-ink-secondary text-body mt-2">
                      {experiment.description}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {experiment.tags.map((tag) => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              </TransitionLink>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
