import { notFound } from "next/navigation";
import Link from "next/link";
import Shared from "@/app/ui/transitions/Shared";
import { OPEN_DETAIL } from "@/app/ui/transitions/types";
import { pageMetadata } from "@/lib/seo";
import { SPLATS, splatBySlug } from "../data";
import SplatAnchor from "../stage/SplatAnchor";
import BackToIndex from "../BackToIndex";

const OPEN = [OPEN_DETAIL];

export function generateStaticParams() {
  return SPLATS.map(({ id }) => ({ slug: id }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const item = splatBySlug(slug);
  if (!item) return {};
  return pageMetadata({
    title: item.title,
    description: item.blurb,
    path: `/splats/${item.id}`,
    noindex: true,
  });
}

export default async function SplatArticle({ params }) {
  const { slug } = await params;
  const item = splatBySlug(slug);
  if (!item) notFound();
  const index = SPLATS.indexOf(item);
  const next = SPLATS[(index + 1) % SPLATS.length];

  return (
    <main id="content" className="splat-article">
      <nav className="splat-article__back splat-out splat-rise" style={{ "--rise": 0 }}>
        <BackToIndex slug={item.id} className="splat-article__back-link">All splats</BackToIndex>
      </nav>

      <SplatAnchor actor={item.id} slot="article" interactive className="splat-article__hero" />

      <article className="splat-article__body">
        <header className="splat-article__header splat-out splat-out--2">
          <h1 className="splat-article__title">
            <Shared name={`splat-title-${item.id}`} morph="fade" on={OPEN_DETAIL}>
              <span className="inline-block">{item.title}</span>
            </Shared>
          </h1>
          <p className="splat-article__kicker splat-rise" style={{ "--rise": 1 }}>
            {item.kicker}
          </p>
        </header>
        <div className="splat-article__prose splat-out splat-out--3 splat-rise" style={{ "--rise": 2 }}>
          {item.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
        <p className="splat-article__credit splat-out splat-out--4 splat-rise" style={{ "--rise": 3 }}>
          Capture: <a href={item.credit.url}>{item.credit.name}</a>, {item.credit.license}.
        </p>
      </article>

      <Link
        href={`/splats/${next.id}`}
        transitionTypes={OPEN}
        className="splat-article__next splat-out splat-out--4 splat-rise"
        style={{ "--rise": 4 }}
      >
        <SplatAnchor actor={next.id} slot="next" className="splat-article__next-frame" />
        <span className="splat-article__next-label">
          <span className="splat-article__next-hint">Next</span>
          <span className="splat-article__next-title">{next.title}</span>
        </span>
      </Link>
    </main>
  );
}
