#!/usr/bin/env bash
# Affiche la valeur à coller dans Railway → GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
set -euo pipefail
if [ $# -lt 1 ]; then
  echo "Usage: $0 chemin/vers/compte-service.json"
  exit 1
fi
base64 -i "$1" | tr -d '\n'
echo ""
