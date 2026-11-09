#!/bin/bash
# Render a list of reels one after another; keep going past failures.
# Usage: ./batch.sh [--draft] reel reel ...   (logs to out/_batch.log)
cd "$(dirname "$0")"
FLAGS=""; [ "$1" = "--draft" ] && { FLAGS="--draft${FPS:+ --fps $FPS}"; shift; }
for r in "$@"; do
  curl -s -o /dev/null --max-time 20 http://localhost:3200/ || bash /tmp/claude-0/-home-user-portfolio/2c112b93-6734-5f6c-9467-c03f471cdcfd/scratchpad/dev.sh
  start=$(date +%s)
  if node record.mjs "$r" $FLAGS --base "${BASE:-http://localhost:3200}" > "out/_log-$r.txt" 2>&1; then s=ok; else s=FAIL; fi
  [ "$s" = ok ] && [ -n "$COPY_TO" ] && [ -z "$FLAGS" ] && cp "out/$r/feed.mp4" "$COPY_TO/$r.mp4"
  echo "$r $s $(( $(date +%s) - start ))s" >> out/_batch.log
done
echo DONE >> out/_batch.log
