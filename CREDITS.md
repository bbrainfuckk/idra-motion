# Credits and licences

## Sound effects (`sfx/`)

All six are made by `tools/make-sfx.mjs` from noise, sine waves, filters and envelopes, seeded so every
run makes the same files. They are part of idra-motion and covered by its LICENSE. Use them in the
videos you make with it.

| File | What it is |
| --- | --- |
| `sfx/whoosh.ogg` | Air that rises and falls in pitch while it crosses the stereo field (0.43 s) |
| `sfx/click.ogg` | A crisp press and a quieter release (0.09 s) |
| `sfx/pop.ogg` | A round pop with a fast pitch drop (0.12 s) |
| `sfx/riser.ogg` | Filtered noise and a tone climbing for two seconds |
| `sfx/impact.ogg` | A deep thump with a short crack on top (0.27 s) |
| `sfx/tick.ogg` | A 20 ms key or detent tick |

## Music

Synthesised in the page by `engine/sound.js` (pad, pluck, drone). No recording, sample or third-party
track, so there is nothing to license and nothing a platform can match against.

## Font

Inter by Rasmus Andersson, SIL Open Font License 1.1 (`fonts/OFL.txt`).

## Narration

`tools/vo.py` calls ElevenLabs with your own API key. Check ElevenLabs' terms for your plan before
publishing narration commercially (the free plan has no commercial licence). `tools/ttswp-say.php` uses
TTSWP credits instead; TTSWP's terms say you keep the rights to the audio you generate, and ElevenLabs'
terms apply to their part. Details in `docs/narration.md`.

The LetAIApply trailer's narration (ElevenLabs voice Matilda, made with TTSWP credits) is not included
in this repo.

## Sounds you add

Any sound file you add to a scene keeps its own licence. List it in your video's credits.
