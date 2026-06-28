#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$dir")"
html="file://${dir}/screenshot-marketing.html"
out="${root}/screenshot.png"

# Firefox headless renders the full 1280x720 frame reliably; Chrome headless
# clips the mockup ~87px short of the bottom for this layout.
firefox --headless --screenshot="${out}" --window-size=1280,720 "${html}" >/dev/null 2>&1

echo "Wrote ${out} (1280x720)"
