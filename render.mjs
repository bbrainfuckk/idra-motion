#!/usr/bin/env node
// idra-motion renderer: films a seek(t) page with headless Chrome or Edge over DevTools, and ffmpeg.
//
//   node render.mjs <scene.html> <out.mp4> [--fps 30] [--workers 4] [--subframes 1] [--crf 15] [--lufs -16]
//   node render.mjs <scene.html> <sheet.jpg> --stills 0.5,2.1,4.8     contact sheet (frames kept in <sheet>.frames/)
//   node render.mjs <scene.html> <mix.wav> --audio [vo|sfx|music]     the soundtrack only, before loudness
//   node render.mjs <scene.html> <clip.gif> --fps 20 [--width 960]     a looping GIF, no sound (READMEs, chats)
//
//   --root <dir>         folder served at / (default: this repo). /engine, /sfx and /fonts always resolve
//                        to this repo's copies when the root doesn't have its own.
//   --set key=value      added to the page URL, e.g. --set voice=matilda (repeatable)
//   --browser <path>     Chrome or Edge, if it isn't found (or set BROWSER). FFMPEG=<path> if ffmpeg isn't on PATH.
//
// Zero dependencies (Node 20+). The page must set window.VIDEO, window.seek(t), window.READY and
// optionally window.buildAudio(ctx); engine/stage.js does that for you.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, createReadStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flags = { fps: "30", workers: "4", subframes: "1", crf: "15", lufs: "-16" };
const sets = [];
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--set") sets.push(argv[++i]);
  else if (a === "--audio") flags.audio = ["vo", "sfx", "music"].includes(argv[i + 1]) ? argv[++i] : "all";
  else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
  else positional.push(a);
}
const [sceneArg, out] = positional;
if (!sceneArg || !out) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(1);
}
const ROOT = resolve(flags.root ?? HERE);
const scene = resolve(sceneArg);
if (!scene.startsWith(ROOT + sep)) { console.error(`The scene must be inside the served folder (${ROOT}); pass --root.`); process.exit(1); }
const run = (args) => new Promise((ok, fail) => { const p = spawn(FFMPEG, args, { stdio: "inherit" }); p.on("error", fail); p.on("close", (code) => (code ? fail(new Error(`ffmpeg exited ${code}`)) : ok())); });

// ---------- the files the page needs, served locally ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const candidates = [join(ROOT, path), ...(/^\/(engine|sfx|fonts)\//.test(path) ? [join(HERE, path)] : [])];
  const file = candidates.find((f) => (f.startsWith(ROOT) || f.startsWith(HERE)) && existsSync(f) && statSync(f).isFile());
  if (!file) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const query = new URLSearchParams([["render", ""], ...sets.map((s) => s.split(/=(.*)/s).slice(0, 2)), ...(flags.audio && flags.audio !== "all" ? [["solo", flags.audio]] : [])]);
const url = `http://127.0.0.1:${server.address().port}/${relative(ROOT, scene).split(sep).join("/")}?${query}`;

// ---------- the browser ----------
function findBrowser() {
  if (flags.browser || process.env.BROWSER) return flags.browser || process.env.BROWSER;
  const pf = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const known = [
    ...pf.flatMap((p) => [join(p, "Microsoft/Edge/Application/msedge.exe"), join(p, "Google/Chrome/Application/chrome.exe")]),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];
  const hit = known.find(existsSync);
  if (hit) return hit;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch {}
  }
  throw new Error("No Chrome or Edge found: pass --browser <path> or set BROWSER.");
}
// A throwaway browser profile. IDRA_MOTION_PROFILE lets a caller (the MCP server) pick it, so it can
// clean it up even if it has to stop this process.
const profile = process.env.IDRA_MOTION_PROFILE || mkdtempSync(join(tmpdir(), "idra-motion-"));
mkdirSync(profile, { recursive: true });
const browser = spawn(findBrowser(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-sync", "--hide-scrollbars",
  "--force-device-scale-factor=1", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 160 && !wsUrl; i += 1) { await sleep(150); try { const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split(/\s+/); wsUrl = `ws://127.0.0.1:${port}${path}`; } catch {} }
if (!wsUrl) { console.error("The browser didn't start."); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { const { ok, fail } = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(msg.error.message)) : ok(msg.result); } };
const cdp = (method, params = {}, sessionId) => new Promise((ok, fail) => { const id = ++nextId; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

async function openPage(size = { w: 1920, h: 1080 }) {
  // Each page gets its own browser context and window: a background tab in headless Chrome stops
  // painting, and its screenshots never come back.
  const { browserContextId } = await cdp("Target.createBrowserContext");
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank", browserContextId, newWindow: true });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp("Page.enable", {}, sessionId);
  await cdp("Page.navigate", { url }, sessionId);
  for (let i = 0; i < 300; i += 1) { await sleep(100); if (await evaluate("typeof window.seek === 'function' && Boolean(window.READY)").catch(() => false)) break; }
  await evaluate("window.READY");
  const video = await evaluate("window.VIDEO");
  if (video.w !== size.w || video.h !== size.h) await cdp("Emulation.setDeviceMetricsOverride", { width: video.w, height: video.h, deviceScaleFactor: 1, mobile: false }, sessionId);
  const unloaded = await evaluate("[...document.fonts].filter((f) => f.status !== 'loaded').map((f) => f.family + ' ' + f.weight).join(', ')");
  if (unloaded) console.warn("warning: fonts not loaded (frames may differ):", unloaded);
  const shot = async (t, quality = 94) => {
    await evaluate(`window.seek(${t}), 1`);
    const frame = await Promise.race([cdp("Page.captureScreenshot", { format: "jpeg", quality }, sessionId), sleep(20_000).then(() => null)]);
    if (!frame) throw new Error(`the frame at ${t.toFixed(3)} s wasn't painted within 20 s`);
    return Buffer.from(frame.data, "base64");
  };
  return { evaluate, shot, video };
}
// Ask the browser to close itself, so all of its helper processes shut down with it, then delete its
// profile. Killing it instead leaves helpers holding the profile's files for a few seconds.
const finish = async (code = 0) => {
  const exited = browser.exitCode !== null ? Promise.resolve() : new Promise((ok) => browser.once("exit", ok));
  try { await Promise.race([cdp("Browser.close"), sleep(2000)]); } catch {}
  await Promise.race([exited, sleep(5000)]);
  try { ws.close(); } catch {}
  if (browser.exitCode === null) browser.kill();
  server.close();
  for (let i = 0; i < 40; i += 1) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(250); }
  }
  process.exit(code);
};

// The soundtrack, rendered by the page on an OfflineAudioContext: 48 kHz stereo, 16-bit PCM.
async function soundtrack(page, duration) {
  const b64 = await page.evaluate(`(async () => {
    const sr = 48000, ctx = new OfflineAudioContext(2, Math.ceil(sr * ${duration}), sr);
    await window.buildAudio(ctx);
    const b = await ctx.startRendering(), L = b.getChannelData(0), R = b.getChannelData(1);
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
    const u8 = new Uint8Array(pcm.buffer); let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  return Buffer.from(b64, "base64");
}

try {
  const first = await openPage();
  const V = first.video;
  mkdirSync(dirname(resolve(out)), { recursive: true });

  if (flags.stills) {
    const times = flags.stills.split(",").map(Number), dir = out + ".frames";
    // Start from an empty folder: frames left by an earlier, longer run would end up in the sheet.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < times.length; i += 1) writeFileSync(join(dir, `${String(i).padStart(3, "0")}.jpg`), await first.shot(times[i], 90));
    const cols = Math.min(3, times.length), rows = Math.ceil(times.length / cols);
    await run(["-v", "error", "-y", "-framerate", "1", "-i", join(dir, "%03d.jpg"), "-vf", `scale=960:-1,tile=${cols}x${rows}:padding=6:color=gray`, "-frames:v", "1", out]);
    console.log(`stills -> ${out}  (${times.length} frames in ${dir})`);
    await finish();
  }
  if (flags.audio) {
    const pcm = out + ".pcm";
    writeFileSync(pcm, await soundtrack(first, V.duration));
    await run(["-v", "error", "-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", pcm, out]);
    rmSync(pcm);
    console.log("audio ->", out);
    await finish();
  }

  const fps = Number(flags.fps), workers = Math.max(1, Number(flags.workers)), sub = Math.max(1, Number(flags.subframes)), N = Math.round(V.duration * fps);
  const gif = /\.gif$/i.test(out);
  const base = out.replace(/\.(mp4|gif)$/i, ""), silent = `${base}_silent.mp4`;
  // Motion blur: sub-frames spread over half a frame (a 180 degree shutter), averaged into one.
  const blur = sub > 1 ? ["-vf", `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/(${fps}*TB)`] : [];
  const started = Date.now();
  let done = 0;
  const per = Math.ceil(N / workers), parts = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const from = w * per, to = Math.min(N, from + per);
    if (from >= to) return;
    const part = `${base}_part${w}.mp4`;
    parts[w] = part;
    const page = w === 0 ? first : await openPage({ w: V.w, h: V.h });
    // Windows ffmpeg has no glob input: frames are piped in as JPEGs.
    const ff = spawn(FFMPEG, ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps * sub), "-i", "-", ...blur, "-r", String(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", flags.crf, "-preset", "medium", part], { stdio: ["pipe", "inherit", "inherit"] });
    const closed = new Promise((r) => ff.on("close", r));
    for (let f = from; f < to; f += 1) {
      for (let s = 0; s < sub; s += 1) {
        const jpg = await page.shot((f + (sub > 1 ? (s / sub) * 0.5 : 0)) / fps);
        if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
      }
      if (++done % 30 === 0) process.stdout.write(`\r${done}/${N} frames  ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
  }));
  const list = `${base}_parts.txt`;
  writeFileSync(list, parts.filter(Boolean).map((p) => `file '${resolve(p).replace(/\\/g, "/")}'`).join("\n"));
  await run(["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  parts.filter(Boolean).forEach((p) => rmSync(p));
  rmSync(list);
  console.log(`\npicture -> ${silent}  (${((Date.now() - started) / 1000).toFixed(0)} s)`);

  // A GIF: no sound, one palette built from the whole clip, ordered dithering so flat colours stay flat.
  if (gif) {
    const width = Math.round(Number(flags.width || 960));
    await run(["-v", "error", "-y", "-i", silent, "-vf",
      `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      "-loop", "0", out]);
    rmSync(silent);
    console.log(`gif -> ${out}  (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
    await finish();
  }

  // Sound: measure the page's mix, move it to the target loudness with one fixed gain (no pumping),
  // and catch any peak above -2 dBFS with a limiter.
  const pcm = `${base}.pcm`;
  writeFileSync(pcm, await soundtrack(first, V.duration));
  const raw = ["-f", "s16le", "-ar", "48000", "-ac", "2", "-i", pcm];
  const loudness = (input) => new Promise((ok) => {
    let log = "";
    const p = spawn(FFMPEG, ["-nostats", ...input, "-af", "ebur128", "-f", "null", "-"]);
    p.stderr.on("data", (d) => { log += d; });
    p.on("close", () => ok(Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf("Summary")))?.[1])));
  });
  const measured = await loudness(raw);
  const target = Number(flags.lufs);
  const silentMix = !Number.isFinite(measured) || measured < -70;
  // Up to 24 dB either way: a sparse mix with no narration can sit 14 dB under the target, and the
  // limiter catches whatever peaks the gain pushes past -2 dBFS.
  let gain = silentMix ? 0 : Math.max(-24, Math.min(24, target - measured));
  console.log(silentMix ? "no sound in the mix" : `mix ${measured} LUFS -> ${target} LUFS (gain ${gain.toFixed(1)} dB)`);
  const mux = () => run(["-v", "error", "-y", "-i", silent, ...raw, "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.794:level=false:attack=3:release=60`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out]);
  await mux();
  // The limiter can take a little loudness off: measure the finished file and correct once.
  if (!silentMix) {
    const final = await loudness(["-i", out]);
    if (Number.isFinite(final) && Math.abs(target - final) > 0.5) {
      gain = Math.max(-24, Math.min(24, gain + target - final));
      await mux();
      console.log(`final ${final} LUFS, corrected (gain ${gain.toFixed(1)} dB)`);
    }
  }
  rmSync(pcm);
  rmSync(silent);
  console.log("video ->", out);
  await finish();
} catch (error) {
  console.error("render failed:", error.message);
  await finish(1);
}
