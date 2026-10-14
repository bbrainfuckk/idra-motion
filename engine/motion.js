// idra-motion: everything on screen is a pure function of time.
//
// These helpers turn a time t (seconds) into positions, sizes, opacities and text. No state, no
// timers, no CSS transitions or animations: any frame can be drawn in any order, by any number of
// render workers, and comes out the same every time.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
// How far t is through [a, b], from 0 to 1.
export const seg = (t, a, b) => clamp((t - a) / (b - a));

// Easing curves for anything that should feel designed rather than physical (camera moves, wipes).
export const ease = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeIn = (x) => Math.pow(clamp(x), 3);

// A damped spring from 0 to 1, t seconds after it starts: things that arrive (cards, words, logos)
// overshoot a touch and settle. w = stiffness, z = damping (1 = no overshoot).
export function spring(t, w = 14, z = 0.82) {
  if (t <= 0) return 0;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// A value that springs to a new target at each key: track(1, [[3.7, 0.64], [5.1, 0.31, 15, 0.86]]).
// Keys are [time, value, stiffness?, damping?]. Good for a camera that pulls back in steps.
export const track = (v0, keys) => (t) => {
  let v = v0, previous = v0;
  for (const [at, value, w, z] of keys) { v += (value - previous) * spring(t - at, w, z); previous = value; }
  return v;
};

// Keyframes with easing between them: kf([[0, 1.6], [1.2, 1.6], [1.7, 1.0, easeOut]]).
export const kf = (keys) => (t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [a, va] = keys[i - 1], [b, vb, curve = ease] = keys[i];
    if (t <= b) return lerp(va, vb, curve((t - a) / (b - a)));
  }
  return keys[keys.length - 1][1];
};

// Seeded random numbers (mulberry32): the same "random" layout on every frame and every worker.
export const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

// ---------- DOM ----------
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Opacity that also hides the element when it's gone (cheaper to paint, and never catches a click).
export const vis = (el, opacity) => { el.style.visibility = opacity > 0.002 ? "visible" : "hidden"; el.style.opacity = opacity; };
// Move, scale and turn an element.
export const tf = (el, x, y, scale = 1, rotate = 0) => { el.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotate}deg)`; };
// A camera: put the point (cx, cy) of a full-frame layer at the centre of the frame, zoomed by s.
// The layer needs transform-origin: 0 0.
export const cam = (el, cx, cy, s, width = 1920, height = 1080) => {
  el.style.transform = `translate(${width / 2 - cx * s}px, ${height / 2 - cy * s}px) scale(${s})`;
};

// Typed text: t0 is when typing starts, cps the speed. Shows a caret only while typing.
// Returns how many characters are visible (handy for sound cues and "field is active" states).
export function typed(el, full, t, t0, cps = 60) {
  const n = Math.floor(clamp((t - t0) * cps, 0, full.length));
  const busy = t >= t0 && n < full.length;
  el.innerHTML = esc(full.slice(0, n)) + (busy ? '<i class="caret"></i>' : "");
  return n;
}

// One span per letter, for per-letter springs.
export const letters = (text) => [...text].map((c) => `<span style="display:inline-block">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("");

// A count that rolls from a to b between t0 and t1 (frame counters, "Submitted 3").
export const count = (t, t0, t1, a, b) => Math.round(lerp(a, b, easeOut(seg(t, t0, t1))));
