#!/usr/bin/env bash
# Déploie firestore.rules (collection _camilleLocks incluse).
# Prérequis : npx firebase-tools login (une fois sur votre Mac)
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${FIREBASE_PROJECT_ID:-le-club-assurance-emprunteur}"
echo "Deploy Firestore rules → project ${PROJECT}"
npx -y firebase-tools@14.4.0 deploy --only firestore:rules --project "${PROJECT}"
