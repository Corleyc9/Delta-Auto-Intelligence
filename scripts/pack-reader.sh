#!/usr/bin/env bash
# Rebuild public/downloads/delta-auto-reader.zip from the current reader sources.
# Node-only so Cloudflare Workers builds do not need python3.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${root}/scripts/pack-reader.mjs"
