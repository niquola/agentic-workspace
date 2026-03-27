#!/usr/bin/env bun
/**
 * Dev server manager — runs wsmanager + Tailwind CSS watcher
 *
 * Usage:
 *   bun dev          — foreground: server + css watcher
 *   bun dev:css      — rebuild CSS once
 */

import { spawn } from "bun";

const PORT = process.env.PORT || "31337";
const cmd = process.argv[2] ?? "fg";

const buildCss = async () => {
  console.log("[css] Building...");
  const build = spawn({
    cmd: ["bunx", "@tailwindcss/cli", "-i", "ui/tailwind.css", "-o", "public/styles/main.css", "--minify"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await build.exited;
  if (code !== 0) {
    console.error("[css] Build failed");
    process.exit(1);
  }
  console.log("[css] Done");
};

const startForeground = async () => {
  await buildCss();

  console.log(`\n[dev] Starting on http://localhost:${PORT}`);
  console.log("[dev] Tailwind CSS: watching");
  console.log("[dev] Server: --watch mode (auto-restart on changes)");
  console.log("[dev] Press Ctrl+C to stop\n");

  const cssWatcher = spawn({
    cmd: ["bunx", "@tailwindcss/cli", "-i", "ui/tailwind.css", "-o", "public/styles/main.css", "--watch=always"],
    stdout: "inherit",
    stderr: "inherit",
  });

  const server = spawn({
    cmd: ["bun", "--watch", "wsmanager.ts"],
    env: { ...process.env, PORT },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const cleanup = () => {
    cssWatcher.kill();
    server.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await server.exited;
};

switch (cmd) {
  case "fg":
    await startForeground();
    break;
  case "css":
    await buildCss();
    process.exit(0);
    break;
  default:
    console.log("Usage: bun scripts/dev.ts [fg|css]");
    break;
}
