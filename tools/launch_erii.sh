#!/bin/bash
# Start 绘梨衣, or show her if she is already running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG="$TMPDIR/erii-desktop-pet.log"
cd "$ROOT"
if [[ ! -x "$ELECTRON" ]]; then
  osascript -e 'display alert "绘梨衣" message "找不到 Electron，请先在项目里运行 npm install。" as critical' >/dev/null 2>&1 || true
  exit 1
fi
exec "$ELECTRON" "$ROOT" >>"$LOG" 2>&1
