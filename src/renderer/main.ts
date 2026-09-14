import type { DesktopIcon, DesktopState, Platform, Settings } from "../shared/types";
import { DEFAULT_SETTINGS, clampScale } from "../shared/types";
import type { EriiApi } from "../main/preload";
import { agentSpeech, parseCommand } from "./chat";
import {
  CLICK_LINES,
  FOLDER_LINES,
  HAPPY_LINES,
  HELD_LINES,
  HOLIDAYS,
  HOUR_LINES,
  IDLE_LINES,
  LAND_LINES,
  LOOK_LINES,
  PANIC_LINES,
  SLEEP_LINES,
  THROW_LINES,
  YAWN_LINES,
  pick,
} from "./persona";
import { SpriteAnimator, loadAtlas } from "./sprites";

declare global {
  interface Window {
    erii: EriiApi;
  }
}

const GRAVITY = 1800;
const RESTITUTION = 0.38;
const STOP_VY = 80;
const THROW_SPEED = 450;
const GROUND_EPS = 10;
const STEP_UP = 128;
const STEP_DOWN = 280;
const WALK_SPEED = 36;
const IDLE_FPS = 15;
const MOVE_FPS = 30;
const DRAG_SLOP = 30;
const DRAG_HOLD_MS = 520;

type Mode =
  | "idle"
  | "walk"
  | "sway"
  | "look"
  | "sit"
  | "sleep"
  | "held"
  | "fall"
  | "land"
  | "react"
  | "panic";

let screenOrigin = { x: 0, y: 0 };

function shiftRect<T extends { x: number; y: number }>(r: T, ox: number, oy: number): T {
  return { ...r, x: r.x - ox, y: r.y - oy };
}

function toLocalDesktop(state: DesktopState): DesktopState {
  const ox = state.bounds.x;
  const oy = state.bounds.y;
  return {
    bounds: { x: 0, y: 0, w: state.bounds.w, h: state.bounds.h },
    workArea: shiftRect(state.workArea, ox, oy),
    platforms: state.platforms.map((p) => shiftRect(p, ox, oy)),
    icons: state.icons.map((i) => shiftRect(i, ox, oy)),
    trash: state.trash ? shiftRect(state.trash, ox, oy) : null,
  };
}

const api = window.erii;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function playSfx(enabled: boolean, freq = 640): void {
  if (!enabled) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
  osc.stop(ctx.currentTime + 0.09);
  osc.onended = () => void ctx.close();
}

class Pet {
  x = 200;
  y = 200;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  onGround = false;
  dragging = false;
  mode: Mode = "fall";
  targetX: number | null = null;
  walkAnim = "walk";
  squashX = 1;
  squashY = 1;
  squashT = 0;
  samples: { x: number; y: number; t: number }[] = [];
  lastInteract = performance.now();
  napAt = performance.now() + rand(22_000, 45_000);
  nextIdleAt = performance.now() + rand(8000, 20000);
  sitUntil = 0;
  sleepUntil = 0;
  napPending = false;
  panicUntil = 0;
  trashCooldownUntil = 0;
  folderCooldownUntil = 0;
  lookUntil = 0;
  chatCount = 0;
  chatWindowStart = 0;
  lastHourSpoken = -1;
  lastHoliday = "";
  bubbleUntil = 0;
  bubbleText = "";
  clickTimer: number | null = null;
  pointerId: number | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS };
  desktop: DesktopState | null = null;
  chatOpen = false;
  keyOpen = false;
  menuOpen = false;
  sleepy = false;
  acc = 0;
  sprite = new SpriteAnimator();
  lastHopFrom = "";
  upHops = 0;
  mustDescend = false;
  airSkipKey = "";

  get scale(): number {
    return this.settings.scale;
  }

  get hit(): { x: number; y: number; w: number; h: number } {
    const size = this.sprite.hitSize(this.scale);
    const anchor = this.sprite.atlas?.anchor ?? [32, 60];
    return {
      x: this.x - anchor[0] * this.scale,
      y: this.y - anchor[1] * this.scale,
      w: size.w,
      h: size.h,
    };
  }

  contains(px: number, py: number): boolean {
    const h = this.hit;
    const insetX = h.w * 0.28;
    const insetTop = h.h * 0.22;
    return px >= h.x + insetX && px <= h.x + h.w - insetX && py >= h.y + insetTop && py <= h.y + h.h + 2;
  }

  minFeetY(): number {
    const ay = this.sprite.atlas?.anchor?.[1] ?? 60;
    const top = Math.max(8, this.desktop?.workArea.y ?? 0);
    return top + ay * this.scale + 8;
  }

  canStandOn(p: Platform): boolean {
    if (p.kind === "floor" || p.kind === "dock") return true;
    return p.y >= this.minFeetY() - 4;
  }

  platformsAt(px: number): Platform[] {
    return (this.desktop?.platforms ?? []).filter((p) => px >= p.x - 6 && px <= p.x + p.w + 6);
  }

  standableAt(px: number): Platform[] {
    return this.platformsAt(px).filter((p) => {
      if (!this.canStandOn(p)) return false;
      if (p.kind === "floor") return true;
      if (!this.onGround && this.airSkipKey && platKey(p) === this.airSkipKey) return false;
      return true;
    });
  }

  solidContaining(px: number, py: number): Platform | null {
    for (const p of this.desktop?.platforms ?? []) {
      if (p.kind !== "window" && p.kind !== "icon") continue;
      if (!this.canStandOn(p)) continue;
      if (!this.onGround && this.airSkipKey && platKey(p) === this.airSkipKey) continue;
      if (px < p.x || px > p.x + p.w) continue;
      const lid = p.kind === "icon" ? Math.max(40, p.h * 0.75) : 84;
      if (py >= p.y - GROUND_EPS && py < p.y + lid) return p;
    }
    return null;
  }

  groundBelow(px: number, py: number): number | null {
    let best: number | null = null;
    for (const p of this.standableAt(px)) {
      if (p.y >= py - GROUND_EPS && (best === null || p.y < best)) best = p.y;
    }
    return best;
  }

  groundBetween(px: number, y0: number, y1: number): number | null {
    const top = Math.min(y0, y1) - GROUND_EPS;
    const bot = Math.max(y0, y1) + GROUND_EPS;
    let best: number | null = null;
    for (const p of this.standableAt(px)) {
      if (p.y >= top && p.y <= bot && (best === null || p.y < best)) best = p.y;
    }
    return best;
  }

  walkSurface(px: number, currentY: number): number | null {
    const reachable = this.standableAt(px).filter(
      (p) => p.y >= currentY - STEP_UP && p.y <= currentY + STEP_DOWN,
    );
    if (!reachable.length) return null;
    reachable.sort((a, b) => Math.abs(a.y - currentY) - Math.abs(b.y - currentY));
    return reachable[0]!.y;
  }

  say(text: string, ms = 2600): void {
    this.bubbleText = text;
    this.bubbleUntil = performance.now() + ms;
  }

  touch(): void {
    this.lastInteract = performance.now();
    this.napAt = performance.now() + rand(40_000, 80_000);
    this.napPending = false;
    if (this.mode === "sleep" || this.mode === "sit") {
      this.setMode("idle");
    }
  }

  setMode(mode: Mode, anim?: string): void {
    this.mode = mode;
    const name = anim ?? defaultAnim(mode);
    this.sprite.play(name);
  }

  platformUnder(px: number, py: number, lookAhead = 18): Platform | null {
    const plats = this.standableAt(px);
    let best: Platform | null = null;
    for (const p of plats) {
      const top = p.y;
      if (py <= top + GROUND_EPS && py + lookAhead >= top - 4) {
        if (!best || top < best.y) best = p;
      }
    }
    return best;
  }

  groundY(px: number, py: number): number | null {
    return this.groundBelow(px, py);
  }
}

function defaultAnim(mode: Mode): string {
  switch (mode) {
    case "walk":
    case "panic":
      return mode === "panic" ? "panic_run" : "walk";
    case "sway":
      return "sway";
    case "look":
      return "look";
    case "sit":
      return "sit";
    case "sleep":
      return "sleep";
    case "held":
      return "held";
    case "fall":
      return "fall";
    case "land":
      return "land";
    default:
      return "idle";
  }
}

const pet = new Pet();
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const bubbleEl = document.getElementById("bubble") as HTMLDivElement;
const zzzEl = document.getElementById("zzz") as HTMLDivElement;
const chatForm = document.getElementById("chat") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const keyForm = document.getElementById("key-form") as HTMLFormElement;
const keyInput = document.getElementById("key-input") as HTMLInputElement;
const keyPaste = document.getElementById("key-paste") as HTMLButtonElement;
const keyCancel = document.getElementById("key-cancel") as HTMLButtonElement;
const menuEl = document.getElementById("pet-menu") as HTMLDivElement;
const scaleSlider = document.getElementById("scale-slider") as HTMLInputElement;
const scaleLabel = document.getElementById("scale-label") as HTMLSpanElement;

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function toLocal(pt: { x: number; y: number }): { x: number; y: number } {
  return { x: pt.x - screenOrigin.x, y: pt.y - screenOrigin.y };
}

function screenFloorY(): number {
  const h = pet.desktop?.bounds.h ?? window.innerHeight;
  let y = h - 2;
  for (const p of pet.desktop?.platforms ?? []) {
    if (p.kind === "floor") y = Math.min(y, p.y);
    if (p.kind === "dock" && p.y >= h - 160) y = Math.min(y, p.y);
  }
  return y;
}

function isBottomSurface(p: Platform | null, y: number): boolean {
  if (!p || p.kind === "floor" || p.kind === "dock") return true;
  return y >= screenFloorY() - 8;
}

function stickLanding(ground: number): void {
  pet.y = ground;
  pet.vy = 0;
  pet.vx *= 0.45;
  pet.onGround = true;
  pet.airSkipKey = "";
  pet.upHops = 0;
  pet.mustDescend = false;
  if (Math.abs(pet.vx) < 20) pet.vx = 0;
  if (pet.mode === "fall" || pet.mode === "land") {
    const landed = currentSupport();
    if (landed && !isBottomSurface(landed, ground) && shouldComeDown(landed)) hopToAnother(landed);
    else strollHere();
    pet.nextIdleAt = performance.now() + rand(2500, 7000);
  }
}

function clampToScreen(): void {
  const b = pet.desktop?.bounds ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const w = b.w;
  const h = b.h;
  if (pet.x < 20) {
    pet.x = 20;
    pet.vx = Math.abs(pet.vx) * RESTITUTION;
    pet.facing = 1;
  }
  if (pet.x > w - 20) {
    pet.x = w - 20;
    pet.vx = -Math.abs(pet.vx) * RESTITUTION;
    pet.facing = -1;
  }
  const minY = pet.minFeetY();
  if (pet.y < minY) {
    pet.y = minY;
    if (pet.vy < 0) pet.vy = Math.max(180, Math.abs(pet.vy) * 0.4);
    pet.mustDescend = true;
    if (pet.onGround) {
      pet.onGround = false;
      pet.setMode("fall");
    }
  }
  const floor = screenFloorY();
  if (pet.y > floor) {
    pet.y = floor;
    if (!pet.dragging && pet.vy >= 0 && !pet.onGround) {
      stickLanding(floor);
    }
  }
}

function startDrag(x: number, y: number, id: number): void {
  pet.dragging = true;
  pet.pointerId = id;
  pet.touch();
  pet.vx = 0;
  pet.vy = 0;
  pet.onGround = false;
  pet.targetX = null;
  pet.setMode("held");
  pet.samples = [{ x, y, t: performance.now() }];
  pet.x = x;
  pet.y = y + 18;
  try {
    canvas.setPointerCapture(id);
  } catch {
    // capture is optional
  }
  api.setIgnoreMouse(false);
  pet.say(pick(HELD_LINES), 1600);
  playSfx(pet.settings.sfx, 420);
}

function endDrag(): void {
  if (!pet.dragging) return;
  if (pet.pointerId != null) {
    try {
      canvas.releasePointerCapture(pet.pointerId);
    } catch {
      // already released
    }
  }
  pet.dragging = false;
  pet.pointerId = null;
  const now = performance.now();
  const samples = pet.samples.filter((s) => now - s.t < 120);
  if (samples.length >= 2) {
    const a = samples[0]!;
    const b = samples[samples.length - 1]!;
    const dt = Math.max((b.t - a.t) / 1000, 0.016);
    pet.vx = (b.x - a.x) / dt;
    pet.vy = (b.y - a.y) / dt;
  } else {
    pet.vx = 0;
    pet.vy = 0;
  }
  const speed = Math.hypot(pet.vx, pet.vy);
  pet.vx = Math.max(-2200, Math.min(2200, pet.vx));
  pet.vy = Math.max(-2200, Math.min(2200, pet.vy));
  pet.setMode("fall");
  if (speed > THROW_SPEED) pet.say(pick(THROW_LINES), 1800);
  pet.samples = [];
}

function onClick(): void {
  pet.touch();
  const hop = Math.random() < 0.45;
  const anim = hop ? "happy_hop" : "blink_tilt";
  pet.setMode("react", anim);
  pet.say(pick(hop ? HAPPY_LINES : CLICK_LINES));
  playSfx(pet.settings.sfx, hop ? 880 : 620);
  if (pet.onGround && hop) {
    pet.vy = -280;
    pet.onGround = false;
  }
}

function openChat(): void {
  closeKeyForm();
  pet.chatOpen = true;
  pet.touch();
  chatForm.classList.remove("hidden");
  layoutChrome();
  void api.focusWindow();
  window.setTimeout(() => {
    chatInput.focus();
  }, 40);
}

function formatScale(n: number): string {
  return `${n.toFixed(1)}×`;
}

function syncMenu(): void {
  scaleSlider.value = String(pet.settings.scale);
  scaleLabel.textContent = formatScale(pet.settings.scale);
  for (const btn of menuEl.querySelectorAll<HTMLButtonElement>("[data-check]")) {
    const key = btn.dataset.check as "alwaysOnTop" | "sfx" | "kickIcons" | "openAtLogin";
    btn.classList.toggle("checked", Boolean(pet.settings[key]));
  }
}

function openMenu(x: number, y: number): void {
  pet.menuOpen = true;
  syncMenu();
  menuEl.classList.remove("hidden");
  const pad = 8;
  const mw = menuEl.offsetWidth || 220;
  const mh = menuEl.offsetHeight || 240;
  const left = Math.max(pad, Math.min(x, window.innerWidth - mw - pad));
  const top = Math.max(pad, Math.min(y, window.innerHeight - mh - pad));
  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = `${Math.round(top)}px`;
  api.setIgnoreMouse(true);
  void mousePassThrough();
}

function closeMenu(): void {
  pet.menuOpen = false;
  menuEl.classList.add("hidden");
}

function closeChat(): void {
  pet.chatOpen = false;
  chatForm.classList.add("hidden");
  chatInput.blur();
}

function closeKeyForm(): void {
  pet.keyOpen = false;
  keyForm.classList.add("hidden");
  keyInput.blur();
  keyInput.value = "";
  api.setIgnoreMouse(true);
}

function openKeyForm(): void {
  closeMenu();
  pet.keyOpen = true;
  pet.touch();
  keyForm.classList.remove("hidden");
  layoutChrome();
  void api.focusWindow();
  window.setTimeout(() => keyInput.focus(), 40);
}

function scheduleIdle(): void {
  pet.nextIdleAt = performance.now() + rand(30_000, 180_000);
}

function currentSupport(): Platform | null {
  return pet.platformUnder(pet.x, pet.y, 18);
}

function platKey(p: Platform): string {
  return p.id ?? `${p.kind}:${Math.round(p.x)}:${Math.round(p.y)}`;
}

function isSmallPlatform(p: Platform): boolean {
  return p.kind === "icon" || p.w < 140;
}

function shouldComeDown(from?: Platform | null): boolean {
  if (pet.mustDescend) return true;
  if (pet.upHops >= 2) return true;
  const y = from?.y ?? pet.y;
  return y < pet.minFeetY() + 36;
}

function isFolderPlatform(p: Platform): boolean {
  if (p.kind !== "icon") return false;
  return Boolean(pet.desktop?.icons.find((i) => i.name === p.id && i.isFolder));
}

function hopToPlatform(dest: Platform): void {
  if (dest.kind !== "floor" && dest.kind !== "dock" && !pet.canStandOn(dest)) return;
  const from = currentSupport();
  if (from) pet.airSkipKey = platKey(from);
  const tx = clampTargetOn(dest);
  const ty = dest.y;
  let aimX = tx;
  const rise = pet.y - ty;
  if (rise < -50 && from && pet.x >= from.x - 4 && pet.x <= from.x + from.w + 4) {
    const left = from.x - 28;
    const right = from.x + from.w + 28;
    if (tx >= from.x && tx <= from.x + from.w) {
      aimX = pet.x - from.x < from.w / 2 ? left : right;
    } else {
      aimX = tx < pet.x ? Math.min(tx, left) : Math.max(tx, right);
    }
  }
  const dx = aimX - pet.x;
  pet.onGround = false;
  pet.facing = dx >= 0 ? 1 : -1;
  pet.targetX = tx;
  if (rise > 40) {
    const jumpV = Math.min(1100, Math.sqrt(2 * GRAVITY * rise) * 0.94);
    pet.vy = -jumpV;
    const airT = jumpV / GRAVITY + 0.18;
    pet.vx = dx / Math.max(0.28, airT);
  } else if (rise < -50) {
    pet.vy = -80;
    const drop = Math.max(80, -rise);
    const airT = 0.16 + Math.sqrt((2 * drop) / GRAVITY);
    pet.vx = dx / Math.max(0.22, airT);
  } else {
    pet.vy = -340;
    const airT = Math.max(0.22, (2 * 340) / GRAVITY);
    pet.vx = dx / airT;
  }
  pet.vx = Math.max(-480, Math.min(480, pet.vx));
  pet.setMode("fall");
}

function pickHopDest(from: Platform): Platform | null {
  const fromKey = platKey(from);
  const down = shouldComeDown(from);
  const raw = (pet.desktop?.platforms ?? []).filter((p) => {
    if (platKey(p) === fromKey) return false;
    if (p.kind !== "floor" && p.kind !== "dock" && !pet.canStandOn(p)) return false;
    if (!down && p.kind === "floor") return false;
    if (down && p.y <= from.y + 18) return false;
    const cx = p.x + p.w / 2;
    const d = dist(pet.x, pet.y, cx, p.y);
    if (d > 1600) return false;
    if (!down && d <= 36) return false;
    return true;
  });
  const fallback = () =>
    (pet.desktop?.platforms ?? []).find((p) => p.kind === "dock" && platKey(p) !== fromKey) ??
    (pet.desktop?.platforms ?? []).find((p) => p.kind === "floor" && platKey(p) !== fromKey) ??
    null;
  if (!raw.length) return down ? fallback() : null;
  const noBack = down ? raw : raw.filter((p) => platKey(p) !== pet.lastHopFrom);
  const cands = noBack.length ? noBack : raw;
  const scored = cands
    .map((p) => {
      const cx = p.x + p.w / 2;
      const dx = cx - pet.x;
      const d = dist(pet.x, pet.y, cx, p.y);
      let score = 800 - d;
      if (p.kind === "window") score += 90;
      if (p.kind === "dock") score += down ? 160 : 0;
      if (isFolderPlatform(p)) score += 130;
      if (dx * pet.facing > 8) score += 70;
      if (down) score += Math.min(320, p.y - from.y);
      else if (Math.abs(p.y - from.y) < 70 && Math.abs(dx) > 40) score += 80;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(5, scored.length));
  return pick(top).p;
}

function hopToAnother(from: Platform): void {
  const dest = pickHopDest(from);
  pet.lastHopFrom = platKey(from);
  pet.airSkipKey = platKey(from);
  if (dest) {
    if (dest.y < from.y - 28) pet.upHops += 1;
    else {
      pet.upHops = 0;
      if (dest.y > from.y + 24) pet.mustDescend = false;
    }
    hopToPlatform(dest);
    pet.nextIdleAt = performance.now() + rand(2800, 7000);
    return;
  }
  pet.upHops = 0;
  pet.mustDescend = false;
  if (from.kind === "floor" || from.kind === "dock") {
    pet.airSkipKey = "";
    strollHere();
    return;
  }
  pet.onGround = false;
  pet.vy = 120;
  pet.vx = pet.facing * 220;
  pet.targetX = null;
  pet.setMode("fall");
}

function clampTargetOn(p: Platform): number {
  const pad = Math.min(24, Math.max(8, p.w / 4));
  const minX = p.x + pad;
  const maxX = p.x + p.w - pad;
  if (maxX <= minX) return p.x + p.w / 2;
  return rand(minX, maxX);
}

function strollHere(): void {
  const here = currentSupport();
  if (here && isSmallPlatform(here)) {
    const mid = here.x + here.w / 2;
    pet.targetX = pet.x <= mid ? here.x + here.w - 8 : here.x + 8;
    pet.facing = (pet.targetX ?? pet.x) >= pet.x ? 1 : -1;
    if (pet.mode !== "walk") pet.setMode("walk");
    return;
  }
  if (here) pet.targetX = clampTargetOn(here);
  else {
    const w = pet.desktop?.bounds.w ?? window.innerWidth;
    pet.targetX = Math.max(40, Math.min(w - 40, pet.x + rand(-220, 220)));
  }
  if (pet.mode !== "walk") pet.setMode("walk");
}

function arriveWalk(): void {
  const here = currentSupport();
  if (here && (isSmallPlatform(here) || shouldComeDown(here))) {
    hopToAnother(here);
    return;
  }
  strollHere();
}

function pickWalkTarget(): Platform | null {
  const here = currentSupport();
  if (here && isSmallPlatform(here)) {
    const dest = pickHopDest(here);
    if (dest) {
      pet.targetX = clampTargetOn(dest);
      return dest;
    }
  }
  const plats = (pet.desktop?.platforms ?? []).filter(
    (p) => p.kind !== "floor" && p.w > 28 && pet.canStandOn(p),
  );
  if (here && !isSmallPlatform(here) && Math.random() < 0.55) {
    pet.targetX = clampTargetOn(here);
    return here;
  }
  if (!plats.length) {
    const w = pet.desktop?.bounds.w ?? window.innerWidth;
    pet.targetX = Math.max(40, Math.min(w - 40, pet.x + rand(-280, 280)));
    return here;
  }
  const p = pick(plats);
  pet.targetX = clampTargetOn(p);
  return p;
}

function startWander(): void {
  const here = currentSupport();
  if (here && (isSmallPlatform(here) || shouldComeDown(here))) {
    hopToAnother(here);
    return;
  }
  const dest = pickWalkTarget();
  if (dest && pet.onGround && dest.y < pet.y - 64) {
    hopToPlatform(dest);
    pet.upHops += 1;
    return;
  }
  if (dest && pet.onGround && dest.y > pet.y + 56) {
    if (here && here.w > 40) {
      const right = here.x + here.w + 12;
      const left = here.x - 12;
      const want = pet.targetX ?? dest.x + dest.w / 2;
      pet.targetX = Math.abs(want - pet.x) < 8 ? (pet.facing >= 0 ? right : left) : want >= pet.x ? right : left;
    }
  }
  if (pet.mode !== "walk") pet.setMode("walk");
}

function maybeFolderBehavior(now: number): void {
  if (now < pet.folderCooldownUntil || !pet.onGround) return;
  const icon = nearestFolder();
  if (!icon) return;
  const cx = icon.x + icon.w / 2;
  if (Math.abs(pet.x - cx) > icon.w * 0.6) return;
  if (Math.abs(pet.y - icon.y) > 56) return;
  pet.folderCooldownUntil = now + 20_000;
  const roll = Math.random();
  if (roll < 0.34) {
    pet.setMode("sit");
    pet.say(pick(FOLDER_LINES));
    pet.targetX = null;
    pet.napPending = false;
    pet.sitUntil = now + 5000;
  } else if (roll < 0.67) {
    pet.setMode("look");
    pet.lookUntil = now + 2500;
    pet.say(pick(FOLDER_LINES));
  } else if (pet.settings.kickIcons) {
    const dir = pet.facing;
    void api.kickIcon(
      icon.name,
      icon.x + screenOrigin.x + 32 + dir * 56,
      icon.y + screenOrigin.y + 16,
    );
    pet.setMode("react", "happy_hop");
    pet.say("踢。");
  } else {
    pet.setMode("look");
    pet.lookUntil = now + 1800;
  }
}

function nearestFolder(): DesktopIcon | null {
  let best: DesktopIcon | null = null;
  let bestD = 120;
  for (const icon of pet.desktop?.icons ?? []) {
    if (!icon.isFolder) continue;
    const d = dist(pet.x, pet.y, icon.x + icon.w / 2, icon.y);
    if (d < bestD) {
      best = icon;
      bestD = d;
    }
  }
  return best;
}

function maybeTrashPanic(now: number): void {
  const trash = pet.desktop?.trash;
  if (!trash || now < pet.trashCooldownUntil) return;
  const cx = trash.x + trash.w / 2;
  const cy = trash.y + trash.h / 2;
  if (dist(pet.x, pet.y, cx, cy) > 90) return;
  pet.trashCooldownUntil = now + 8000;
  pet.panicUntil = now + 1400;
  pet.setMode("panic");
  pet.facing = pet.x > cx ? 1 : -1;
  pet.vx = pet.facing * 380;
  pet.vy = -220;
  pet.onGround = false;
  pet.targetX = null;
  pet.say(pick(PANIC_LINES));
}

function beginSit(now: number, thenSleep: boolean, sitMs: number): void {
  pet.napPending = thenSleep;
  pet.sitUntil = now + sitMs;
  pet.setMode("sit");
  pet.targetX = null;
}

function beginSleep(now: number): void {
  pet.napPending = false;
  pet.setMode("sleep");
  pet.sleepUntil = now + rand(12_000, 24_000);
  pet.say(pick(SLEEP_LINES), 4000);
}

function idleTick(now: number): void {
  if (pet.dragging || pet.chatOpen || pet.menuOpen || pet.keyOpen) return;
  if (pet.mode === "held" || pet.mode === "fall" || pet.mode === "land" || pet.mode === "panic" || pet.mode === "react") {
    return;
  }
  if (pet.mode === "sleep") {
    if (now >= pet.sleepUntil) {
      strollHere();
      pet.nextIdleAt = now + rand(4000, 9000);
    }
    return;
  }
  if (pet.mode === "sit") {
    if (now >= pet.sitUntil) {
      if (pet.napPending) beginSleep(now);
      else {
        strollHere();
        pet.nextIdleAt = now + rand(4000, 8000);
      }
    }
    return;
  }
  if (now > pet.napAt && pet.onGround) {
    beginSit(now, true, 1600);
    pet.say(pick(SLEEP_LINES));
    pet.napAt = now + rand(50_000, 95_000);
    return;
  }
  if (pet.mode === "idle" || (pet.mode === "walk" && pet.targetX == null)) {
    if (pet.onGround) strollHere();
  }
  if (pet.mode === "walk" && pet.targetX != null && now < pet.nextIdleAt) return;
  if (now < pet.nextIdleAt) return;
  const roll = Math.random();
  if (roll < 0.58) {
    startWander();
    pet.nextIdleAt = now + rand(8000, 16000);
  } else if (roll < 0.72) {
    pet.setMode("look");
    pet.lookUntil = now + 2400;
    pet.nextIdleAt = now + rand(4000, 9000);
  } else if (roll < 0.84) {
    beginSit(now, false, rand(2800, 4500));
  } else {
    beginSit(now, true, 1500);
    pet.say(pick(SLEEP_LINES));
    pet.napAt = now + rand(50_000, 95_000);
  }
}

function hourAndHoliday(nowClock: Date): void {
  const hour = nowClock.getHours();
  const minute = nowClock.getMinutes();
  if (minute === 0 && pet.lastHourSpoken !== hour) {
    pet.lastHourSpoken = hour;
    const lines = HOUR_LINES[hour];
    if (lines) pet.say(pick(lines), 3200);
  }
  const md = `${String(nowClock.getMonth() + 1).padStart(2, "0")}-${String(nowClock.getDate()).padStart(2, "0")}`;
  if (pet.lastHoliday !== md) {
    pet.lastHoliday = md;
    const hit = HOLIDAYS.find((h) => h.md === md);
    if (hit) pet.say(pick(hit.lines), 4000);
  }
}

function physics(dt: number): void {
  if (pet.dragging) return;

  const movingAir = !pet.onGround || Math.abs(pet.vy) > 10 || Math.abs(pet.vx) > 30;
  if (movingAir && pet.mode !== "held" && pet.mode !== "panic" && pet.mode !== "react" && pet.mode !== "land") {
    if (!pet.onGround && pet.mode !== "fall") pet.setMode("fall");
  }

  if (!pet.onGround) {
    const prevY = pet.y;
    pet.vy += GRAVITY * dt;
    pet.x += pet.vx * dt;
    pet.y += pet.vy * dt;
    pet.facing = pet.vx >= 0 ? 1 : -1;

    const inside = pet.vy >= 0 ? pet.solidContaining(pet.x, pet.y) : null;
    const swept = pet.vy >= 0 ? pet.groundBetween(pet.x, prevY, pet.y) : null;
    const probed = pet.vy >= 0 ? pet.groundY(pet.x, Math.min(prevY, pet.y) - 10) : null;
    const floor = screenFloorY();
    let ground = inside ? inside.y : (swept ?? probed);
    if (ground == null && pet.vy >= 0 && pet.y >= floor - 4) ground = floor;
    if (ground != null && pet.y >= ground && pet.vy >= 0) {
      const plat = pet.platformUnder(pet.x, ground, 18);
      const bottom = isBottomSurface(plat, ground);
      if (Math.abs(pet.vy) > STOP_VY && !inside && !pet.airSkipKey && !bottom) {
        pet.y = ground;
        pet.vy = -pet.vy * RESTITUTION;
        pet.vx *= 0.72;
        pet.onGround = false;
        pet.setMode("land");
        pet.say(pick(LAND_LINES), 1400);
        playSfx(pet.settings.sfx, 280);
      } else {
        stickLanding(ground);
      }
    }
  } else {
    pet.vy = 0;
    const ground =
      pet.mode === "walk" || pet.mode === "panic"
        ? pet.walkSurface(pet.x, pet.y)
        : pet.groundY(pet.x, pet.y + 4) ?? pet.groundY(pet.x, pet.y - 8);
    if (ground == null) {
      const fy = screenFloorY();
      if (pet.y >= fy - 28) {
        pet.y = fy;
      } else {
        const prev = pet.platformUnder(pet.x - pet.facing * 14, pet.y, 28);
        if (pet.mode === "walk" && prev && (isSmallPlatform(prev) || shouldComeDown(prev)) && !isBottomSurface(prev, prev.y)) {
          hopToAnother(prev);
        } else {
          pet.onGround = false;
          pet.setMode("fall");
        }
      }
    } else {
      pet.y = ground;
    }

    if (pet.mode === "walk" || pet.mode === "panic") {
      const speed = pet.mode === "panic" ? 220 : WALK_SPEED;
      if (pet.targetX != null) {
        const dx = pet.targetX - pet.x;
        pet.facing = dx >= 0 ? 1 : -1;
        pet.x += Math.sign(dx) * speed * dt;
        if (Math.abs(dx) < 4) {
          pet.targetX = null;
          pet.vx = 0;
          if (pet.mode === "walk") arriveWalk();
        }
      } else {
        pet.x += pet.facing * speed * dt;
      }
    } else if (Math.abs(pet.vx) > 8) {
      pet.x += pet.vx * dt;
      pet.vx *= Math.max(0, 1 - dt * 4);
    } else {
      pet.vx = 0;
    }
  }

  clampToScreen();
}

function layoutChrome(): void {
  const h = pet.hit;
  const chatW = 188;
  const chatH = 36;
  let chatLeft = h.x + h.w / 2 - chatW / 2;
  let chatTop = h.y - chatH - 10;
  if (chatTop < 8) chatTop = h.y + h.h + 8;
  if (chatTop + chatH > window.innerHeight - 8) chatTop = Math.max(8, h.y - chatH - 10);
  chatLeft = Math.max(8, Math.min(chatLeft, window.innerWidth - chatW - 8));
  chatForm.style.left = `${Math.round(chatLeft)}px`;
  chatForm.style.top = `${Math.round(chatTop)}px`;

  const keyW = 236;
  const keyH = 128;
  let keyLeft = h.x + h.w / 2 - keyW / 2;
  let keyTop = chatForm.classList.contains("hidden") ? h.y - keyH - 10 : chatTop - keyH - 8;
  if (keyTop < 8) keyTop = h.y + h.h + 8;
  if (keyTop + keyH > window.innerHeight - 8) keyTop = Math.max(8, h.y - keyH - 10);
  keyLeft = Math.max(8, Math.min(keyLeft, window.innerWidth - keyW - 8));
  keyForm.style.left = `${Math.round(keyLeft)}px`;
  keyForm.style.top = `${Math.round(keyTop)}px`;

  let bubbleTop = chatForm.classList.contains("hidden") ? h.y - 36 : chatTop - 40;
  if (bubbleTop < 8) bubbleTop = h.y + h.h + 8;
  bubbleEl.style.left = `${Math.round(Math.max(8, h.x + h.w * 0.55))}px`;
  bubbleEl.style.top = `${Math.round(bubbleTop)}px`;
  zzzEl.style.left = `${Math.round(h.x + h.w * 0.7)}px`;
  zzzEl.style.top = `${Math.round(Math.max(8, h.y - 18))}px`;
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pet.sprite.draw(ctx, pet.x, pet.y, pet.scale, pet.facing, pet.settings.opacity);

  const showBubble = performance.now() < pet.bubbleUntil && pet.bubbleText;
  bubbleEl.classList.toggle("hidden", !showBubble);
  if (showBubble) bubbleEl.textContent = pet.bubbleText;
  zzzEl.classList.toggle("hidden", pet.mode !== "sleep");
  layoutChrome();
}

function interactHit(px: number, py: number): boolean {
  if (pet.contains(px, py)) return true;
  if (pet.menuOpen) {
    const r = menuEl.getBoundingClientRect();
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return true;
  }
  if (pet.keyOpen) {
    const r = keyForm.getBoundingClientRect();
    if (px >= r.left - 8 && px <= r.right + 8 && py >= r.top - 8 && py <= r.bottom + 8) return true;
  }
  if (pet.chatOpen) {
    const h = pet.hit;
    const r = chatForm.getBoundingClientRect();
    const minX = Math.min(h.x, r.left) - 12;
    const maxX = Math.max(h.x + h.w, r.right) + 12;
    const minY = Math.min(h.y, r.top) - 12;
    const maxY = Math.max(h.y + h.h, r.bottom) + 12;
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true;
  }
  if (!bubbleEl.classList.contains("hidden")) {
    const r = bubbleEl.getBoundingClientRect();
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return true;
  }
  return false;
}

let lastCursor = { x: 0, y: 0 };
let prevCursor = { x: 0, y: 0 };
let lastPetUpAt = 0;
let pressing = false;
let pressAt = 0;
let pressPos = { x: 0, y: 0 };
let pressPointerId = 0;
let holdTimer: number | null = null;

function clearHoldTimer(): void {
  if (holdTimer != null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
}

async function mousePassThrough(): Promise<void> {
  const c = toLocal(await api.getCursor());
  lastCursor = c;
  if (pressing || pet.dragging) {
    api.setIgnoreMouse(false);
    return;
  }
  const over = interactHit(c.x, c.y);
  api.setIgnoreMouse(!over);
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button === 2) {
    ev.preventDefault();
    return;
  }
  if (pet.menuOpen && !menuEl.contains(ev.target as Node)) {
    closeMenu();
  }
  if (ev.button !== 0) return;
  if (!pet.contains(ev.clientX, ev.clientY)) return;
  pressing = true;
  pressAt = performance.now();
  pressPos = { x: ev.clientX, y: ev.clientY };
  pressPointerId = ev.pointerId;
  pet.samples = [{ x: ev.clientX, y: ev.clientY, t: pressAt }];
  api.setIgnoreMouse(false);
  clearHoldTimer();
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    if (pressing && !pet.dragging) startDrag(pressPos.x, pressPos.y, pressPointerId);
  }, DRAG_HOLD_MS);
}

function maybeStartDrag(x: number, y: number, id: number): void {
  if (pet.dragging || !pressing) return;
  const moved = Math.hypot(x - pressPos.x, y - pressPos.y);
  const held = performance.now() - pressAt;
  if (held < 40 && moved > 80) return;
  const wantDrag = moved > DRAG_SLOP;
  if (!wantDrag) return;
  clearHoldTimer();
  if (pet.clickTimer != null) {
    window.clearTimeout(pet.clickTimer);
    pet.clickTimer = null;
  }
  startDrag(x, y, id);
}

function onPointerMove(ev: PointerEvent): void {
  if (pet.dragging && ev.pointerId === pet.pointerId) {
    pet.x = ev.clientX;
    pet.y = ev.clientY + 18;
    pet.samples.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (pet.samples.length > 6) pet.samples.shift();
    return;
  }
  if ((ev.buttons & 1) && pressing) {
    pet.samples.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (pet.samples.length > 6) pet.samples.shift();
    maybeStartDrag(ev.clientX, ev.clientY, ev.pointerId);
  }
}

function onPointerUp(ev: PointerEvent): void {
  if (ev.button === 2) return;
  const wasPressing = pressing;
  pressing = false;
  clearHoldTimer();
  if (pet.dragging) {
    endDrag();
    return;
  }
  if (!wasPressing) return;
  if (!pet.contains(ev.clientX, ev.clientY) && Math.hypot(ev.clientX - pressPos.x, ev.clientY - pressPos.y) > DRAG_SLOP) {
    return;
  }
  const now = performance.now();
  if (now - lastPetUpAt < 350) {
    lastPetUpAt = 0;
    if (pet.clickTimer != null) {
      window.clearTimeout(pet.clickTimer);
      pet.clickTimer = null;
    }
    pet.touch();
    const anim = Math.random() < 0.5 ? "spin" : "heart";
    pet.setMode("react", anim);
    pet.say(anim === "heart" ? "……给。" : "转。");
    openChat();
    playSfx(pet.settings.sfx, 980);
    return;
  }
  lastPetUpAt = now;
  if (pet.clickTimer != null) window.clearTimeout(pet.clickTimer);
  pet.clickTimer = window.setTimeout(() => {
    pet.clickTimer = null;
    onClick();
  }, 350);
}

pet.sprite.onOneShotEnd = () => {
  if (pet.mode === "react" || pet.mode === "land") {
    if (pet.onGround) strollHere();
    else pet.setMode("fall");
  }
};

menuEl.addEventListener("pointerdown", (ev) => ev.stopPropagation());
scaleSlider.addEventListener("input", () => {
  const v = clampScale(Number(scaleSlider.value));
  pet.settings = { ...pet.settings, scale: v };
  scaleLabel.textContent = formatScale(v);
  void api.setSettings({ scale: v });
});
menuEl.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "chat") {
    closeMenu();
    openChat();
  } else if (act === "top") {
    void api.setSettings({ alwaysOnTop: !pet.settings.alwaysOnTop });
  } else if (act === "sfx") {
    void api.setSettings({ sfx: !pet.settings.sfx });
  } else if (act === "kick") {
    void api.setSettings({ kickIcons: !pet.settings.kickIcons });
  } else if (act === "login") {
    void api.setSettings({ openAtLogin: !pet.settings.openAtLogin });
  } else if (act === "key") {
    openKeyForm();
  } else if (act === "quit") {
    api.quit();
  }
});

keyForm.addEventListener("pointerdown", (ev) => ev.stopPropagation());
keyPaste.addEventListener("click", async () => {
  const text = (await api.readClipboard()).trim();
  if (text) keyInput.value = text;
  keyInput.focus();
});
keyCancel.addEventListener("click", () => closeKeyForm());
keyForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const key = keyInput.value.trim();
  if (key) {
    void api.setSettings({ apiKey: key });
    pet.say("……记住了。", 2000);
  }
  closeKeyForm();
});

chatForm.addEventListener("pointerdown", (ev) => ev.stopPropagation());
chatForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = chatInput.value;
  chatInput.value = "";
  if (!text.trim()) {
    closeChat();
    return;
  }
  pet.touch();
  const now = performance.now();
  if (now - pet.chatWindowStart > 10 * 60 * 1000) {
    pet.chatWindowStart = now;
    pet.chatCount = 0;
  }
  pet.chatCount += 1;
  pet.sleepy = pet.chatCount >= 8;
  if (pet.sleepy && pet.chatCount % 3 === 0) {
    pet.setMode("react", "yawn");
    pet.say(pick(YAWN_LINES));
  }
  const cmd = parseCommand(text, pet.sleepy);
  if (cmd.kind === "anim") {
    pet.setMode(cmd.name === "sleep" ? "sleep" : "react", cmd.name);
    pet.say(cmd.line);
    if (cmd.name === "sleep") {
      pet.mode = "sleep";
      pet.sleepUntil = performance.now() + rand(14_000, 26_000);
    }
  } else if (cmd.kind === "come") {
    pet.targetX = lastCursor.x;
    pet.setMode("walk");
    pet.say(cmd.line);
  } else if (cmd.kind === "fly") {
    pet.onGround = false;
    pet.vy = -920;
    pet.vx = pet.facing * 180;
    pet.setMode("fall");
    pet.say(cmd.line);
  } else if (cmd.kind === "agent") {
    pet.say("……绘梨衣去弄。", 4000);
    const result = await api.runAgent(cmd.prompt);
    pet.say(agentSpeech(result), 5000);
  } else {
    pet.say(cmd.line);
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    closeMenu();
    closeChat();
    closeKeyForm();
    api.setIgnoreMouse(true);
  }
});

window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", () => {
  pressing = false;
  clearHoldTimer();
  if (pet.dragging) endDrag();
});
window.addEventListener("contextmenu", (ev) => {
  if (menuEl.contains(ev.target as Node)) {
    ev.preventDefault();
    return;
  }
  if (pet.contains(ev.clientX, ev.clientY)) {
    ev.preventDefault();
    openMenu(ev.clientX, ev.clientY);
  }
});
window.addEventListener("dragenter", (ev) => {
  if ([...ev.dataTransfer!.types].includes("Files")) {
    pet.setMode("look");
    pet.lookUntil = performance.now() + 1600;
    pet.facing = ev.clientX >= pet.x ? 1 : -1;
    pet.say(pick(LOOK_LINES), 1600);
  }
});
window.addEventListener("dragover", (ev) => ev.preventDefault());

api.onDesktop((state) => {
  screenOrigin = { x: state.bounds.x, y: state.bounds.y };
  pet.desktop = toLocalDesktop(state);
});
api.onOpenChat(() => {
  const already = pet.chatOpen;
  openChat();
  if (!already) {
    const special = Math.random() < 0.5 ? "spin" : "heart";
    pet.setMode("react", special);
  }
});
api.onOpenKey(() => {
  openKeyForm();
});
api.onSettings((s) => {
  pet.settings = s;
  if (pet.menuOpen) syncMenu();
});

let last = performance.now();
let accMouse = 0;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const active =
    pet.dragging ||
    !pet.onGround ||
    pet.mode === "walk" ||
    pet.mode === "panic" ||
    pet.mode === "react" ||
    pet.chatOpen ||
    pet.keyOpen ||
    pet.menuOpen;
  const fps = active ? MOVE_FPS : IDLE_FPS;
  const step = 1 / fps;
  pet.acc += dt;
  while (pet.acc >= step) {
    pet.acc -= step;
    physics(step);
    pet.sprite.update(step);
  }

  if (pet.mode === "look" && now > pet.lookUntil) strollHere();
  if (pet.mode === "panic" && now > pet.panicUntil && pet.onGround) strollHere();

  maybeTrashPanic(now);
  maybeFolderBehavior(now);
  idleTick(now);
  hourAndHoliday(new Date());

  accMouse += dt;
  if (accMouse > 0.05) {
    accMouse = 0;
    void mousePassThrough();
    const cursorSpeed = dist(prevCursor.x, prevCursor.y, lastCursor.x, lastCursor.y) / 0.05;
    prevCursor = lastCursor;
    if (
      !pet.dragging &&
      pet.mode === "idle" &&
      dist(lastCursor.x, lastCursor.y, pet.x, pet.y) < 120 &&
      cursorSpeed > 700
    ) {
      pet.setMode("look");
      pet.lookUntil = performance.now() + 1400;
      pet.facing = lastCursor.x >= pet.x ? 1 : -1;
      pet.say(pick(LOOK_LINES), 1400);
    } else if (!pet.dragging && pet.mode === "idle" && dist(lastCursor.x, lastCursor.y, pet.x, pet.y) < 110) {
      pet.facing = lastCursor.x >= pet.x ? 1 : -1;
    }
  }

  draw();
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  resize();
  window.addEventListener("resize", resize);
  pet.settings = await api.getSettings();
  try {
    const packed = await loadAtlas();
    pet.sprite.image = packed.image;
    pet.sprite.atlas = packed.atlas;
    pet.sprite.play("idle");
  } catch (err) {
    console.error("atlas load failed", err);
  }
  pet.x = window.innerWidth * 0.5;
  pet.y = 80;
  pet.vy = 0;
  pet.lastHourSpoken = new Date().getHours();
  pet.nextIdleAt = performance.now() + 1200;
  pet.setMode("fall");
  requestAnimationFrame(frame);
}

void boot();
