#!/usr/bin/env node
// The sound effect kit, made from nothing: noise, sine waves, filters and envelopes, all seeded so
// every run makes the same files. Writes sfx/<name>.ogg (48 kHz Vorbis) with ffmpeg.
//   node tools/make-sfx.mjs [--out sfx] [--wav]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const OUT = resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(REPO, "sfx"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const RATE = 48000;
const TAU = Math.PI * 2;

// ---------- building blocks ----------
const noise = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
  return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1;
};
// A biquad (RBJ cookbook) whose frequency can move every sample.
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, freq, q = 0.707) => {
    const w = (TAU * Math.min(freq, RATE * 0.45)) / RATE, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "band") { b0 = alpha; b1 = 0; b2 = -alpha; }
    else if (type === "low") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
    else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
// A sine whose pitch can glide: keeps its own phase so sweeps stay smooth.
function osc() {
  let phase = 0;
  return (freq) => { phase += (TAU * freq) / RATE; return Math.sin(phase); };
}
const glide = (a, b, k) => a * Math.pow(b / a, Math.min(1, Math.max(0, k))); // exponential, like pitch
const decay = (t, tau) => Math.exp(-t / tau);
const fadeIn = (t, len) => Math.min(1, t / len);

function render(seconds, channels, voice) {
  const n = Math.round(seconds * RATE), chans = Array.from({ length: channels }, () => new Float32Array(n));
  for (let c = 0; c < channels; c += 1) {
    const sample = voice(c);
    for (let i = 0; i < n; i += 1) chans[c][i] = sample(i / RATE, seconds);
  }
  return chans;
}
function normalise(chans, peakDb) {
  // Tiny fades so no sound starts or stops with a click of its own: 0.25 ms in (keeps attacks sharp),
  // 2 ms out.
  const fin = Math.round(0.00025 * RATE), fout = Math.round(0.002 * RATE);
  for (const ch of chans) {
    for (let i = 0; i < fin; i += 1) ch[i] *= i / fin;
    for (let i = 0; i < fout; i += 1) ch[ch.length - 1 - i] *= i / fout;
  }
  let peak = 0;
  for (const ch of chans) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const gain = Math.pow(10, peakDb / 20) / (peak || 1);
  for (const ch of chans) for (let i = 0; i < ch.length; i += 1) ch[i] *= gain;
  return chans;
}

// ---------- the kit ----------
const KIT = {
  // A key or a scrubber detent: a 20 ms bright tick.
  tick: { seconds: 0.02, channels: 1, peak: -0.1, voice: () => {
    const n = noise(3), hp = biquad("high"), s = osc();
    return (t) => hp(n(), 2500) * decay(t, 0.0012) * 0.8 + s(5600) * decay(t, 0.0025) * 0.6;
  } },
  // A mouse or button click: a crisp press, then a quieter release 55 ms later, slightly different in
  // each ear. No ringing tone, so it reads as a click, not a beep.
  click: { seconds: 0.092, channels: 2, peak: -3.1, voice: (c) => {
    const n = noise(11 + c), low = biquad("band"), delay = c ? 0.00015 : 0;
    // Each snap has its own filter and tone, so the press and the release never share state.
    const snap = (level) => {
      const bp = biquad("band"), body = osc();
      return (u) => (u < 0 ? 0 : (bp(n(), 3800, 1.1) * decay(u, 0.0011) * 1.3 + body(2100) * decay(u, 0.0016) * 0.5) * level);
    };
    const press = snap(1), release = snap(0.45);
    return (t) => {
      const u = t - delay;
      return press(u) + release(u - 0.055) + low(n(), 900, 0.8) * (u < 0 ? 0 : decay(u, 0.004)) * 0.35;
    };
  } },
  // Something arriving: a round pop whose pitch drops fast.
  pop: { seconds: 0.116, channels: 1, peak: 0, voice: () => {
    const s = osc(), h = osc();
    return (t) => {
      const f = glide(1150, 270, t / 0.045), env = fadeIn(t, 0.0012) * decay(t, 0.017);
      return (s(f) + 0.22 * h(f * 2)) * env;
    };
  } },
  // A landing: a deep thump with a short crack on top, pushed into soft saturation for weight.
  impact: { seconds: 0.273, channels: 1, peak: 0, voice: () => {
    const s = osc(), sub = osc(), n = noise(23), lp = biquad("low"), crack = biquad("band");
    return (t) => {
      const f = glide(160, 44, t / 0.12);
      const thump = (s(f) * 0.9 + sub(f / 2) * 0.35) * fadeIn(t, 0.002) * decay(t, 0.075);
      const grit = lp(n(), glide(2400, 300, t / 0.15)) * decay(t, 0.03) * 0.9;
      const snap = crack(n(), 1800, 0.9) * decay(t, 0.006) * 1.4;
      return Math.tanh(1.5 * (thump + grit + snap));
    };
  } },
  // Tension before a reveal: filtered noise and a tone that both climb for two seconds.
  riser: { seconds: 2.014, channels: 1, peak: -0.6, voice: () => {
    const n = noise(31), bp = biquad("band"), bp2 = biquad("band"), s = osc(), s2 = osc();
    return (t, T) => {
      const k = t / T, swell = Math.pow(k, 1.15) * (1 - Math.pow(Math.max(0, (t - (T - 0.03)) / 0.03), 2));
      const air = (bp(n(), glide(280, 6200, k), 2.2) + 0.6 * bp2(n(), glide(560, 9000, k), 4)) * 1.6;
      const tone = (s(glide(170, 1350, k) * (1 + 0.004 * Math.sin(TAU * 5.5 * t))) + 0.35 * s2(glide(255, 2025, k))) * 0.32;
      return (air + tone) * swell;
    };
  } },
  // A cut or a fly-in: air that rises then falls in pitch while it moves across the stereo field, with
  // a low body under it so it has weight rather than hiss.
  whoosh: { seconds: 0.426, channels: 2, peak: -3.1, voice: (c) => {
    const n = noise(41 + c * 7), bp = biquad("band"), lp = biquad("low"), lp2 = biquad("low");
    return (t, T) => {
      const k = t / T, peakAt = 0.42;
      const swell = k < peakAt ? Math.sin((k / peakAt) * Math.PI / 2) ** 2 : Math.cos(((k - peakAt) / (1 - peakAt)) * Math.PI / 2) ** 1.6;
      const centre = k < peakAt ? glide(260, 1300, k / peakAt) : glide(1300, 340, (k - peakAt) / (1 - peakAt));
      const pan = c ? 0.35 + 0.65 * k : 1 - 0.65 * k; // left to right
      const x = n();
      return (bp(x, centre, 1.1) * 1.3 + lp(x, centre * 0.6) * 0.9 + lp2(x, 220) * 0.5) * swell * pan;
    };
  } }
};

mkdirSync(OUT, { recursive: true });
for (const [name, def] of Object.entries(KIT)) {
  const chans = normalise(render(def.seconds, def.channels, def.voice), def.peak);
  const frames = chans[0].length, interleaved = new Float32Array(frames * def.channels);
  for (let i = 0; i < frames; i += 1) for (let c = 0; c < def.channels; c += 1) interleaved[i * def.channels + c] = chans[c][i];
  const raw = Buffer.from(interleaved.buffer);
  const out = join(OUT, `${name}.${argv.includes("--wav") ? "wav" : "ogg"}`);
  const codec = argv.includes("--wav") ? ["-c:a", "pcm_s16le"] : ["-c:a", "libvorbis", "-q:a", "6"];
  const r = spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", String(def.channels), "-i", "-", ...codec, "-map_metadata", "-1", out], { input: raw });
  if (r.status !== 0) { console.error(`${name}: ffmpeg failed\n${r.stderr}`); process.exit(1); }
  console.log(`${name} -> ${out} (${def.seconds} s, ${def.channels === 2 ? "stereo" : "mono"})`);
}
