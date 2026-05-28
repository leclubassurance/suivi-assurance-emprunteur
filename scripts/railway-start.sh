#!/usr/bin/env sh
# Entrée Railway optionnelle (identique à package.json start / railway.toml startCommand).
# Ne pas utiliser node dist/server.cjs — bundle obsolète si présent sur disque.
set -e
cd "$(dirname "$0")/.."
if [ ! -f dist/index.html ]; then
  echo "ERREUR: dist/index.html absent — le build Vite a échoué sur Railway (npm run build)."
  exit 1
fi
export NODE_ENV=production
export RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-true}"
exec npx tsx server.ts
