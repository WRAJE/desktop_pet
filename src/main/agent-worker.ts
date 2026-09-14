import fs from "fs";
import { Agent, CursorAgentError } from "@cursor/sdk";

type Payload = { prompt: string; apiKey: string; cwd: string };

async function main(): Promise<void> {
  const raw = fs.readFileSync(0, "utf8");
  const { prompt, apiKey, cwd } = JSON.parse(raw) as Payload;

  try {
    const result = await Agent.prompt(
      [
        "You are helping from a macOS desktop pet named 绘梨衣.",
        "Only do the user's requested filesystem / desktop task.",
        "Prefer creating things on the user's Desktop.",
        "Keep any final summary to one short sentence.",
        "",
        `User request: ${prompt}`,
      ].join("\n"),
      {
        apiKey,
        model: { id: "composer-2.5" },
        local: { cwd },
      },
    );

    if (result.status === "error") {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          kind: "run_failed",
          message: result.error?.message || result.id || "run error",
        }),
      );
      return;
    }

    process.stdout.write(
      JSON.stringify({
        ok: true,
        text: String(result.result || "好了。").slice(0, 240),
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = err instanceof CursorAgentError ? "start_failed" : "start_failed";
    process.stdout.write(JSON.stringify({ ok: false, kind, message }));
  }
}

void main();
