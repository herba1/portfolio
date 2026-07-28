import { description, title } from './constants'

export default function manifest() {
  return {
    name: 'herb.art — Herb, design engineer',
    short_name: title,
    description,
    start_url: '/',
    display: 'standalone',
    /* The one place a literal is unavoidable: the manifest is read by the OS
       before any CSS exists, so it can't reference a token. Both values are
       `--neutral-50` (the page surface) — if that primitive ever moves,
       these two move with it by hand. */
    background_color: '#f1f5f9',
    theme_color: '#f1f5f9',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
