import { sparklinePoints, pathFromPoints } from "./statEngine";

const WIDTH = 132;
const HEIGHT = 40;
const REVEAL_COUNT = 7;

export default function Sparkline({ history, direction, revealed }) {
  const points = sparklinePoints(history, WIDTH, HEIGHT);
  const linePath = pathFromPoints(points);
  const areaPath = `${linePath} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;
  const revealedPoints = revealed ? points.slice(-REVEAL_COUNT) : [];

  return (
    <svg
      className={`stat-card__spark stat-card__spark--${direction}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="stat-card__spark-area" d={areaPath} />
      <path className="stat-card__spark-line" d={linePath} />
      {revealedPoints.map((point, i) => (
        <circle
          key={history.length - REVEAL_COUNT + i}
          className="stat-card__spark-dot"
          cx={point.x}
          cy={point.y}
          r={i === revealedPoints.length - 1 ? 3 : 2}
          style={{ transitionDelay: `${i * 18}ms` }}
        />
      ))}
    </svg>
  );
}
