"use client";

function Line({ line }) {
  if (line.ranges.length === 0) {
    return <span className="rg-line__text">{line.content || " "}</span>;
  }

  const pieces = [];
  let cursor = 0;
  line.ranges.forEach(([start, end], index) => {
    if (start > cursor) pieces.push(<span key={`${index}-pre`}>{line.content.slice(cursor, start)}</span>);
    pieces.push(
      <mark key={`${index}-mark`} className="rg-mark">
        {line.content.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < line.content.length) pieces.push(<span key="tail">{line.content.slice(cursor)}</span>);

  return <span className="rg-line__text">{pieces}</span>;
}

export default function FrontEndRipgrepScene({ command, stats, groups, error }) {
  return (
    <div className="rg-terminal">
      <div className="rg-terminal__bar">
        <span className="rg-terminal__prompt">$</span>
        <span className="rg-terminal__command">{command}</span>
      </div>

      <div className="rg-terminal__body" data-lenis-prevent>
        {error ? (
          <p className="rg-error">regex error — {error}</p>
        ) : groups.length === 0 ? (
          <p className="rg-empty">no matches under the current filters</p>
        ) : (
          groups.map((group) => (
            <div key={group.path} className="rg-file">
              <div className="rg-file__head">
                <span className="rg-file__path">{group.path}</span>
                <span className="rg-file__count">
                  {group.hitCount} {group.hitCount === 1 ? "match" : "matches"}
                </span>
              </div>
              {group.blocks.map((block, blockIndex) => (
                <div key={block.lines[0].number} className="rg-block">
                  {blockIndex > 0 ? <div className="rg-block__sep">⋮</div> : null}
                  {block.lines.map((line) => (
                    <div key={line.number} className="rg-line" data-hit={line.isHit ? "true" : undefined}>
                      <span className="rg-line__number">{line.number}</span>
                      <Line line={line} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="rg-terminal__stats">
        <span>
          <strong className="rg-stat">{stats.matchedFiles}</strong> files,{" "}
          <strong className="rg-stat">{stats.matches}</strong> matches
        </span>
        <span>{stats.elapsedMs.toFixed(2)}ms</span>
        <span>
          <strong className="rg-stat">{stats.searched}</strong>/{stats.totalFiles} files searched
        </span>
      </div>
    </div>
  );
}
