#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build
cd site
[ -d node_modules ] || npm install
npm run deploy
