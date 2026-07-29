'use client'

import './tokens.css'

/* The boundary between the two design systems.
 *
 * Everything mono-volt is rendered inside this: it carries the `.mv-scope`
 * class that every ported token hangs off, so CrowdVolt's dark surface, its
 * orange, its radii and Inter all resolve here and NOWHERE else on the page.
 * Outside this div the site is its own light self, and neither one can reach
 * into the other. */
export default function MvScope({ children }) {
  return <div className="mv-scope w-full">{children}</div>
}
