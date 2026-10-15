#!/usr/bin/env node
// Removes browser profile folders the MCP server made, once nothing is using them. The server starts
// it, detached, for a render that was stopped or interrupted: a browser caught shutting down (or still
// starting) can write into its folder again after it was deleted, so a folder only counts as gone once
// it has stayed gone for five seconds in a row.
//   IDRA_MOTION_SWEEP='["<folder>", ...]' node mcp/sweep.mjs
// The folders come in the environment, not the command line, because this ends every process whose
// command line names one of them, and it must never match itself.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";

let list = [];
try { list = JSON.parse(process.env.IDRA_MOTION_SWEEP || "[]"); } catch {}
// Only ever touch the server's own throwaway folders.
const dirs = list.filter((d) => typeof d === "string" && /^idra-motion-[A-Za-z0-9]{6}$/.test(basename(d)));

// End any other process whose command line names this folder: the name is unique to one render.
function endBrowsers(dir) {
  const name = basename(dir);
  if (process.platform === "win32") {
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process -Filter "CommandLine like '%${name}%'" | Where-Object { $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { windowsHide: true, timeout: 20000 });
    return;
  }
  const found = spawnSync("pgrep", ["-f", name], { encoding: "utf8", timeout: 10000 }).stdout || "";
  for (const pid of found.split(/\s+/).map(Number).filter((p) => p && p !== process.pid)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

let quiet = 0;
for (let i = 0; i < 120 && quiet < 5; i += 1) {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    endBrowsers(dir);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  quiet = dirs.every((d) => !existsSync(d)) ? quiet + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}
