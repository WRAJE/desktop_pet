#!/usr/bin/python3
"""Fast on-screen window bounds via CoreGraphics (macOS). Prints JSON."""

from __future__ import annotations

import json
import sys

try:
    import Quartz
except ImportError:
    print("[]")
    sys.exit(0)

SKIP_OWNERS = {
    "Window Server",
    "Dock",
    "Control Center",
    "Notification Centre",
    "Notification Center",
    "Spotlight",
    "SystemUIServer",
    "TextInputMenuAgent",
    "TextInputSwitcher",
    "Wallpaper",
    "loginwindow",
    "Screenshot",
    "screencaptureui",
}

def main() -> None:
    opts = Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements
    wins = Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID) or []
    out = []
    for w in wins:
        owner = w.get("kCGWindowOwnerName") or ""
        if owner in SKIP_OWNERS:
            continue
        layer = int(w.get("kCGWindowLayer") or 0)
        if layer != 0:
            continue
        alpha = float(w.get("kCGWindowAlpha") or 1)
        if alpha < 0.15:
            continue
        b = w.get("kCGWindowBounds") or {}
        x = float(b.get("X") or 0)
        y = float(b.get("Y") or 0)
        ww = float(b.get("Width") or 0)
        hh = float(b.get("Height") or 0)
        if ww < 120 or hh < 52:
            continue
        out.append(
            {
                "owner": owner,
                "title": w.get("kCGWindowName") or "",
                "x": round(x),
                "y": round(y),
                "w": round(ww),
                "h": round(hh),
            }
        )
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
