const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

async function main() {
  fs.mkdirSync("dist/renderer", { recursive: true });
  fs.mkdirSync("dist/assets", { recursive: true });

  await esbuild.build({
    entryPoints: ["src/main/main.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist/main/main.js",
    external: ["electron", "@cursor/sdk"],
    sourcemap: true,
  });

  await esbuild.build({
    entryPoints: ["src/main/agent-worker.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    outfile: "dist/main/agent-worker.js",
    external: ["@cursor/sdk"],
    sourcemap: true,
  });

  await esbuild.build({
    entryPoints: ["src/main/preload.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist/main/preload.js",
    external: ["electron"],
    sourcemap: true,
  });

  await esbuild.build({
    entryPoints: ["src/renderer/main.ts"],
    bundle: true,
    platform: "browser",
    target: "es2022",
    outfile: "dist/renderer/game.js",
    sourcemap: true,
    loader: { ".png": "dataurl", ".json": "json" },
  });

  copy("src/renderer/index.html", "dist/renderer/index.html");
  copy("src/renderer/styles.css", "dist/renderer/styles.css");
  if (fs.existsSync("assets")) {
    copy("assets", "dist/assets");
  }
  if (fs.existsSync("tools")) {
    copy("tools", "dist/tools");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
