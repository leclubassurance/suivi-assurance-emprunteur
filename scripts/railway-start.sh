#!/usr/bin/env sh
set -e
cd "$(dirname "$0")/.."
if [ ! -f dist/server.cjs ]; then
  echo "ERREUR: dist/server.cjs absent. Le build Railway a échoué (npm run build)."
  exit 1
fi
export NODE_ENV=production
exec node dist/server.cjs
