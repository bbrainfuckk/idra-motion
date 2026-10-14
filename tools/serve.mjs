#!/usr/bin/env node
// Preview server: serves this repo so a scene can be opened, scrubbed and played in a browser.
//   node tools/serve.mjs [port]   then open http://127.0.0.1:<port>/examples/hello/scene.html
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
const port = Number(process.argv[2]) || 8740;
createServer((req, res) => {
  const file = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`idra-motion preview: http://127.0.0.1:${port}/examples/hello/scene.html  (Space plays, the bar scrubs)`));
