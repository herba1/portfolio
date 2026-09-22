import TransitionLink from "@/app/ui/TransitionLink";
import { email, employer } from "@/app/constants";

// The home page in words. The hero and the splat are the point of the page,
// but neither puts a sentence in the HTML — so before this, a crawler, a
// screen reader or an AI assistant asked "whose site is herb.art?" had
// nothing to go on but a nav. Server-rendered, plain, and short.
//
// Type from the scale only; every vertical measure is on the 4px grid.

const linkClass = "text-accent hover:text-accent-hover underline decoration-line-strong underline-offset-4 transition-colors";

export default function HomeIntro() {
  return (
    <section
      aria-labelledby="home-intro-title"
      className="bg-surface relative z-10"
    >
      <div className="mx-auto max-w-2xl px-4 pt-24 pb-24 md:px-6">
        <h2 id="home-intro-title" className="text-ink text-title-sm">
          hi. i&rsquo;m herb.
        </h2>
        <p className="text-ink text-body mt-6">
          I&rsquo;m <strong className="font-semibold">Herbart Hernandez</strong>, a design
          engineer at{" "}
          <a className={linkClass} href={employer.url} rel="noopener noreferrer">
            {employer.name}
          </a>{" "}
          in New York. I build the front of the product — the parts you touch, and the parts
          that have to feel instant when you do.
        </p>
        <p className="text-ink text-body mt-4">
          This site is where the rest goes:{" "}
          <TransitionLink className={linkClass} href="/experiments">
            interactive experiments
          </TransitionLink>{" "}
          built around one mechanic each — relief-print and halftone shaders, a lens lattice,
          an instrument tuner, a stack of album covers — plus a few{" "}
          <TransitionLink className={linkClass} href="/tierlist">
            tier lists
          </TransitionLink>
          , a grid of{" "}
          <TransitionLink className={linkClass} href="/covers">
            top songs
          </TransitionLink>{" "}
          and the occasional{" "}
          <TransitionLink className={linkClass} href="/blog">
            post
          </TransitionLink>
          . The longer version is on the{" "}
          <TransitionLink className={linkClass} href="/bio">
            bio
          </TransitionLink>
          .
        </p>
        <p className="text-ink text-body mt-4">
          If you&rsquo;re building something that has to feel good, write to{" "}
          <a className={linkClass} href={`mailto:${email}`}>
            {email}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
