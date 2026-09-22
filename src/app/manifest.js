import { defaultTitle, description, title } from './constants'

export default function manifest() {
  return {
    id: '/',
    name: defaultTitle,
    short_name: title,
    description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'en-US',
    categories: ['design', 'developer', 'portfolio'],
    /* The one place a literal is unavoidable: the manifest is read by the OS
       before any CSS exists, so it can't reference a token. Both values are
       `--neutral-50` (the page surface) — if that primitive ever moves,
       these two move with it by hand. */
    background_color: '#f1f5f9',
    theme_color: '#f1f5f9',
    // The tab favicon stays the live canvas face (ui/AnimatedFavicon.jsx);
    // these stills are the same face for home screens and install prompts,
    // drawn by the icon routes from lib/face.js.
    icons: [
      { src: '/favicon.ico', sizes: '16x16 32x32', type: 'image/x-icon' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
