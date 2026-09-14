#!/bin/bash
# Build a double-clickable macOS app that starts 绘梨衣.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HOME/Desktop/绘梨衣.app}"
RES="$APP/Contents/Resources"
MACOS="$APP/Contents/MacOS"
ICON_SRC="$ROOT/assets/icon.png"

rm -rf "$APP"
mkdir -p "$MACOS" "$RES"

cat > "$MACOS/绘梨衣" << EOF
#!/bin/bash
ROOT="$ROOT"
ELECTRON="\$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
cd "\$ROOT"
if [[ ! -x "\$ELECTRON" ]]; then
  osascript -e 'display alert "绘梨衣" message "找不到 Electron，请先在项目里运行 npm install。" as critical' >/dev/null 2>&1 || true
  exit 1
fi
exec "\$ELECTRON" "\$ROOT"
EOF
chmod +x "$MACOS/绘梨衣"

if [[ -f "$ICON_SRC" ]]; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    if [[ $double -le 1024 ]]; then
      sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
    fi
  done
  iconutil -c icns -o "$RES/AppIcon.icns" "$ICONSET" >/dev/null
  rm -rf "$(dirname "$ICONSET")"
fi

cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>绘梨衣</string>
  <key>CFBundleDisplayName</key>
  <string>绘梨衣</string>
  <key>CFBundleIdentifier</key>
  <string>dev.erii.launcher</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>绘梨衣</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

echo "launcher -> $APP"
