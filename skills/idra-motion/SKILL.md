---
name: idra-motion
description: Make a motion graphics video (product trailer, launch video, explainer, promo) from code with idra-motion. A scene is one HTML page whose frames are a pure function of time, rendered with headless Chrome and ffmpeg, with ElevenLabs narration, sound effects and synthesised music mixed to -16 LUFS. Use when someone asks for a trailer, a promo or launch video, an animated explainer, or motion graphics for a product.
---

# idra-motion: one-shot motion graphics

The method behind the LetAIApply launch trailer, made from one prompt. The full case study is the
`method` guide (or `docs/one-shot.md`); this is the working checklist.

## Tools

**With the idra-motion MCP server connected** (Claude Code plugin, `claude mcp add`, Codex
`codex mcp add`, Claude Desktop), use its tools:

| Step | Tool |
| --- | --- |
| Read the method, the engine API, a finished example | `guide` (topics: checklist, method, narration, engine, example, starter, prompt) |
| Start a scene | `new_scene` |
| Scrub it in a browser | `preview` |
| See frames (returns the contact sheet as an image) | `stills` |
| Render draft, master, web cut | `render`, then `job_status` if it returns a job id |
| Hear the mix alone | `soundtrack` |
| Narration | `voices`, `make_voice`, `level_voice`, `word_timings` |

Slow tools return a job id after `wait_seconds` (default 50, under Codex's 60 second limit); call
`job_status` with it until it finishes.

**Without the server**, run the same steps from a clone of the repo. When this skill was installed
with the Claude Code plugin, the repo is two folders above this skill's folder. Otherwise clone it:
`git clone https://github.com/bbrainfuckk/idra-motion`. Needs Node 20+, Chrome or Edge, and ffmpeg;
Python 3 only for narration.

```
node render.mjs <scene>.html out/check.jpg --stills 0.9,3.6,6.4     # contact sheet; open the image
node render.mjs <scene>.html out/draft.mp4 --fps 30
node render.mjs <scene>.html out/master.mp4 --fps 60 --subframes 4
node render.mjs <scene>.html out/web.mp4 --fps 30 --crf 23
```

A scene outside the repo needs `--root <its folder>`; `/engine`, `/sfx` and `/fonts` always resolve
to the repo's copies.

## 1. Brief

Ask only what you can't find out yourself:

- What the product really does (its own site or store listing is the source). Claims stay within that.
- Length (30 to 60 s for a trailer), format (16:9 1920 x 1080 unless told otherwise), narration or not.
- The look: palette, font, logo files. Use the product's own; never invent a brand.

## 2. Beat sheet

Write the narration as short lines, one idea each, two to five seconds apiece. For every line, write
what the viewer **sees happen** and what they **hear**. Two rules, checked on every row:

- Whatever is said visibly happens on screen at that moment.
- Text on screen is the exact word being said ("Again.", not "And again.").

Put the beat sheet in the comment at the top of the scene file.

## 3. Narration (if any)

The voice is ElevenLabs; Whisper only times the words. The `narration` guide covers both ways to pay
for the voice: the person's own ElevenLabs key (`ELEVENLABS_API_KEY` in a `.env` file in the repo
folder, or in the server's environment) or TTSWP credits on a WordPress site (`tools/ttswp-say.php`).
If there's no key, ask the person to put one in `.env` themselves. Never ask them to paste a key into
the chat, and never write one into a file that git tracks.

1. `voices` to check the key and pick two or three candidates.
2. `make_voice` with the same lines in each voice. Let the person hear each voice alone, one at a
   time, and choose.
3. `level_voice`, then `word_timings` on the chosen voice. Time the picture to those words: a table of
   line start times drives the sound and the picture.

## 4. The scene

`new_scene` (or copy `examples/starter/scene.html`). Read the `engine` and `example` guides once.
Keep the structure:

- One `#stage` of the video's size; one `<section class="scene">` per part; a `.cam` layer for camera moves.
- `draw(t)` sets every element from `t` alone. No CSS transitions or animations, no timers, no state.
  Gate each part by a time window and hide it outside (`vis`).
- Timing lives in small tables (typed text, clicks, arrivals). The sound reads the same tables.
- Motion: `spring` for arrivals, `ease`/`kf` for camera and wipes, `typed` for text, `count` for
  numbers, `rng(seed)` for any scatter.
- Rebuild the product interface in HTML at full size with the real font and logo. Use made-up people and
  companies, never a real person's details.
- `sound(ctx)`: `mix(ctx)`, then `voice`, `sfx`, `keys`, `drone`, `pad`. Music sits under the voice.
- `film({ width, height, duration, draw, sound, fonts })` with every font weight the picture uses.

## 5. Check, then render

`stills` at a time inside every beat. Look at the sheet. Read every word against the narration, check
every claim and every "said, so shown" moment. Fix and repeat until it is right. Then `render` a
draft, watch it once with sound, then the master (60 fps, motion blur) and a web cut (under 10 MB for
uploads). Pull a poster frame with ffmpeg (`-ss <t> -frames:v 1`).

## 6. Deliver

The master, the web cut, the poster, and a credits file: the licence of any sound you added (the
bundled kit is idra-motion's own), the voice provider, the font licence. Show the person stills or the draft before calling it done, and
take their notes as new rows in the beat sheet.

idra-motion is source available (see LICENSE): use it to make videos, which the person owns. Don't
copy, modify or redistribute idra-motion itself.
