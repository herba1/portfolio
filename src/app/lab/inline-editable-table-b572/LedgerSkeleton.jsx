const COLUMN_WIDTHS = [78, 62, 40, 66, 52, 58, 44];
const ROW_VARIANCE = [0, -8, 6, -4, 10, -10, 4, -6];

export default function LedgerSkeleton({ count }) {
  return (
    <div className="iet-skeletons" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="iet-skeleton-row" style={{ "--iet-row-i": index }}>
          {COLUMN_WIDTHS.map((width, column) => (
            <div key={column} className="iet-skeleton-cell" data-align={column > 2 && column < 6 ? "end" : undefined}>
              <span
                className="iet-skeleton-bar"
                style={{ "--iet-bar-w": `${Math.max(24, width + ROW_VARIANCE[(index + column) % ROW_VARIANCE.length])}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
