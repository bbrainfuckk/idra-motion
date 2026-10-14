#!/usr/bin/env node
// Drives mcp/server.mjs the way an MCP client does (stdio JSON-RPC) and checks every tool that needs no
// API key: the handshake, guide, new_scene, preview, stills (with the image), a draft render that
// outlasts its wait and finishes through job_status, soundtrack, stopping a job, prompts, resources,
// and plain-word errors.   node tests/mcp.test.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profiles = () => readdirSync(tmpdir()).filter((n) => /^idra-motion-[A-Za-z0-9]{6}$/.test(n));
const before = new Set(profiles());
const work = mkdtempSync(join(tmpdir(), "idra-motion-mcp-test-"));
const server = spawn(process.execPath, [join(REPO, "mcp", "server.mjs")], { cwd: work, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
server.stderr.on("data", (d) => { stderr += d; });
const pending = new Map(), notes = [];
let stray = 0;
createInterface({ input: server.stdout }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { stray += 1; return; }
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) notes.push(m);
});
let nextId = 0;
const call = (method, params = {}) => new Promise((ok) => { const id = ++nextId; pending.set(id, ok); server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const tool = async (name, args, meta) => (await call("tools/call", { name, arguments: args, ...(meta ? { _meta: meta } : {}) })).result;
const say = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? `: ${detail}` : ""}`); ok ? passed++ : failed++; };

try {
  const discover = await call("server/discover");
  check("unknown method answers an error (so new clients fall back to initialize)", discover.error?.code === -32601);
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  check("initialize echoes the protocol version", init.result?.protocolVersion === "2025-06-18");
  check("initialize has instructions", /stills/.test(init.result?.instructions || ""));
  const odd = await call("initialize", { protocolVersion: "1999-01-01" });
  check("unknown protocol version gets a supported one", odd.result?.protocolVersion === "2025-06-18");
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = (await call("tools/list")).result.tools;
  const names = list.map((t) => t.name);
  check("tools/list has all 11 tools", ["guide", "new_scene", "preview", "stills", "render", "soundtrack", "job_status", "voices", "make_voice", "level_voice", "word_timings"].every((n) => names.includes(n)), names.join(","));
  check("every tool has a description and an object schema", list.every((t) => t.description && t.inputSchema?.type === "object"));

  for (const topic of ["checklist", "method", "narration", "engine", "example", "starter", "prompt"]) {
    const r = await tool("guide", { topic });
    check(`guide ${topic}`, !r.isError && say(r).length > 400);
  }
  check("guide checklist drops the skill frontmatter", !say(await tool("guide", {})).includes("description:"));

  const folder = join(work, "launch");
  const made = await tool("new_scene", { folder, title: "Hello <Test>", duration: 3, width: 1280, height: 720 });
  const scene = join(folder, "scene.html");
  const html = existsSync(scene) ? readFileSync(scene, "utf8") : "";
  check("new_scene writes the scene", !made.isError && /DURATION = 3;/.test(html) && /WIDTH = 1280, HEIGHT = 720/.test(html) && html.includes('const TITLE = "Hello <Test>";') && html.includes("<title>Hello &lt;Test></title>"));
  check("new_scene refuses to overwrite", (await tool("new_scene", { folder })).isError === true);

  const pv = say(await tool("preview", { scene, t: 1 }));
  const url = pv.match(/http:\S+/)?.[0];
  const page = url ? await fetch(url).then((r) => r.text()) : "";
  const engine = url ? await fetch(new URL("/engine/motion.js", url)).then((r) => r.status) : 0;
  check("preview serves the scene and the engine", page.includes("Hello") && engine === 200, pv);

  const st = await tool("stills", { scene, times: [0.2, 1.2, 2.5] });
  const img = st.content.find((c) => c.type === "image");
  check("stills returns the contact sheet as an image", !st.isError && img?.mimeType === "image/jpeg" && img.data.length > 5000, say(st));
  check("stills saves the sheet next to the scene", existsSync(join(folder, "out", "launch-stills.jpg")));

  const quick = await tool("render", { scene, quality: "draft", wait_seconds: 1 }, { progressToken: "p1" });
  const job = say(quick).match(/job "([^"]+)"/)?.[1];
  check("render returns a job id when it outlasts wait_seconds", !!job && !quick.isError, say(quick));
  const done = await tool("job_status", { job, wait_seconds: 120 }, { progressToken: "p2" });
  const mp4 = join(folder, "out", "launch-draft.mp4");
  check("job_status finishes the render", !done.isError && /Video: .*launch-draft\.mp4/.test(say(done)) && existsSync(mp4) && statSync(mp4).size > 20000, say(done));
  check("render sends progress notifications", notes.some((n) => n.method === "notifications/progress"));

  const snd = await tool("soundtrack", { scene, bus: "music" });
  check("soundtrack writes a WAV", !snd.isError && existsSync(join(folder, "out", "launch-music.wav")), say(snd));

  const long = await tool("render", { scene, quality: "master", wait_seconds: 1 });
  const longJob = say(long).match(/job "([^"]+)"/)?.[1];
  const stopped = await tool("job_status", { job: longJob, stop: true });
  check("job_status stop: true stops a render", /Stopped/.test(say(stopped)));
  check("job_status on an unknown job is a plain error", (await tool("job_status", { job: "nope" })).isError === true);
  check("a missing scene is a plain error", /No scene at/.test(say(await tool("stills", { scene: join(work, "missing.html"), times: [1] }))));

  const prompts = (await call("prompts/list")).result.prompts;
  const prompt = (await call("prompts/get", { name: "make_trailer", arguments: { product: "Acme (acme.test)", length: "30 seconds" } })).result;
  check("prompt make_trailer fills in the product", prompts[0]?.name === "make_trailer" && prompt.messages[0].content.text.includes("Acme (acme.test)") && prompt.messages[0].content.text.includes("30 seconds"));
  const resources = (await call("resources/list")).result.resources;
  const res = (await call("resources/read", { uri: "idra-motion://guide/narration" })).result;
  check("resources list and read the guides", resources.length >= 6 && res.contents[0].text.includes("ElevenLabs"));
  check("nothing but JSON-RPC on stdout", stray === 0, `${stray} stray lines`);
  // Leave one render running: closing the connection below must stop it and clean up after it.
  await tool("render", { scene, quality: "master", wait_seconds: 2 });
} catch (e) {
  check("no crash", false, e.stack);
}
// The renderer on its own must remove its browser profile before it exits (no server to clean up after it).
{
  const seen = new Set(profiles());
  const r = spawnSync(process.execPath, [join(REPO, "render.mjs"), join(REPO, "examples", "starter", "scene.html"), join(work, "solo.jpg"), "--stills", "1"], { encoding: "utf8", timeout: 120000 });
  const left = profiles().filter((n) => !seen.has(n) && !before.has(n));
  check("render.mjs alone leaves no browser profile behind", r.status === 0 && left.length === 0, left.join(", ") || r.stderr);
}
server.stdin.end();
await new Promise((ok) => server.on("close", ok));
// A render stopped a moment ago can still be letting go of files in the scratch folder: keep trying.
for (let i = 0; i < 60; i += 1) {
  try { rmSync(work, { recursive: true, force: true }); break; } catch { await new Promise((ok) => setTimeout(ok, 500)); }
}
// A stopped browser can hold its folder for a while; the server's sweeper keeps trying for up to 90 s.
let left = [];
for (let i = 0; i < 45; i += 1) {
  await new Promise((ok) => setTimeout(ok, 1000));
  left = profiles().filter((n) => !before.has(n));
  if (!left.length) break;
}
check("no browser profile folders left behind (including the stopped render)", left.length === 0, left.join(", "));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log("server stderr:\n" + stderr.slice(-2000));
process.exit(failed ? 1 : 0);
