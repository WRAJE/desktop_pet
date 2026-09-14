import { contextBridge, ipcRenderer } from "electron";
import type { AgentResult, DesktopState, Settings } from "../shared/types";

export type EriiApi = {
  getSettings: () => Promise<Settings>;
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
  setIgnoreMouse: (ignore: boolean) => void;
  getCursor: () => Promise<{ x: number; y: number }>;
  onDesktop: (cb: (state: DesktopState) => void) => void;
  onOpenChat: (cb: () => void) => void;
  onOpenKey: (cb: () => void) => void;
  onSettings: (cb: (s: Settings) => void) => void;
  showMenu: () => void;
  quit: () => void;
  readClipboard: () => Promise<string>;
  focusWindow: () => Promise<void>;
  kickIcon: (name: string, x: number, y: number) => Promise<boolean>;
  runAgent: (prompt: string) => Promise<AgentResult>;
};

const api: EriiApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  setIgnoreMouse: (ignore) => ipcRenderer.send("mouse:ignore", ignore),
  getCursor: () => ipcRenderer.invoke("mouse:cursor"),
  onDesktop: (cb) => {
    ipcRenderer.on("desktop:state", (_evt, state: DesktopState) => cb(state));
  },
  onOpenChat: (cb) => {
    ipcRenderer.on("chat:open", () => cb());
  },
  onOpenKey: (cb) => {
    ipcRenderer.on("key:open", () => cb());
  },
  onSettings: (cb) => {
    ipcRenderer.on("settings:changed", (_evt, s: Settings) => cb(s));
  },
  showMenu: () => ipcRenderer.send("menu:show"),
  quit: () => ipcRenderer.send("app:quit"),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  focusWindow: () => ipcRenderer.invoke("window:focus"),
  kickIcon: (name, x, y) => ipcRenderer.invoke("desktop:kick", { name, x, y }),
  runAgent: (prompt) => ipcRenderer.invoke("agent:run", prompt),
};

contextBridge.exposeInMainWorld("erii", api);
