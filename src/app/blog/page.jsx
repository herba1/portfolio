import { posts } from '@/app/(blog)/posts'
import GlitchText from '@/app/ui/GlitchText'
import ImageFan from '@/app/ui/ImageFan'
import BlogPostLink from './BlogPostLink'

export const metadata = {
  title: 'Writing',
  description: 'Thoughts on web development, creative coding, and design.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    type: 'website',
    title: 'Writing',
    description: 'Thoughts on web development, creative coding, and design.',
    url: 'https://herb.art/blog',
  },
}

export default function BlogIndex() {
  const publishedPosts = posts
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div className="bg-slate-100 min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <h1
          className={`text-ink mb-8 text-4xl font-bold tracking-tighter md:text-6xl`}
        >
          <GlitchText text="Writing" />
        </h1>
        {publishedPosts.length === 0 ? (
          <p className="text-ink-secondary">No posts yet. Check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {publishedPosts.map((post, i) => (
              <li
                key={post.slug}
                className="blog-list-item"
                style={{ animationDelay: `${0.2 + i * 0.08}s` }}
              >
                <BlogPostLink slug={post.slug}>
                  <article className="border-dark/10 flex items-center justify-between gap-6 border-b pb-6 transition-transform duration-300 ease-out-quart group-hover:translate-x-1">
                    <div className="min-w-0 flex-1">
                      <time className="text-ink-secondary text-sm">
                        {new Date(post.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </time>
                      <h2 className="text-ink mt-1 text-xl font-semibold transition-colors group-hover:text-blue-500 md:text-2xl">
                        {post.title}
                      </h2>
                      <p className="text-ink-secondary mt-2">
                        {post.description}
                      </p>
                      {post.tags && (
                        <div className="mt-3 flex gap-2">
                          {post.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-ink-secondary bg-dark/5 rounded px-2 py-0.5 text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ImageFan images={post.images} />
                  </article>
                </BlogPostLink>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
