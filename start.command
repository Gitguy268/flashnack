#!/bin/bash
# Double-click to run Flashnack on this Mac: installs once, builds, serves on
# http://localhost:5292 and opens it in your browser. Close this window to stop.
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Flashnack needs Node.js. Install it from https://nodejs.org and double-click start.command again."
  read -r -p "Press Return to close." _
  exit 1
fi
[ -d node_modules ] || npm install || exit 1
if [ ! -f dist/index.html ] || [ -n "$(find src index.html public -newer dist/index.html -print -quit)" ]; then
  npm run build || exit 1
fi
(sleep 1.5 && open "http://localhost:5292/") &
exec npx vite preview --port 5292 --strictPort
