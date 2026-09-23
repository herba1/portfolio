import { email, employer } from "@/app/constants";

// The home page in words, visually hidden. The hero and the splat are the
// point of the page, but neither puts a sentence in the HTML — so without
// this a crawler, a screen reader or an AI assistant asked "whose site is
// herb.art?" has nothing to go on but a nav.
//
// Plain text only, on purpose: every link it would carry is already in the
// visible nav, and invisible links are both a keyboard trap (focus lands on
// nothing you can see) and exactly the "hidden links" Google's spam policy
// names. Keep it short and true — it describes what the page shows.

export default function HomeIntro() {
  return (
    <section aria-labelledby="home-intro-title" className="sr-only">
      <h2 id="home-intro-title">About Herbart Hernandez</h2>
      <p>
        Herbart Hernandez (Herb) is a design engineer at {employer.name} in New York. He
        builds the front of the product — the parts you touch, and the parts that have to
        feel instant when you do.
      </p>
      <p>
        herb.art is where the rest goes: interactive experiments built around one mechanic
        each — relief-print and halftone shaders, a lens lattice, an instrument tuner, a
        stack of album covers — plus tier lists, a grid of top songs, short posts and a bio.
      </p>
      <p>Contact: {email}.</p>
    </section>
  );
}
