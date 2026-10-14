#!/usr/bin/env python3
"""Narration for idra-motion: script -> one voice file per line -> same loudness -> word timings.

  python tools/vo.py voices [--search matilda]
  python tools/vo.py make  lines.json --voice <ElevenLabs voice id> [--name matilda] [--model eleven_multilingual_v2] [--out vo-raw]
  python tools/vo.py level vo-raw [--out vo] [--lufs -19]
  python tools/vo.py words vo-raw [--model large-v3-turbo] [--out vo-raw/words.json]

lines.json is a list of lines: [{"id": "1", "text": "Job applications."}, {"id": "2", "text": "..."}].

  voices lists the voices your ElevenLabs key can use, with their ids.
  make   asks ElevenLabs for each line and writes <out>/<name>-<id>.mp3.
         Generate the same lines in two or three voices and listen to them one by one before choosing.
  level  brings every file to the same loudness (-19 LUFS, so the narration sits about 3 dB under the
         final -16 LUFS mix), 48 kHz mono WAV, and writes <out>/info.json with each line's length.
  words  writes every word's start and end time (faster-whisper; pip install faster-whisper). Time the
         picture to these: the word on screen lands when it is said.

voices and make need an ElevenLabs API key: ELEVENLABS_API_KEY in the environment, or a line
ELEVENLABS_API_KEY=... in a .env file in the repo folder (git ignores it). See docs/narration.md,
which also covers the other way to get the MP3s: TTSWP credits with tools/ttswp-say.php.

ffmpeg must be on PATH, or set FFMPEG to its path.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, urllib.error, urllib.request

FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = os.path.join(os.path.dirname(FFMPEG), "ffprobe" + (".exe" if FFMPEG.endswith(".exe") else "")) if os.path.dirname(FFMPEG) else "ffprobe"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def api_key():
    """ELEVENLABS_API_KEY from the environment, else from .env in the current folder or the repo."""
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    for folder in ([] if key else [os.getcwd(), REPO]):
        path = os.path.join(folder, ".env")
        if os.path.exists(path):
            for row in open(path, encoding="utf-8-sig"):
                name, _, value = row.strip().partition("=")
                if name.strip() == "ELEVENLABS_API_KEY" and value.strip():
                    key = value.strip().strip("\"'")
                    break
        if key:
            break
    if not key:
        sys.exit("No ElevenLabs key. Put ELEVENLABS_API_KEY=<your key> in .env in the repo folder, "
                 "or set the ELEVENLABS_API_KEY environment variable. See docs/narration.md.")
    return key


def elevenlabs(request):
    """Open an ElevenLabs request; on an error, say what ElevenLabs said (never the key)."""
    try:
        return urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        hint = {401: "the key was refused: check it, or make a new one",
                402: "the account is out of credits",
                403: "the key is not allowed to do this: give it Text to Speech (and Voices: read) access",
                429: "too many requests at once: wait a moment and run it again (finished lines are kept)"}
        sys.exit(f"ElevenLabs said {error.code}: {hint.get(error.code, detail)}")


def voices(args):
    request = urllib.request.Request("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": api_key()})
    with elevenlabs(request) as response:
        found = json.load(response).get("voices", [])
    for voice in found:
        labels = ", ".join(str(v) for v in (voice.get("labels") or {}).values())
        if not args.search or args.search.lower() in (voice["name"] + " " + labels).lower():
            print(f"{voice['voice_id']:22} {voice['name']:40} {labels}")


def make(args):
    key = api_key()
    lines = json.load(open(args.script, encoding="utf-8"))
    os.makedirs(args.out, exist_ok=True)
    for line in lines:
        dst = os.path.join(args.out, f"{args.name}-{line['id']}.mp3")
        if os.path.exists(dst) and not args.again:
            print("kept", dst)
            continue
        request = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{args.voice}?output_format=mp3_44100_128",
            data=json.dumps({"text": line["text"], "model_id": args.model}).encode(),
            headers={"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"}, method="POST")
        with elevenlabs(request) as response:
            audio = response.read()
        with open(dst, "wb") as handle:
            handle.write(audio)
        print("wrote", dst, "-", line["text"])


def loudness(path):
    log = subprocess.run([FFMPEG, "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1])


def level(args):
    os.makedirs(args.out, exist_ok=True)
    info = {}
    for src in sorted(glob.glob(os.path.join(args.folder, "*.mp3")) + glob.glob(os.path.join(args.folder, "*.wav"))):
        name = os.path.splitext(os.path.basename(src))[0]
        lufs = loudness(src)
        gain = args.lufs - lufs
        dst = os.path.join(args.out, f"{name}.wav")
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", src, "-af", f"volume={gain:.2f}dB", "-ar", "48000", "-ac", "1", dst], check=True)
        duration = float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst], capture_output=True, text=True).stdout)
        info[name] = {"lufs": round(lufs, 1), "gain": round(gain, 2), "duration": round(duration, 3)}
        print(f"{name}: {lufs:.1f} LUFS -> {args.lufs} LUFS, {duration:.2f} s")
    json.dump(info, open(os.path.join(args.out, "info.json"), "w"), indent=1)


def words(args):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("pip install faster-whisper")
    model = WhisperModel(args.model, compute_type="int8")
    out = {}
    for src in sorted(glob.glob(os.path.join(args.folder, "*.mp3")) + glob.glob(os.path.join(args.folder, "*.wav"))):
        segments, _ = model.transcribe(src, word_timestamps=True, language=args.language)
        out[os.path.basename(src)] = [[w.word.strip(), round(w.start, 3), round(w.end, 3)] for s in segments for w in s.words]
        print(os.path.basename(src), " ".join(f"{w}@{a:.2f}" for w, a, _ in out[os.path.basename(src)]))
    json.dump(out, open(args.out or os.path.join(args.folder, "words.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)


parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = parser.add_subparsers(dest="command", required=True)
p = sub.add_parser("voices"); p.add_argument("--search"); p.set_defaults(run=voices)
p = sub.add_parser("make"); p.add_argument("script"); p.add_argument("--voice", required=True); p.add_argument("--name", default="voice")
p.add_argument("--model", default="eleven_multilingual_v2"); p.add_argument("--out", default="vo-raw"); p.add_argument("--again", action="store_true"); p.set_defaults(run=make)
p = sub.add_parser("level"); p.add_argument("folder"); p.add_argument("--out", default="vo"); p.add_argument("--lufs", type=float, default=-19.0); p.set_defaults(run=level)
p = sub.add_parser("words"); p.add_argument("folder"); p.add_argument("--model", default="large-v3-turbo"); p.add_argument("--language", default="en"); p.add_argument("--out"); p.set_defaults(run=words)
args = parser.parse_args()
args.run(args)
