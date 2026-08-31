import Image from "next/image";
import "./bio.css";

export const metadata = {
  title: "Bio",
  description: "Design engineer @ CrowdVolt.",
};

function ArrowIcon() {
  return (
    <svg className="bio__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BoltMark() {
  return (
    <svg className="bio__bolt" viewBox="0 0 18 26" aria-hidden="true">
      <path d="M13.9656 0C13.7248 0 13.5022 0.124958 13.3874 0.327176C12.7317 1.48069 11.3232 2.36547 10.0625 2.36547C8.93072 2.36547 8.26799 1.65267 8.35743 0.673163C8.39053 0.31038 8.08276 0.000671819 7.70033 0.000671819H7.07352C6.80237 0.000671819 6.5594 0.158549 6.46009 0.39906L0.0461935 15.9631C-0.123539 16.3749 0.195501 16.8203 0.659623 16.8203H1.17798C1.41884 16.8203 1.64139 16.6954 1.75619 16.4932C2.41188 15.3396 3.82044 14.4549 5.08111 14.4549C6.21289 14.4549 6.87562 15.1677 6.78618 16.1472C6.75307 16.51 7.06085 16.8197 7.44327 16.8197H8.07008C8.34123 16.8197 8.58421 16.6618 8.68351 16.4213L15.0974 0.857241C15.2671 0.445416 14.9481 0 14.484 0H13.9656Z" />
      <path d="M5.09143 25.1376L10.6053 11.7583C10.7046 11.5178 10.9475 11.3599 11.2187 11.3599H16.9375C17.4903 11.3599 17.7974 11.9693 17.4523 12.3804L6.22039 25.7597C5.74852 26.322 4.81605 25.8081 5.09213 25.1376H5.09143Z" />
      <path d="M8.55637 16.7916L10.7692 11.3599H16.9578C17.6184 11.3599 17.855 12.1923 17.2845 12.5101L8.55566 16.7916H8.55637Z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="bio__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg className="bio__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 12h2m3-6v12m4-9v6m4-8v10m4-6h2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg className="bio__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v6m0 6v6m-9-9h6m6 0h6M6 6l3 3m6 6 3 3M18 6l-3 3m-6 6-3 3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function BioPage() {
  return (
    <div className="bio">
      <main className="bio__column">
        <header className="bio__head">
          <h1 className="bio__name">Herbart Hernandez</h1>
          <p className="bio__role">
            Design engineer @{" "}
            <a className="bio__link bio__lockup" href="https://crowdvolt.com">
              <BoltMark />
              <span className="bio__lockup-word">CrowdVolt</span>
            </a>
            <PinIcon />
            New York
          </p>
        </header>

        <hr className="bio__rule" />

        <div className="bio__body">
          <p>
            I build the front of the product — the parts you touch, and the parts
            that have to feel <em>instant</em> when you do.
          </p>

          <p>
            Most of what I make starts as a question about how something should feel
            and ends as a shader, a spring, or forty lines of CSS that took a week. A
            grid of fifty{" "}
            <a className="bio__link" href="https://herb.art/covers">
              covers
            </a>{" "}
            <Image
              className="bio__thumb"
              src="/monovolt/abt1.webp"
              alt=""
              width={48}
              height={48}
            />{" "}
            that scrolls forever without dropping a frame. A{" "}
            <a className="bio__link" href="https://herb.art/tuner">
              tuner
            </a>{" "}
            <WaveIcon /> that lands on the pitch before you have finished the note.{" "}
            <strong>The work I like best is the kind nobody notices.</strong>
          </p>

          <p>
            <span className="bio__serif">Nobody notices good typography either</span>
            , which is rather the point. I care about where a baseline sits, whether
            the numbers in a column stay put when they change, and how much air a
            headline needs before it stops reading as one thought.
          </p>

          <p>
            I came to this from the design side{" "}
            <Image
              className="bio__thumb bio__thumb--round"
              src="/cast/john.webp"
              alt=""
              width={48}
              height={48}
            />{" "}
            and picked up the engineering because I got tired of handing off. The
            interesting decisions live in the last ten percent, and that is exactly
            the part that <em>never survives a spec</em>.
          </p>

          <p>
            Everything I have shipped sits under{" "}
            <a className="bio__link" href="https://herb.art/work">
              Work
              <ArrowIcon />
            </a>{" "}
            and{" "}
            <a className="bio__link" href="https://herb.art/experiments">
              Experiments
            </a>{" "}
            <SparkIcon /> — roughly{" "}
            <span className="bio__figures">30</span> pieces since{" "}
            <span className="bio__figures">2019</span>. Some of it is client work.
            Most of it is me answering a question I had on a Sunday.
          </p>

          <p>
            If you are building something that has to feel good, write to{" "}
            <a className="bio__link bio__mono" href="mailto:hi@herb.art">
              hi@herb.art
            </a>
            .
          </p>
        </div>

        <nav className="bio__elsewhere">
          <a href="https://github.com/herba1">GitHub</a>
          <a href="https://x.com/herb_dev">X</a>
          <a href="https://linkedin.com/in/herbart-hernandez">LinkedIn</a>
          <a href="mailto:hi@herb.art">Email</a>
        </nav>
      </main>
    </div>
  );
}
