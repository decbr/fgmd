#!/usr/bin/env bash
# bumps the version and pushes it, which triggers .github/workflows/publish.yml:
#
#   scripts/version.sh           # patch
#   scripts/version.sh minor     # or major, or an exact version like 1.0.0
set -euo pipefail

cd "$(dirname "$0")/.."

npm version "${1:-patch}"
git push --follow-tags
