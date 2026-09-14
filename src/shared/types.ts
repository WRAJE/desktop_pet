export type Settings = {
  alwaysOnTop: boolean;
  scale: number;
  opacity: number;
  sfx: boolean;
  kickIcons: boolean;
  openAtLogin: boolean;
  apiKey: string;
};

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 2.4;
export const SCALE_DEFAULT = 1.5;

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return SCALE_DEFAULT;
  if (n >= 2.75) return SCALE_DEFAULT;
  const snapped = Math.round(n * 20) / 20;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, snapped));
}

export const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: true,
  scale: SCALE_DEFAULT,
  opacity: 1,
  sfx: true,
  kickIcons: false,
  openAtLogin: false,
  apiKey: "",
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Platform = Rect & {
  kind: "dock" | "icon" | "window" | "floor";
  id?: string;
};

export type DesktopIcon = Rect & {
  name: string;
  isFolder: boolean;
};

export type DesktopState = {
  bounds: Rect;
  workArea: Rect;
  platforms: Platform[];
  icons: DesktopIcon[];
  trash: Rect | null;
};

export type AtlasAnim = {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
};

export type Atlas = {
  image: string;
  frameSize: [number, number];
  anchor: [number, number];
  scale: number;
  animations: Record<string, AtlasAnim>;
};

export type AgentResult =
  | { ok: true; text: string }
  | { ok: false; kind: "no_key" | "start_failed" | "run_failed"; message: string };
