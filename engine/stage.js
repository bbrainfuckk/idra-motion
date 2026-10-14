// idra-motion: turn a scene into something render.mjs can film and a browser can preview.
//
//   film({ width, height, duration, draw, sound, ready })
//     draw(t)          draws the frame at t seconds (pure: same t, same frame)
//     sound(ctx)       optional: builds the soundtrack on an OfflineAudioContext (see sound.js)
//     ready()          optional: anything to wait for before the first frame (images, data)
//
// It sets the four things the renderer looks for: window.VIDEO, window.seek(t), window.buildAudio(ctx)
// and window.READY. Opened in a browser without ?render, the page fits the stage to the window and
// adds a scrubber: drag it, or press Space to play (silent; render --audio to hear the mix).
import { clamp } from "./motion.js";

export function film({ width = 1920, height = 1080, duration, draw, sound = null, ready = null, fonts = [] }) {
  window.VIDEO = { w: width, h: height, duration };
  window.seek = (t) => draw(clamp(Number(t) || 0, 0, duration));
  window.buildAudio = sound ?? (async () => {});
  window.READY = (async () => {
    // Every font weight the picture uses must be loaded before the first frame, or frames differ.
    await Promise.all(fonts.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
    await ready?.();
    draw(0);
    return true;
  })();
  if (!new URLSearchParams(location.search).has("render")) preview(width, height, duration);
}

function preview(width, height, duration) {
  const stage = document.getElementById("stage");
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;padding:10px 14px;background:rgba(0,0,0,.72);color:#fff;font:13px system-ui;z-index:9";
  bar.innerHTML = `<button>Play</button><input type="range" min="0" max="${duration}" step="0.01" value="0" style="flex:1"><span>0.00</span>`;
  document.body.append(bar);
  const [button, scrub, clock] = bar.children;
  const fit = () => { const k = Math.min(innerWidth / width, (innerHeight - 44) / height); stage.style.transformOrigin = "0 0"; stage.style.transform = `scale(${k})`; };
  addEventListener("resize", fit); fit();
  let playing = false, started = 0, base = Number(new URLSearchParams(location.search).get("t")) || 0;
  const show = (t) => { window.seek(t); scrub.value = t; clock.textContent = t.toFixed(2); };
  const toggle = () => { playing = !playing; started = performance.now(); if (!playing) base = Number(scrub.value); button.textContent = playing ? "Pause" : "Play"; };
  button.onclick = toggle;
  addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); toggle(); } });
  scrub.oninput = () => { playing = false; base = Number(scrub.value); button.textContent = "Play"; show(base); };
  (function loop() {
    if (playing) { const t = base + (performance.now() - started) / 1000; if (t >= duration) { playing = false; base = 0; button.textContent = "Play"; } show(Math.min(t, duration)); }
    requestAnimationFrame(loop);
  })();
  window.READY.then(() => show(base));
}
