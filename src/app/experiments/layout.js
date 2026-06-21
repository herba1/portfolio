// The experiments route is an interactive demo sandbox, not real content —
// keep it out of search indexes so it doesn't dilute the site's SEO with
// thin/duplicate pages. (page.js is a client component and can't set this.)
export const metadata = {
  title: 'Experiments',
  robots: {
    index: false,
    follow: true,
  },
}

export default function ExperimentsLayout({ children }) {
  return children
}
