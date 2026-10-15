#!/usr/bin/env node
// idra-motion MCP server: the renderer, the narration tools and the method, as tools an AI agent can
// call (Claude Code, Claude Desktop, Codex, Cursor and any other MCP client). Stdio, zero dependencies,
// Node 20+.
//
//   node mcp/server.mjs
//
// Rendering can take minutes, longer than some clients wait for one tool call (Codex: 60 s by
// default). So every tool that runs something starts a job, waits up to wait_seconds (default 50),
// and returns either the result or the job id; job_status waits for it again. Nothing else is ever
// written to stdout: logs go to stderr.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const IS_WIN = process.platform === "win32";
const log = (...a) => process.stderr.write(`[idra-motion] ${a.join(" ")}\n`);
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (p) => resolve(process.cwd(), String(p));

// ---------- the method, as text ----------
const read = (p) => readFileSync(join(REPO, p), "utf8");
const GUIDES = {
  checklist: { title: "The working checklist (the skill)", text: () => read("skills/idra-motion/SKILL.md").replace(/^---[\s\S]*?---\s*/, "") },
  method: { title: "How the LetAIApply trailer was made in one shot", text: () => read("docs/one-shot.md") },
  narration: { title: "Narration: ElevenLabs key, TTSWP credits, Whisper timings", text: () => read("docs/narration.md") },
  engine: { title: "The engine API: motion.js, sound.js, stage.js", text: () => ["engine/motion.js", "engine/sound.js", "engine/stage.js"].map((f) => `// ===== ${f} =====\n${read(f)}`).join("\n\n") },
  example: { title: "A finished 10 second scene with sound (examples/hello)", text: () => read("examples/hello/scene.html") },
  starter: { title: "The starter scene new_scene copies (examples/starter)", text: () => read("examples/starter/scene.html") }
};

// The example scenes new_scene can start from.
const STYLES = {
  starter: "examples/starter/scene.html", kinetic: "examples/kinetic/scene.html", "product-demo": "examples/product-demo/scene.html",
  numbers: "examples/numbers/scene.html", vertical: "examples/vertical/scene.html", explainer: "examples/hello/scene.html"
};

const ONE_SHOT =({ product, length = "about 45 seconds", notes = "" }) => `Make a launch trailer for ${product} with idra-motion.

Length ${length}, 16:9 1920 x 1080, with narration. Use the product's own name, logo, colours and font, and only say what the product really does (its own site or store listing is the source).

Follow the idra-motion checklist (guide topic "checklist"; the worked example is topic "method"):
1. Write the beat sheet first: one short narration line per row, and for each line what is SEEN and HEARD. Whatever is said must visibly happen on screen at that moment, and the text on screen is the exact word being said.
2. Narration: make the lines in two or three ElevenLabs voices (make_voice), let me hear them and pick, then level them (level_voice) and time every word (word_timings).
3. Build the scene (new_scene, then edit scene.html): rebuild the product's interface in HTML at full size, with made-up people and companies. Every frame comes from t alone: springs for arrivals, easing for camera moves, typed text, counters, sound effects and music from the same timing tables.
4. Check stills at every beat (stills) and read each frame against the script. Fix and repeat until it is right.
5. Render a draft, then the 60 fps master and a web cut under 10 MB (render), and a poster frame.
${notes ? `\nNotes: ${notes}\n` : ""}
You have full creative freedom.`;

// ---------- finding ffmpeg and Python ----------
function onPath(names) {
  for (const dir of (process.env.PATH || "").split(IS_WIN ? ";" : ":")) {
    for (const name of names) { const f = join(dir, name); if (dir && existsSync(f)) return f; }
  }
  return null;
}
let ffmpegPath;
function ffmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const exe = IS_WIN ? "ffmpeg.exe" : "ffmpeg";
  const tries = [process.env.FFMPEG, onPath([exe])];
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || "";
    tries.push(join(local, "Microsoft", "WinGet", "Links", exe));
    const pkgs = join(local, "Microsoft", "WinGet", "Packages");
    if (existsSync(pkgs)) for (const p of readdirSync(pkgs).filter((d) => /ffmpeg/i.test(d))) {
      for (const sub of readdirSync(join(pkgs, p))) tries.push(join(pkgs, p, sub, "bin", exe));
    }
    tries.push(join(process.env.USERPROFILE || "", "scoop", "shims", exe), "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe", "C:\\ffmpeg\\bin\\ffmpeg.exe");
  } else {
    tries.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "/snap/bin/ffmpeg");
  }
  ffmpegPath = tries.find((f) => f && existsSync(f)) || null;
  return ffmpegPath;
}
let pythonCmd;
function python() {
  if (pythonCmd !== undefined) return pythonCmd;
  const tries = [process.env.IDRA_MOTION_PYTHON, process.env.PYTHON].filter(Boolean).map((c) => [c]);
  tries.push(...(IS_WIN ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]]));
  pythonCmd = tries.find(([cmd, ...pre]) => {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 15000, windowsHide: true });
    return r.status === 0 && r.stdout.trim() === "3";
  }) || null;
  return pythonCmd;
}
const NO_FFMPEG = "ffmpeg wasn't found. Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg, Linux: sudo apt install ffmpeg) or set FFMPEG to its full path in this server's environment.";
const NO_PYTHON = "Python 3 wasn't found. Install it, or set IDRA_MOTION_PYTHON to its full path in this server's environment.";

// ---------- jobs: anything that runs a process ----------
// A stopped browser can hold its profile's files for a few seconds, so removal retries in the
// background and never throws.
function removeLater(dir, tries = 8) {
  setTimeout(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) {
      if (tries === 4) endBrowsers(dir); // still locked: a browser process outlived its renderer
      if (tries > 1) removeLater(dir, tries - 1); else log(`couldn't remove ${dir}: ${e.code}`);
    }
  }, 1500).unref();
}
// End the browser processes of one job, found by its own profile folder's unique name. Stopping the
// renderer's process tree can miss browser processes caught mid-startup, and they keep the folder locked.
function endBrowsers(profile) {
  const name = basename(profile);
  if (!/^idra-motion-[A-Za-z0-9]{6}$/.test(name)) return;
  if (IS_WIN) {
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process -Filter "CommandLine like '%${name}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { windowsHide: true, timeout: 20000 });
  } else spawnSync("pkill", ["-9", "-f", name], { timeout: 10000 });
}
const jobs = new Map();
let jobCount = 0;
// Narration jobs run in the client's folder, so vo.py finds a .env there as well as in the repo.
function start(kind, args, { cwd, finish, python: usePython = false, total } = {}) {
  cwd ??= usePython ? process.cwd() : REPO;
  const tool = usePython ? python() : process.execPath;
  if (!tool) throw new Error(NO_PYTHON);
  const ff = ffmpeg();
  if (!ff) throw new Error(NO_FFMPEG);
  const [cmd, ...pre] = usePython ? tool : [tool];
  const id = `${kind}-${++jobCount}`;
  // The renderer's throwaway browser profile, chosen here so it can be removed even if the job is stopped.
  const profile = usePython ? null : mkdtempSync(join(tmpdir(), "idra-motion-"));
  const job = { id, kind, status: "running", log: "", progress: total ? { done: 0, total } : null, started: Date.now(), ended: 0, finish, result: null, waiters: [], profile };
  const child = spawn(cmd, [...pre, ...args], {
    cwd, windowsHide: true, detached: !IS_WIN,
    env: { ...process.env, FFMPEG: ff, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", ...(profile ? { IDRA_MOTION_PROFILE: profile } : {}) }
  });
  job.child = child;
  log(`${id} started`);
  const take = (chunk) => {
    const text = chunk.toString();
    job.log = (job.log + text).slice(-6000);
    for (const m of text.matchAll(/(\d+)\/(\d+) frames/g)) job.progress = { done: Number(m[1]), total: Number(m[2]) };
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  child.on("error", (e) => { job.log += `\n${e.message}`; });
  child.on("close", async (code) => {
    job.ended = Date.now();
    log(`${id} ended (${job.status === "cancelled" ? "stopped" : `exit ${code}`}, ${secs(job)} s)`);
    if (profile) {
      // A finished render closed its browser itself; a stopped or failed one may still have browser
      // processes writing to the folder, so the sweeper waits until it stays gone.
      if (job.status === "cancelled" || code !== 0) sweepLater([profile]);
      else removeLater(profile);
    }
    if (job.status === "cancelled") return job.waiters.splice(0).forEach((w) => w());
    if (code === 0) {
      try { job.result = finish ? await finish(job) : null; job.status = "done"; } catch (e) { job.status = "failed"; job.log += `\n${e.message}`; }
    } else job.status = "failed";
    job.waiters.splice(0).forEach((w) => w());
  });
  jobs.set(id, job);
  return job;
}
function stop(job) {
  if (job.status !== "running") return;
  job.status = "cancelled";
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(job.child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-job.child.pid, "SIGKILL"); // at once: a browser that shuts down slowly keeps writing to its folder
  } catch {}
  if (job.profile) endBrowsers(job.profile);
}
async function settle(job, seconds, progressToken) {
  const until = Date.now() + Math.max(0, Math.min(3600, Number(seconds ?? 50))) * 1000;
  let last = "";
  while (job.status === "running" && Date.now() < until) {
    await Promise.race([new Promise((ok) => job.waiters.push(ok)), sleep(Math.min(1000, Math.max(0, until - Date.now())))]);
    if (progressToken !== undefined && job.progress) {
      const note = `${job.progress.done}/${job.progress.total}`;
      if (note !== last) {
        last = note;
        send({ method: "notifications/progress", params: { progressToken, progress: job.progress.done, total: job.progress.total, message: `${note} frames` } });
      }
    }
  }
}
const secs = (job) => (((job.ended || Date.now()) - job.started) / 1000).toFixed(0);
const tail = (job) => job.log.split(/[\r\n]+/).filter(Boolean).slice(-12).join("\n");
const text = (t) => ({ type: "text", text: t });
function report(job) {
  if (job.status === "running") {
    const p = job.progress ? `${job.progress.done}/${job.progress.total} frames, ` : "";
    return { content: [text(`Still running (job ${job.id}): ${p}${secs(job)} s so far. Call job_status with job "${job.id}" to wait for it (it keeps running meanwhile).`)] };
  }
  if (job.status === "cancelled") return { content: [text(`Job ${job.id} was stopped.`)] };
  if (job.status === "failed") return { content: [text(`Job ${job.id} failed after ${secs(job)} s:\n${tail(job)}`)], isError: true };
  return job.result;
}

// ---------- scenes ----------
function sceneOf(path) {
  const scene = abs(path);
  if (!existsSync(scene)) throw new Error(`No scene at ${scene}. Make one with new_scene, or pass the full path to its .html file.`);
  return scene;
}
function rootOf(scene, root) {
  if (root) {
    const r = abs(root);
    if (!scene.startsWith(r + sep)) throw new Error(`The scene (${scene}) must be inside root (${r}).`);
    return r;
  }
  return scene.startsWith(REPO + sep) ? REPO : dirname(scene);
}
function outFor(scene, suffix, out) {
  if (out) { const o = abs(out); mkdirSync(dirname(o), { recursive: true }); return o; }
  const name = basename(scene, extname(scene));
  const base = name === "scene" ? basename(dirname(scene)) : name;
  const dir = join(dirname(scene), "out");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${base}-${suffix}`);
}
const mb = (f) => `${(statSync(f).size / 1048576).toFixed(1)} MB`;

// The preview: one local server per root, kept for the life of this process.
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
const previews = new Map();
async function previewServer(root) {
  if (previews.has(root)) return previews.get(root);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const candidates = [join(root, path), ...(/^\/(engine|sfx|fonts)\//.test(path) ? [join(REPO, path)] : [])];
    const file = candidates.find((f) => (f.startsWith(root) || f.startsWith(REPO)) && existsSync(f) && statSync(f).isFile());
    if (!file) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  const port = await new Promise((ok, fail) => {
    const tryPort = (p) => {
      server.once("error", (e) => (e.code === "EADDRINUSE" && p ? tryPort(p === 8749 ? 0 : p + 1) : fail(e)));
      server.listen(p, "127.0.0.1", () => ok(server.address().port));
    };
    tryPort(8740);
  });
  previews.set(root, port);
  return port;
}

// ---------- the tools ----------
const WAIT = { type: "number", description: "Seconds to wait for the result before returning a job id (default 50, max 3600). Keep it under your client's tool timeout." };
const SCENE = { type: "string", description: "Full path to the scene's .html file." };
const ROOT = { type: "string", description: "Optional folder served as / while filming, if the scene loads files from above its own folder. /engine, /sfx and /fonts always resolve to idra-motion's copies." };
const TOOLS = [
  {
    name: "guide",
    title: "Read the idra-motion method",
    description: "Read how to make a video with idra-motion. Start every new video with topic 'checklist'. Topics: checklist (the step-by-step skill), method (how the LetAIApply trailer was made in one shot), narration (ElevenLabs key, TTSWP credits, Whisper timings), engine (the full motion/sound/stage API source), example (a finished 10 s scene), starter (the scene new_scene copies), prompt (a one-shot prompt to start a trailer).",
    inputSchema: { type: "object", properties: { topic: { type: "string", enum: [...Object.keys(GUIDES), "prompt"], description: "Which part to read (default checklist)." } } },
    annotations: { readOnlyHint: true },
    async run({ topic = "checklist" }) {
      if (topic === "prompt") return { content: [text(ONE_SHOT({ product: "<product name and URL>" }))] };
      const g = GUIDES[topic];
      if (!g) throw new Error(`Unknown topic ${topic}.`);
      return { content: [text(`# ${g.title}\n\n${g.text()}`)] };
    }
  },
  {
    name: "new_scene",
    title: "Start a new video scene",
    description: "Create a new scene in <folder>/scene.html from one of the styles, then edit it: beat sheet first, then one time window per beat inside draw(t). Styles: starter (title, typed line, camera drift; any size and length), kinetic (one huge word per beat, hard colour cuts), product-demo (an app rebuilt in HTML: typing, cursor clicks, results, a detail panel), numbers (a stat that rolls up, bars, a trend line, a highlight), vertical (9:16 with word-by-word captions), explainer (the finished 10 s example).",
    inputSchema: {
      type: "object", required: ["folder"],
      properties: {
        folder: { type: "string", description: "Full path of the folder to create the scene in (made if missing)." },
        style: { type: "string", enum: Object.keys(STYLES), description: "Which example to start from (default starter)." },
        title: { type: "string", description: "The scene's title or product name (default 'Your product')." },
        duration: { type: "number", description: "starter only: length in seconds (default 8). The other styles keep their timing tables; change those together." },
        width: { type: "number", description: "starter only: frame width in pixels (default 1920)." },
        height: { type: "number", description: "starter only: frame height (default 1080; for 9:16 use width 1080, height 1920, or the vertical style)." },
        overwrite: { type: "boolean", description: "Replace an existing scene.html (default false)." }
      }
    },
    async run({ folder, style = "starter", title = "Your product", duration = 8, width = 1920, height = 1080, overwrite = false }) {
      const source = STYLES[style];
      if (!source) throw new Error(`Unknown style ${style}. Styles: ${Object.keys(STYLES).join(", ")}.`);
      const dir = abs(folder), file = join(dir, "scene.html");
      if (existsSync(file) && !overwrite) throw new Error(`${file} already exists. Pass overwrite: true to replace it, or edit it.`);
      mkdirSync(dir, { recursive: true });
      const json = (v) => JSON.stringify(String(v));
      let html = read(source).replace(/<title>[^<]*<\/title>/, () => `<title>${String(title).replace(/</g, "&lt;")}</title>`);
      if (style !== "explainer") html = html.replace(/const TITLE = "[^"\n]*";/, () => `const TITLE = ${json(title)};`);
      if (style === "starter") html = html.replace("const WIDTH = 1920, HEIGHT = 1080, DURATION = 8;", () => `const WIDTH = ${Math.round(width)}, HEIGHT = ${Math.round(height)}, DURATION = ${Number(duration)};`);
      writeFileSync(file, html);
      const size = (html.match(/const WIDTH = (\d+), HEIGHT = (\d+), DURATION = ([\d.]+);/) || []).slice(1);
      const what = size.length ? ` (${size[0]} x ${size[1]}, ${size[2]} s)` : "";
      return { content: [text(`Created ${file} from the ${style} style${what}.\nNext: rewrite the beat sheet in its comment for your video, change the tables and text, then check with stills (guide topic 'engine' for the API, 'example' for a finished scene). preview gives a browser link to scrub it.`)] };
    }
  },
  {
    name: "preview",
    title: "Preview a scene in the browser",
    description: "Serve a scene locally and return a link to open in a browser: drag the bar to scrub, Space to play (silent; render soundtrack to hear it). The link stays up while this server runs.",
    inputSchema: { type: "object", required: ["scene"], properties: { scene: SCENE, root: ROOT, t: { type: "number", description: "Open at this second." } } },
    annotations: { readOnlyHint: true },
    async run({ scene, root, t }) {
      const s = sceneOf(scene), r = rootOf(s, root);
      const port = await previewServer(r);
      const url = `http://127.0.0.1:${port}/${relative(r, s).split(sep).join("/")}${t ? `?t=${Number(t)}` : ""}`;
      return { content: [text(`Open ${url}`)] };
    }
  },
  {
    name: "stills",
    title: "See frames of a scene",
    description: "Film single frames at the given seconds into one contact sheet and SHOW it (image). Use a time inside every beat; read every word on screen against the script before rendering. Takes seconds.",
    inputSchema: { type: "object", required: ["scene", "times"], properties: { scene: SCENE, times: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 24, description: "Seconds to film, e.g. [0.9, 3.6, 6.4]." }, out: { type: "string", description: "Where to save the sheet (.jpg). Default: <scene folder>/out/<name>-stills.jpg." }, root: ROOT, wait_seconds: WAIT } },
    async run({ scene, times, out, root, wait_seconds }, progressToken) {
      const s = sceneOf(scene), sheet = outFor(s, "stills.jpg", out);
      const job = start("stills", [join(REPO, "render.mjs"), s, sheet, "--stills", times.map(Number).join(","), "--root", rootOf(s, root)], {
        finish: async () => {
          const small = join(tmpdir(), `idra-motion-${process.pid}-${Date.now()}.jpg`);
          spawnSync(ffmpeg(), ["-v", "error", "-y", "-i", sheet, "-vf", "scale='min(1600,iw)':-2", "-q:v", "4", small], { windowsHide: true });
          const img = readFileSync(existsSync(small) ? small : sheet).toString("base64");
          rmSync(small, { force: true });
          return { content: [text(`Contact sheet of ${times.length} frames at ${times.join(", ")} s (left to right, top to bottom): ${sheet}\nFull-size frames: ${sheet}.frames`), { type: "image", data: img, mimeType: "image/jpeg" }] };
        }
      });
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  },
  {
    name: "render",
    title: "Render the video",
    description: "Render the scene to MP4 with its soundtrack at -16 LUFS. quality: draft (30 fps, quick), master (60 fps with motion blur, slow), web (30 fps, small file for uploads), gif (a silent looping GIF for a README or a chat, 20 fps). Long renders return a job id; call job_status to wait.",
    inputSchema: {
      type: "object", required: ["scene"],
      properties: {
        scene: SCENE,
        quality: { type: "string", enum: ["draft", "master", "web", "gif"], description: "Default draft." },
        width: { type: "number", description: "gif only: width in pixels (default 960; try 400 for a vertical scene)." },
        out: { type: "string", description: "Where to save it (.mp4, or .gif for quality gif). Default: <scene folder>/out/<name>-<quality>.mp4 (.gif)." },
        fps: { type: "number" }, subframes: { type: "number", description: "Motion blur samples per frame." }, crf: { type: "number", description: "Quality, lower is better (15 master, 23 web)." },
        workers: { type: "number", description: "Browser windows filming at once (default 4)." },
        set: { type: "object", additionalProperties: { type: "string" }, description: "Values added to the page URL, e.g. {\"voice\": \"matilda\"}." },
        root: ROOT, wait_seconds: WAIT
      }
    },
    async run({ scene, quality = "draft", out, fps, subframes, crf, workers, width, set = {}, root, wait_seconds }, progressToken) {
      const preset = { draft: { fps: 30, subframes: 1, crf: 18 }, master: { fps: 60, subframes: 4, crf: 15 }, web: { fps: 30, subframes: 2, crf: 23 }, gif: { fps: 20, subframes: 2, crf: 18 } }[quality];
      if (!preset) throw new Error("quality must be draft, master, web or gif.");
      const s = sceneOf(scene), mp4 = outFor(s, `${quality}.${quality === "gif" ? "gif" : "mp4"}`, out);
      const args = [join(REPO, "render.mjs"), s, mp4, "--fps", fps ?? preset.fps, "--subframes", subframes ?? preset.subframes, "--crf", crf ?? preset.crf, "--root", rootOf(s, root)];
      if (workers) args.push("--workers", workers);
      if (quality === "gif") args.push("--width", width ?? 960);
      for (const [k, v] of Object.entries(set)) args.push("--set", `${k}=${v}`);
      const job = start("render", args.map(String), { finish: async (j) => ({ content: [text(`${quality === "gif" ? "GIF" : "Video"}: ${mp4} (${mb(mp4)}, rendered in ${secs(j)} s).\n${tail(j).split("\n").filter((l) => /LUFS|no sound/.test(l)).join("\n")}`)] }) });
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  },
  {
    name: "soundtrack",
    title: "Render the soundtrack only",
    description: "Render just the scene's sound to a WAV (before the final loudness step), to listen to the mix or one bus alone.",
    inputSchema: { type: "object", required: ["scene"], properties: { scene: SCENE, bus: { type: "string", enum: ["vo", "sfx", "music"], description: "Only this bus (default: all)." }, out: { type: "string" }, root: ROOT, wait_seconds: WAIT } },
    async run({ scene, bus, out, root, wait_seconds }, progressToken) {
      const s = sceneOf(scene), wav = outFor(s, `${bus || "mix"}.wav`, out);
      const job = start("soundtrack", [join(REPO, "render.mjs"), s, wav, "--audio", ...(bus ? [bus] : []), "--root", rootOf(s, root)], { finish: async () => ({ content: [text(`Soundtrack: ${wav} (${mb(wav)})`)] }) });
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  },
  {
    name: "job_status",
    title: "Wait for a render",
    description: "Wait for a job that stills, render, soundtrack or the narration tools started, and get its result. stop: true cancels it.",
    inputSchema: { type: "object", required: ["job"], properties: { job: { type: "string" }, stop: { type: "boolean" }, wait_seconds: WAIT } },
    annotations: { readOnlyHint: true },
    async run({ job: id, stop: cancel = false, wait_seconds }, progressToken) {
      const job = jobs.get(id);
      if (!job) throw new Error(`No job ${id}. Jobs: ${[...jobs.keys()].join(", ") || "none"}.`);
      if (cancel) { stop(job); return { content: [text(`Stopped ${id}.`)] }; }
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  },
  {
    name: "voices",
    title: "List ElevenLabs voices",
    description: "List the ElevenLabs voices your key can use, with their ids. Needs ELEVENLABS_API_KEY in this server's environment or in a .env file (guide topic 'narration' explains the key and the free TTSWP credits route).",
    inputSchema: { type: "object", properties: { search: { type: "string", description: "Only voices whose name or labels contain this." } } },
    annotations: { readOnlyHint: true },
    async run({ search, wait_seconds = 50 }) {
      const job = start("voices", [join(REPO, "tools", "vo.py"), "voices", ...(search ? ["--search", search] : [])], { python: true, finish: async (j) => ({ content: [text(j.log.trim() || "No voices matched.")] }) });
      await settle(job, wait_seconds);
      return report(job);
    }
  },
  {
    name: "make_voice",
    title: "Make narration with ElevenLabs",
    description: "Make one MP3 per narration line with an ElevenLabs voice: <folder>/<name>-<id>.mp3. Make the same lines in two or three voices and let the person pick. Lines that already have a file are kept (never paid twice). Needs an ElevenLabs key (see voices).",
    inputSchema: {
      type: "object", required: ["lines", "voice", "folder"],
      properties: {
        lines: { type: "array", items: { type: "object", required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } }, description: "The script, one entry per line. Write names as they should be said." },
        voice: { type: "string", description: "ElevenLabs voice id, e.g. XrExE9yKIg1WjnnlVkGX (Matilda)." },
        name: { type: "string", description: "Short voice name for the file names (default 'voice')." },
        folder: { type: "string", description: "Full path of the folder for the MP3s, e.g. <scene folder>/vo-raw." },
        model: { type: "string", description: "ElevenLabs model id (default eleven_multilingual_v2)." },
        wait_seconds: WAIT
      }
    },
    async run({ lines, voice, name = "voice", folder, model, wait_seconds }, progressToken) {
      const dir = abs(folder);
      mkdirSync(dir, { recursive: true });
      const script = join(dir, `${name}-lines.json`);
      writeFileSync(script, JSON.stringify(lines.map(({ id, text: t }) => ({ id: String(id), text: String(t) })), null, 1));
      const job = start("make_voice", [join(REPO, "tools", "vo.py"), "make", script, "--voice", voice, "--name", name, "--out", dir, ...(model ? ["--model", model] : [])], {
        python: true, finish: async (j) => ({ content: [text(`${tail(j)}\nNext: level_voice on ${dir}, then word_timings.`)] })
      });
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  },
  {
    name: "level_voice",
    title: "Level narration loudness",
    description: "Bring every narration file in a folder to the same loudness (-19 LUFS, 48 kHz mono WAV) and report each line's length. Works on MP3s from make_voice or from TTSWP.",
    inputSchema: { type: "object", required: ["folder"], properties: { folder: { type: "string", description: "Full path of the folder with the raw MP3s." }, out: { type: "string", description: "Folder for the WAVs (default: a 'vo' folder next to it)." }, wait_seconds: WAIT } },
    async run({ folder, out, wait_seconds }, progressToken) {
      const dir = abs(folder), dest = out ? abs(out) : join(dirname(dir), "vo");
      const job = start("level_voice", [join(REPO, "tools", "vo.py"), "level", dir, "--out", dest], { python: true, finish: async () => ({ content: [text(`Levelled into ${dest}:\n${readFileSync(join(dest, "info.json"), "utf8")}`)] }) });
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  },
  {
    name: "word_timings",
    title: "Time every word (Whisper)",
    description: "Listen to the narration files with Whisper (faster-whisper, runs locally, no key) and return when every word starts. Time the picture to these: the word on screen lands when it is said. Whisper only times; it may mishear names, the times are still right. The first run downloads the model.",
    inputSchema: { type: "object", required: ["folder"], properties: { folder: { type: "string", description: "Full path of the folder with the narration files." }, model: { type: "string", description: "Whisper model (default large-v3-turbo)." }, language: { type: "string", description: "Default en." }, wait_seconds: WAIT } },
    async run({ folder, model, language, wait_seconds }, progressToken) {
      const dir = abs(folder);
      const job = start("word_timings", [join(REPO, "tools", "vo.py"), "words", dir, ...(model ? ["--model", model] : []), ...(language ? ["--language", language] : [])], {
        python: true,
        finish: async () => {
          const words = JSON.parse(readFileSync(join(dir, "words.json"), "utf8"));
          const lines = Object.entries(words).map(([file, ws]) => `${file}: ${ws.map(([w, a]) => `${w}@${a.toFixed(2)}`).join(" ")}`);
          return { content: [text(`Word start times in seconds (full start and end in ${join(dir, "words.json")}):\n${lines.join("\n")}`)] };
        }
      });
      await settle(job, wait_seconds, progressToken);
      return report(job);
    }
  }
];

// ---------- resources and prompts: the same method for clients that use them ----------
const RESOURCES = Object.entries(GUIDES).map(([key, g]) => ({ uri: `idra-motion://guide/${key}`, name: key, title: g.title, mimeType: key === "example" || key === "starter" ? "text/html" : "text/markdown" }));
const PROMPTS = [{
  name: "make_trailer",
  title: "Make a trailer in one shot",
  description: "The one-shot prompt behind the LetAIApply trailer, for your product.",
  arguments: [
    { name: "product", description: "The product's name and its site or store link.", required: true },
    { name: "length", description: "How long, e.g. 45 seconds.", required: false },
    { name: "notes", description: "Anything else: look, voice, what to highlight.", required: false }
  ]
}];

// ---------- JSON-RPC over stdio ----------
const METHODS = {
  initialize: ({ protocolVersion }) => ({
    protocolVersion: PROTOCOLS.includes(protocolVersion) ? protocolVersion : PROTOCOLS[1],
    capabilities: { tools: {}, resources: {}, prompts: {} },
    serverInfo: { name: "idra-motion", title: "idra-motion", version: VERSION },
    instructions: "idra-motion makes motion graphics videos (trailers, launch videos, explainers) from code: a scene is one HTML page whose every frame is a pure function of time. Before a new video, read guide (topic checklist). Loop: new_scene, edit scene.html, stills to see the frames, fix, then render. Narration: voices, make_voice, level_voice, word_timings. Slow tools return a job id after wait_seconds; call job_status to wait."
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: TOOLS.map(({ run, ...t }) => t) }),
  "tools/call": async ({ name, arguments: args = {}, _meta }) => {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
    try { return await tool.run(args, _meta?.progressToken); } catch (e) { return { content: [text(e.message)], isError: true }; }
  },
  "resources/list": () => ({ resources: RESOURCES }),
  "resources/read": ({ uri }) => {
    const key = String(uri).replace("idra-motion://guide/", "");
    const r = RESOURCES.find((x) => x.name === key);
    if (!r) throw Object.assign(new Error(`Unknown resource ${uri}`), { code: -32002 });
    return { contents: [{ uri, mimeType: r.mimeType, text: GUIDES[key].text() }] };
  },
  "resources/templates/list": () => ({ resourceTemplates: [] }),
  "prompts/list": () => ({ prompts: PROMPTS }),
  "prompts/get": ({ name, arguments: a = {} }) => {
    if (name !== "make_trailer") throw Object.assign(new Error(`Unknown prompt ${name}`), { code: -32602 });
    return { description: PROMPTS[0].description, messages: [{ role: "user", content: text(ONE_SHOT(a)) }] };
  }
};

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "Parse error" } }); }
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return; // a notification (initialized, cancelled, ...) or a response: nothing to answer
  const handler = METHODS[method];
  if (!handler) return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  try { send({ id, result: await handler(params) }); } catch (e) { send({ id, error: { code: e.code ?? -32603, message: e.message } }); }
}).on("close", () => {
  // The client went away: stop anything still running, then hand every browser profile that may still
  // exist, or come back, to the detached sweeper. A browser caught mid-start can write its folder again
  // after it was deleted, so the sweeper only finishes once each folder has stayed gone.
  const running = [...jobs.values()].filter((j) => j.status === "running");
  running.forEach(stop);
  const dirs = [...jobs.values()].filter((j) => j.profile && (running.includes(j) || j.status === "cancelled" || existsSync(j.profile))).map((j) => j.profile);
  if (dirs.length) sweepLater(dirs);
  process.exit(0);
});
// Hands folders to mcp/sweep.mjs, which keeps at them after this process exits.
function sweepLater(dirs) {
  spawn(process.execPath, [join(REPO, "mcp", "sweep.mjs")], {
    detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, IDRA_MOTION_SWEEP: JSON.stringify(dirs) }
  }).unref();
}
// One bad moment must not take the server (and the client's tools) down with it.
process.on("uncaughtException", (e) => log("error:", e.stack || e.message));
process.on("unhandledRejection", (e) => log("error:", e?.stack || String(e)));
log(`ready (v${VERSION}, ${REPO})`);
