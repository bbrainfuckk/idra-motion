// idra-motion: the soundtrack is built by the page itself.
//
// render.mjs hands the page an OfflineAudioContext and calls window.buildAudio(ctx). The page plays
// narration, sound effects and synthesised music at times taken from the same tables that drive the
// picture, so every sound lands on its frame. Three buses: narration leads, effects sit under it,
// music sits about 12 dB under the narration and dips while someone is talking. The renderer then
// sets the final loudness (-16 LUFS) with one fixed gain and a limiter.

export const NOTES = {
  E2: 82.41, F2: 87.31, G2: 98, A2: 110, C3: 130.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, D5: 587.33
};
// The progression under the LetAIApply trailer (IV V vi I6 IV V vi V I in C): hopeful, unhurried.
export const PROGRESSION = [
  [NOTES.F2, [NOTES.F3, NOTES.A3, NOTES.C4, NOTES.E4]], [NOTES.G2, [NOTES.G3, NOTES.B3, NOTES.D4, NOTES.E4]],
  [NOTES.A2, [NOTES.A3, NOTES.C4, NOTES.E4, NOTES.G4]], [NOTES.E2, [NOTES.G3, NOTES.C4, NOTES.E4, NOTES.G4]],
  [NOTES.F2, [NOTES.F3, NOTES.A3, NOTES.C4, NOTES.E4]], [NOTES.G2, [NOTES.G3, NOTES.B3, NOTES.D4, NOTES.E4]],
  [NOTES.A2, [NOTES.A3, NOTES.C4, NOTES.E4, NOTES.G4]], [NOTES.G2, [NOTES.G3, NOTES.B3, NOTES.D4, NOTES.E4]],
  [NOTES.C3, [NOTES.G3, NOTES.C4, NOTES.E4, NOTES.D5]]
];

// mix(ctx, { base, solo, levels }) -> helpers bound to this context.
//   base   folder the sound files are fetched from (default "/sfx/")
//   solo   "vo" | "sfx" | "music" to hear one bus alone (?solo=... on the page URL)
export function mix(ctx, { base = "/sfx/", solo = new URLSearchParams(location.search).get("solo"), levels = { vo: 0.6, sfx: 0.42, music: 0.24 } } = {}) {
  const bus = (name) => {
    const g = ctx.createGain();
    g.gain.value = solo && solo !== name ? 0 : levels[name];
    g.connect(ctx.destination);
    return g;
  };
  const buses = { vo: bus("vo"), sfx: bus("sfx"), music: bus("music") };
  // Music goes through this node, which dips while narration plays.
  const duck = ctx.createGain();
  duck.gain.value = 1;
  duck.connect(buses.music);
  const cache = new Map();

  const load = (url) => {
    if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }).then((b) => ctx.decodeAudioData(b)));
    return cache.get(url);
  };
  const play = (buffer, at, { gain = 1, rate = 1, to = buses.sfx } = {}) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(to);
    src.start(Math.max(0, at));
  };

  return {
    ctx, buses, load,
    // A sound effect from the kit (click, impact, pop, riser, tick, whoosh) or any file in base.
    async sfx(name, at, gain = 0.5, rate = 1) { play(await load(`${base}${name}.ogg`), at, { gain, rate }); },
    // Key ticks for typed text: the same (start, length, speed) the picture types with.
    async keys(at, chars, cps, gain = 0.16, seed = 7) {
      const tick = await load(`${base}tick.ogg`);
      let s = seed;
      const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < chars; i += 2) play(tick, at + i / cps, { gain: gain * (0.7 + 0.5 * r()), rate: 0.85 + 0.4 * r() });
    },
    // A narration line: plays on the narration bus and dips the music around it.
    async voice(url, at, gain = 1) {
      const buffer = await load(url);
      play(buffer, at, { gain, to: buses.vo });
      const end = at + buffer.duration;
      duck.gain.setValueAtTime(1, Math.max(0, at - 0.25));
      duck.gain.linearRampToValueAtTime(0.5, at + 0.05);
      duck.gain.setValueAtTime(0.5, end);
      duck.gain.linearRampToValueAtTime(1, end + 0.45);
      return buffer.duration;
    },
    // One synthesised note on the music bus.
    tone({ type = "sine", freq, at, dur, peak = 0.1, attack = 0.5, release = 1, cutoff = 1200, detune = 0 }) {
      const osc = ctx.createOscillator();
      osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = cutoff; lp.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.setValueAtTime(peak, Math.max(at + attack, at + dur - release));
      g.gain.linearRampToValueAtTime(0, at + dur);
      osc.connect(lp).connect(g).connect(duck);
      osc.start(at); osc.stop(at + dur + 0.05);
    },
    // A low drone (a fifth) that swells, for a dark opening.
    drone(at, dur, root = 55) {
      this.tone({ freq: root, at, dur, peak: 0.2, attack: 1.2, release: 0.2, cutoff: 400 });
      this.tone({ freq: root * 1.498, at: at + 0.4, dur: dur - 0.4, peak: 0.1, attack: 2, release: 0.2, cutoff: 400 });
    },
    // A warm pad through a chord progression, one chord per bar, with a soft pluck on top.
    pad(start, bar, end, chords = PROGRESSION, { pluck = true } = {}) {
      chords.forEach(([bass, notes], i) => {
        const at = start + i * bar;
        if (at >= end) return;
        const last = i === chords.length - 1 || at + bar >= end;
        const dur = last ? end - at : bar + 0.9, release = last ? 2.6 : 1.3;
        this.tone({ freq: bass, at, dur, peak: 0.17, attack: 0.5, release, cutoff: 300 });
        notes.forEach((f, k) => {
          this.tone({ type: "triangle", freq: f, at, dur, peak: 0.05, attack: 0.9, release, cutoff: 900, detune: -5 });
          this.tone({ type: "triangle", freq: f, at, dur, peak: 0.05, attack: 1.1, release, cutoff: 900, detune: 6 });
          if (k === 3) this.tone({ freq: f * 2, at, dur, peak: 0.012, attack: 1.6, release, cutoff: 2400 });
        });
        if (pluck && i >= 1 && !last) [0, 2, 1, 2, 3, 2, 1, 2].forEach((n, b) => {
          const t0 = at + b * (bar / 8), osc = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
          osc.type = "triangle"; osc.frequency.value = notes[n] * 2; lp.type = "lowpass"; lp.frequency.value = 2200;
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.55);
          osc.connect(lp).connect(g).connect(duck); osc.start(t0); osc.stop(t0 + 0.6);
        });
      });
    }
  };
}
