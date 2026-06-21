// Read-only tier list. Rows distribute evenly down the available height; items
// scale to row height. Static tiles — no click/modal.

export default function TierListView({ tiers, items }) {
  return (
    <div className="flex h-full w-full flex-col">
      {tiers.map((tier) => {
        const rowItems = items.filter((it) => it.tier === tier.id)
        return (
          <div
            key={tier.id}
            className="tl-fade flex min-h-0 flex-1 items-stretch border-b border-black/10 last:border-b-0"
          >
            {/* Label */}
            <div
              className="flex aspect-square h-full shrink-0 items-center justify-center"
              style={{ backgroundColor: tier.color }}
            >
              <span className="text-[clamp(1.5rem,5vh,3rem)] leading-none font-bold tracking-tight text-black/85">
                {tier.label}
              </span>
            </div>

            {/* Items */}
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto bg-white/40 px-2">
              {rowItems.map((item) => (
                <div
                  key={item.id}
                  className="tl-item group relative aspect-square h-[82%] shrink-0 overflow-hidden bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.src}
                    alt={item.label || ''}
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                  {item.label ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-left text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {item.label}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
