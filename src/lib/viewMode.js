// Single source of truth for the dev/prod-gated UI.
//
// `isProdView()` is true for real production builds (`next build`), OR when
// NEXT_PUBLIC_FORCE_PROD_VIEW=true. The flag lets `next dev` render the
// production-gated experience — dev nav links, dev control panels, the tierlist
// editor route, and dev-only API endpoints are all hidden / blocked — WITHOUT
// making a production build (so you keep hot reload).
//
// With the flag unset these helpers are behaviourally identical to the
// `process.env.NODE_ENV` checks they replaced, so real builds are unaffected.
export const FORCE_PROD_VIEW =
  process.env.NEXT_PUBLIC_FORCE_PROD_VIEW === "true";

export const isProdView = () =>
  process.env.NODE_ENV === "production" || FORCE_PROD_VIEW;

export const isDevView = () => !isProdView();
