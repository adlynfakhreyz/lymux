#!/usr/bin/env bash
# Make the README demo: screenshot each step of tests/demo.js in the real app, animate the stills with Remotion
# (demo/), then write dist/lymux-demo.mp4 and docs/demo.gif.
set -euo pipefail
cd "$(dirname "$0")/.."
shots=dist/demo-shots
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
rm -rf "$shots" && mkdir -p "$shots"

# Claude Code runs in the demo; don't let it inherit settings from a Claude Code session that started this script.
for v in $(compgen -e | grep '^CLAUDE'); do unset "$v"; done

# 1. Stills at 1.5x scale, so they stay sharp when the camera zooms in, plus shots.json (focus and cursor points).
npx electron-vite build >/dev/null
LYMUX_USER_DATA="$profile" LYMUX_SHOTS="$PWD/$shots" LYMUX_EVAL=tests/demo.js LYMUX_EVAL_DELAY=2500 \
  ./node_modules/electron/dist/electron . --no-sandbox --force-device-scale-factor=1.5 2>/dev/null |
  sed -n 's/^LYMUX_EVAL_RESULT //p' >"$shots/shots.json"
[ -s "$shots/shots.json" ] || { echo "demo script failed" >&2; exit 1; }

# 2. Animate (the title cards use the app icon).
cp build/icons/512x512.png "$shots/icon.png"
(cd demo && { [ -d node_modules ] || npm install --no-audit --no-fund; } &&
  npx remotion render src/index.ts LymuxDemo ../dist/lymux-demo.mp4 --public-dir=../"$shots" --concurrency=100%)

# 3. GIF for the README.
ffmpeg -y -loglevel error -i dist/lymux-demo.mp4 \
  -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  docs/demo.gif
ls -la dist/lymux-demo.mp4 docs/demo.gif
