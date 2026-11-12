#!/usr/bin/env bash
set -euo pipefail

# Writes the frontend runtime configuration.
# ALF_API_BASE: public URL of the backend, e.g. https://alf-api.example.com
# ALF_CONFIG_PATH: output file (defaults to frontend/static/js/config.js)

api_base="${ALF_API_BASE:-http://localhost:8000}"
target="${ALF_CONFIG_PATH:-frontend/static/js/config.js}"

mkdir -p "$(dirname "$target")"
printf 'window.ALF_CONFIG = { apiBase: "%s" };\n' "${api_base%/}" >"$target"
echo "Wrote $target with apiBase=$api_base"
