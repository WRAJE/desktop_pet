import { app, screen } from "electron";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { DesktopIcon, DesktopState, Platform, Rect } from "../shared/types";

const execFileAsync = promisify(execFile);

const ICON_W = 96;
const ICON_H = 86;

function parseTable(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

async function osascript(script: string, timeout = 5000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function dockSurface(bounds: Rect, workArea: Rect): Platform {
  const dockTop = workArea.y + workArea.h;
  return {
    kind: "dock",
    x: bounds.x,
    y: dockTop,
    w: bounds.w,
    h: Math.max(24, bounds.y + bounds.h - dockTop),
  };
}

async function readIcons(workArea: Rect): Promise<DesktopIcon[]> {
  const script = `
set output to ""
tell application "Finder"
  set itemList to every item of desktop
  repeat with f in itemList
    try
      set n to name of f
      set p to desktop position of f
      set c to class of f as string
      set output to output & n & tab & (item 1 of p as integer) & tab & (item 2 of p as integer) & tab & c & linefeed
    end try
  end repeat
end tell
return output
`;
  const raw = await osascript(script, 8000);
  const icons: DesktopIcon[] = [];
  for (const cols of parseTable(raw)) {
    if (cols.length < 4) continue;
    const name = cols[0];
    const fx = Number(cols[1]);
    const fy = Number(cols[2]);
    const cls = cols[3].toLowerCase();
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) continue;
    // Finder desktop position is the icon-cell center on a ~122×112 grid.
    const x = fx - ICON_W / 2;
    let y = fy - 40;
    if (y < workArea.y - 16) y = workArea.y;
    const isFolder = cls.includes("folder") || cls.includes("disk");
    icons.push({ name, x, y, w: ICON_W, h: ICON_H, isFolder });
  }
  return icons;
}

type QuartzWin = { owner: string; title: string; x: number; y: number; w: number; h: number };

function geomScript(): string {
  const cands = [
    path.join(app.getAppPath(), "tools", "desktop_geom.py"),
    path.join(app.getAppPath(), "dist", "tools", "desktop_geom.py"),
    path.join(__dirname, "..", "tools", "desktop_geom.py"),
    path.join(__dirname, "..", "..", "tools", "desktop_geom.py"),
  ];
  return cands.find((p) => fs.existsSync(p)) ?? cands[0]!;
}

async function readQuartzWindows(): Promise<QuartzWin[]> {
  const script = geomScript();
  const bins = ["/usr/bin/python3", "python3"];
  for (const bin of bins) {
    try {
      const { stdout } = await execFileAsync(bin, [script], {
        timeout: 2500,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || "[]") as QuartzWin[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try next interpreter
    }
  }
  return [];
}

function isOverlayWindow(w: QuartzWin, bounds: Rect): boolean {
  return (
    Math.abs(w.x - bounds.x) <= 4 &&
    Math.abs(w.y - bounds.y) <= 4 &&
    Math.abs(w.w - bounds.w) <= 8 &&
    Math.abs(w.h - bounds.h) <= 8
  );
}

function windowsToPlatforms(wins: QuartzWin[], bounds: Rect, skip: Set<string>): Platform[] {
  const platforms: Platform[] = [];
  for (const w of wins) {
    if (skip.has(w.owner) || skip.has(w.title)) continue;
    if (isOverlayWindow(w, bounds)) continue;
    if (w.y < -40 && w.h > bounds.h * 0.7) continue;
    platforms.push({
      kind: "window",
      id: `${w.owner}:${w.title || w.w + "x" + w.h}`,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
    });
  }
  return platforms;
}

async function readTrash(): Promise<Rect | null> {
  for (const label of ["Trash", "废纸篓"]) {
    const script = `
tell application "System Events"
  tell process "Dock"
    set e to UI element "${label}" of list 1
    set pos to position of e
    set sz to size of e
    return (item 1 of pos as integer) & tab & (item 2 of pos as integer) & tab & (item 1 of sz as integer) & tab & (item 2 of sz as integer)
  end tell
end tell
`;
    const raw = await osascript(script, 2000);
    const cols = raw.split("\t");
    if (cols.length >= 4) {
      const [x, y, w, h] = cols.map(Number);
      if ([x, y, w, h].every(Number.isFinite)) return { x, y, w, h };
    }
  }
  return null;
}

export async function snapshotDesktop(): Promise<DesktopState> {
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const w = display.workArea;
  const bounds: Rect = { x: b.x, y: b.y, w: b.width, h: b.height };
  const workArea: Rect = { x: w.x, y: w.y, w: w.width, h: w.height };
  const dock = dockSurface(bounds, workArea);
  const skip = new Set(["Electron", "绘梨衣", "erii-desktop-pet", app.getName()]);

  const [icons, quartzWins, trash] = await Promise.all([
    readIcons(workArea),
    readQuartzWindows(),
    readTrash(),
  ]);

  const windows = windowsToPlatforms(quartzWins, bounds, skip);
  const iconPlatforms: Platform[] = icons.map((icon) => ({
    kind: "icon" as const,
    id: icon.name,
    x: icon.x,
    y: icon.y,
    w: icon.w,
    h: icon.h,
  }));

  const trashRect =
    trash ??
    ({
      x: bounds.x + bounds.w - 90,
      y: dock.y,
      w: 70,
      h: Math.max(40, dock.h),
    } satisfies Rect);

  const floor: Platform = {
    kind: "floor",
    x: bounds.x,
    y: bounds.y + bounds.h - 2,
    w: bounds.w,
    h: 2,
  };

  return {
    bounds,
    workArea,
    platforms: [dock, ...windows, ...iconPlatforms, floor],
    icons,
    trash: trashRect,
  };
}

export async function kickDesktopItem(name: string, x: number, y: number): Promise<boolean> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "Finder"
  try
    set desktop position of item "${escaped}" of desktop to {${Math.round(x)}, ${Math.round(y)}}
    return "ok"
  on error
    return "fail"
  end try
end tell
`;
  const raw = await osascript(script, 3000);
  return raw === "ok";
}
