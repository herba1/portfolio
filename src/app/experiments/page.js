import GlitchText from "@/app/ui/GlitchText";
import TransitionLink from "@/app/ui/TransitionLink";

const EXPERIMENTS = [
  {
    slug: "/backdrop",
    title: "Backdrop",
    description:
      "A rebuild of Apple Music's dynamic now-playing backdrop — four rotating copies of the artwork, twisted, blurred and pushed through a saturation lift.",
    tags: ["WebGL", "Audio"],
  },
  {
    slug: "/song-search",
    title: "Song Search",
    description:
      "A search dock that resolves songs, covers and previews from Apple's catalogue — shown on both a light and a dark ground.",
    tags: ["Interface"],
  },
  {
    slug: "/deck",
    title: "Deck",
    description: "Fifty album covers on a stack you can run through, and fan out.",
    tags: ["CSS", "Motion"],
  },
  {
    slug: "/psa",
    title: "PSA",
    description: "A collection of graded cards, and the interaction for filling it.",
    tags: ["Motion"],
  },
  {
    slug: "/tuner",
    title: "Tuner",
    description:
      "A configurable instrument tuner — live pitch detection on a glowing glass display.",
    tags: ["Audio", "DSP"],
  },
];

export default function ExperimentsIndex() {
  return (
    <div className="bg-surface min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <h1 className="text-ink text-title-xl md:text-display mb-8">
          <GlitchText text="Experiments" />
        </h1>
        <ul className="flex flex-col gap-6">
          {EXPERIMENTS.map((experiment, index) => (
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
