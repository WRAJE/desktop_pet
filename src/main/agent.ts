import os from "os";
import path from "path";
import { spawn } from "child_process";
import type { AgentResult } from "../shared/types";

export function runDesktopAgent(prompt: string, apiKey: string): Promise<AgentResult> {
  const key = apiKey.trim() || process.env.CURSOR_API_KEY?.trim() || "";
  if (!key) {
    return Promise.resolve({ ok: false, kind: "no_key", message: "no api key" });
  }

  const cwd = path.join(os.homedir(), "Desktop");
  const worker = path.join(__dirname, "agent-worker.js");

  return new Promise((resolve) => {
    const child = spawn(process.env.npm_node_execpath || "node", [worker], {
      cwd: path.join(__dirname, "..", ".."),
      env: { ...process.env, CURSOR_API_KEY: key },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, kind: "run_failed", message: "timeout" });
    }, 120_000);

    child.stdout.on("data", (buf) => {
      out += String(buf);
    });
    child.stderr.on("data", (buf) => {
      err += String(buf);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, kind: "start_failed", message: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out.trim().split("\n").pop() || "") as AgentResult;
        resolve(parsed);
      } catch {
        const message = err.trim() || out.trim() || `exit ${code}`;
        resolve({ ok: false, kind: "start_failed", message });
      }
    });

    child.stdin.write(JSON.stringify({ prompt, apiKey: key, cwd }));
    child.stdin.end();
  });
}
