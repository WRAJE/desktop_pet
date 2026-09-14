import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
  globalShortcut,
  clipboard,
  nativeTheme,
} from "electron";
import fs from "fs";
import path from "path";
import { DEFAULT_SETTINGS, clampScale, type Settings } from "../shared/types";
import { kickDesktopItem, snapshotDesktop } from "./desktop";
import { runDesktopAgent } from "./agent";

nativeTheme.themeSource = "dark";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let petVisible = true;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, scale: clampScale(Number(parsed.scale)) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function asset(...parts: string[]): string {
  return path.join(__dirname, "..", "assets", ...parts);
}

function applyAlwaysOnTop(): void {
  if (!win) return;
  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
  }
}

function layoutWindow(): void {
  if (!win) return;
  const b = screen.getPrimaryDisplay().bounds;
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
}

function createWindow(): void {
  const b = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  applyAlwaysOnTop();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  win.once("ready-to-show", () => win?.showInactive());
  win.on("blur", () => restoreClickThrough());
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.code !== "KeyE") return;
    const optionE = input.alt && !input.meta && !input.control;
    const controlE = input.control && !input.meta && !input.alt;
    if (optionE || controlE) {
      event.preventDefault();
      openChatFromMain();
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu(): Menu {
  const scaleChoices = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4];
  const scaleItem = (n: number) => ({
    label: `${n.toFixed(1)}×`,
    type: "radio" as const,
    checked: Math.abs(settings.scale - n) < 0.11,
    click: () => patchSettings({ scale: n }),
  });
  const opacityItem = (v: number, label: string) => ({
    label,
    type: "radio" as const,
    checked: Math.abs(settings.opacity - v) < 0.01,
    click: () => patchSettings({ opacity: v }),
  });

  return Menu.buildFromTemplate([
    {
      label: petVisible ? "隐藏绘梨衣" : "显示绘梨衣",
      accelerator: "Control+Shift+E",
      click: () => togglePet(),
    },
    { label: "打开聊天", accelerator: "Control+E", click: () => openChatFromMain() },
    { type: "separator" },
    { label: "窗口置顶", type: "checkbox", checked: settings.alwaysOnTop, click: () => patchSettings({ alwaysOnTop: !settings.alwaysOnTop }) },
    { label: "缩放大小", submenu: scaleChoices.map(scaleItem) },
    {
      label: "透明度",
      submenu: [opacityItem(1, "100%"), opacityItem(0.8, "80%"), opacityItem(0.5, "50%")],
    },
    { label: "音效", type: "checkbox", checked: settings.sfx, click: () => patchSettings({ sfx: !settings.sfx }) },
    {
      label: "允许轻踢图标",
      type: "checkbox",
      checked: settings.kickIcons,
      click: () => patchSettings({ kickIcons: !settings.kickIcons }),
    },
    {
      label: "开机自启",
      type: "checkbox",
      checked: settings.openAtLogin,
      click: () => patchSettings({ openAtLogin: !settings.openAtLogin }),
    },
    { type: "separator" },
    { label: "设置 API Key…", click: () => openKeyFromMain() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
}

function refreshTrayMenu(): void {
  // Menu is built on demand for left/right click.
}

function createTray(): void {
  const iconFile = fs.existsSync(asset("sprites", "tray.png"))
    ? asset("sprites", "tray.png")
    : asset("icon.png");
  const image = nativeImage.createFromPath(iconFile);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 18, height: 18 }));
  tray.setToolTip("绘梨衣 · 左键显示/隐藏");
  tray.on("click", () => togglePet());
  tray.on("right-click", () => {
    tray?.popUpContextMenu(buildMenu());
  });
}

function restoreClickThrough(): void {
  win?.setIgnoreMouseEvents(true, { forward: true });
}

function showPet(): void {
  if (!win) return;
  petVisible = true;
  layoutWindow();
  applyAlwaysOnTop();
  restoreClickThrough();
  win.showInactive();
}

function hidePet(): void {
  if (!win) return;
  petVisible = false;
  win.hide();
}

function togglePet(): void {
  if (!win) return;
  if (win.isVisible()) hidePet();
  else showPet();
}

function openKeyFromMain(): void {
  if (!win) return;
  showPet();
  win.webContents.send("key:open");
}

function applyLoginItem(): void {
  try {
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: true });
  } catch {
    // macOS may deny this in sandboxed / unsigned runs
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function patchSettings(patch: Partial<Settings>): Settings {
  const next = { ...settings, ...patch };
  if (patch.scale !== undefined) next.scale = clampScale(patch.scale);
  const scaleOnly = Object.keys(patch).length === 1 && patch.scale !== undefined;
  settings = next;
  if (patch.alwaysOnTop !== undefined) applyAlwaysOnTop();
  if (patch.openAtLogin !== undefined) applyLoginItem();
  win?.webContents.send("settings:changed", settings);
  if (scaleOnly) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveSettings();
      refreshTrayMenu();
    }, 250);
  } else {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveSettings();
    refreshTrayMenu();
  }
  return settings;
}

async function pollDesktop(): Promise<void> {
  if (!win) return;
  try {
    const state = await snapshotDesktop();
    win.webContents.send("desktop:state", state);
  } catch {
    // keep last snapshot
  }
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => patchSettings(patch));
  ipcMain.on("mouse:ignore", (_e, ignore: boolean) => {
    if (!win) return;
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });
  ipcMain.handle("mouse:cursor", () => screen.getCursorScreenPoint());
  ipcMain.handle("clipboard:read", () => clipboard.readText());
  ipcMain.on("menu:show", () => {
    restoreClickThrough();
    buildMenu().popup({ window: win ?? undefined });
  });
  ipcMain.on("app:quit", () => app.quit());
  ipcMain.handle("desktop:kick", async (_e, payload: { name: string; x: number; y: number }) => {
    if (!settings.kickIcons) return false;
    return kickDesktopItem(payload.name, payload.x, payload.y);
  });
  ipcMain.handle("agent:run", async (_e, prompt: string) => {
    return runDesktopAgent(String(prompt || ""), settings.apiKey);
  });
  ipcMain.handle("window:focus", () => {
    if (!win) return;
    showPet();
    win.webContents.focus();
  });
}

function openChatFromMain(): void {
  if (!win) return;
  showPet();
  win.webContents.focus();
  win.webContents.send("chat:open");
}

function registerShortcuts(): void {
  // Option+E 在 macOS 是 é 死键，全局热键经常注册失败；⌃E / ⌥⇧E 作为可用热键。
  for (const accel of ["Control+E", "Alt+Shift+E", "Alt+E", "Option+E", "Command+Escape", "Control+Shift+E"]) {
    try {
      globalShortcut.register(accel, () => {
        if (accel === "Command+Escape") restoreClickThrough();
        else if (accel === "Control+Shift+E") togglePet();
        else openChatFromMain();
      });
    } catch {
      // ignore unavailable accelerators
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock?.hide();
    settings = loadSettings();
    if (settings.openAtLogin) applyLoginItem();
    registerIpc();
    createWindow();
    createTray();
    layoutWindow();
    void pollDesktop();
    setInterval(() => void pollDesktop(), 500);
    screen.on("display-metrics-changed", layoutWindow);
    screen.on("display-added", layoutWindow);
    screen.on("display-removed", layoutWindow);
    registerShortcuts();
  });

  app.on("second-instance", () => {
    showPet();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
