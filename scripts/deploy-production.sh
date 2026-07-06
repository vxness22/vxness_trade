#!/usr/bin/env bash
# Run on the VPS from the repo root (e.g. ~/vxness or actions-runner clone).
# Pull alone does NOT update the live site — Vite serves compiled files in frontend/dist.
#
# Usage:
#   chmod +x scripts/deploy-production.sh
#   ./scripts/deploy-production.sh
#   DEPLOY_REMOTE=origin DEPLOY_BRANCH=main ./scripts/deploy-production.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REMOTE="${DEPLOY_REMOTE:-taniya}"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "=========================================="
echo "vxness deploy — repo: $ROOT"
echo "Pull: $REMOTE / $BRANCH"
echo "=========================================="

git fetch "$REMOTE"
git checkout "$BRANCH"
git pull "$REMOTE" "$BRANCH"

echo ""
echo ">>> Backend dependencies"
cd "$ROOT/backend"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo ""
echo ">>> Frontend install + clean build (required for live UI)"
cd "$ROOT/frontend"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
rm -rf dist
npm run build

META="$ROOT/frontend/dist/build-meta.json"
if [ -f "$META" ]; then
  echo ""
  echo ">>> Build fingerprint (open in browser after deploy to verify):"
  cat "$META"
fi

echo ""
echo ">>> Restart Node (PM2)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all || pm2 restart vxness-backend vxness-frontend 2>/dev/null || true
else
  echo "    pm2 not found — restart backend/frontend manually."
fi

echo ""
echo "Done. Check https://YOUR_DOMAIN/build-meta.json matches git log -1."
echo "If UI is still old: nginx may point to a different dist path, or CDN cache — purge / hard refresh."
echo "=========================================="
