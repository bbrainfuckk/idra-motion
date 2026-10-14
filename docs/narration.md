# Narration: where the voice comes from

Three steps, three different tools:

| Step | Tool | What it does |
| --- | --- | --- |
| 1. Make the voice | **ElevenLabs** | Turns each line of the script into speech. This is the voice you hear. |
| 2. Even it out | `tools/vo.py level` (ffmpeg) | Brings every line to the same loudness, -19 LUFS. |
| 3. Time the words | `tools/vo.py words` (**Whisper**) | Listens to the finished lines and writes when every word starts and ends. |

Whisper never makes a voice. It only listens, so the picture can land each word on screen at the
moment it is said.

There are two ways to pay ElevenLabs for step 1: your own ElevenLabs API key, or TTSWP credits. The
LetAIApply trailer used TTSWP credits. Both give the same voices, with the same voice ids.

## Way 1: your own ElevenLabs API key

**1. Make an account** at [elevenlabs.io](https://elevenlabs.io). Checked on 14 October 2026: the free
plan has 10,000 credits a month but no commercial licence, and the Starter plan ($6 a month, 30,000
credits) is the first one with a commercial licence. A credit is roughly one character of script,
depending on the model. Check the pricing page for your own use.

**2. Make a key** at [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys)
and press Create API key.

- Name it after the project, for example `idra-motion`.
- Restrict it to what it needs: Text to Speech, plus Voices (read) if you want `vo.py voices`.
- Give it a credit limit, so a mistake can't spend the whole account.
- Copy the key straight away.

**3. Put the key where `vo.py` finds it.** The easy way is a `.env` file in the repo folder:

```bash
cp .env.example .env
```

Open `.env` and paste your key after the `=` sign:

```
ELEVENLABS_API_KEY=<your key>
```

`.env` is listed in `.gitignore`, so git never commits it. With the MCP server (plugin, Codex, Claude
Desktop), a `.env` in your own project folder works too, which is the easy place when idra-motion was
installed as a plugin. Or set it as an environment variable instead (this wins over `.env`; restart
the app afterwards so the server sees it):

```powershell
$env:ELEVENLABS_API_KEY = "<your key>"           # Windows PowerShell, this window only
setx ELEVENLABS_API_KEY "<your key>"             # Windows, every new window from now on
```

```bash
export ELEVENLABS_API_KEY="<your key>"           # macOS or Linux; add it to ~/.zshrc or ~/.bashrc to keep it
```

Never put the key in a scene file, a commit, a chat or a screenshot. If it leaks, delete it on the same
API keys page and make a new one.

**4. Check it** by listing the voices it can use:

```bash
python tools/vo.py voices --search matilda
```

If it prints `ElevenLabs said 401`, the key is wrong. `403` means the key isn't allowed to do that: add
Text to Speech (and Voices, read) to it.

**5. Make the lines**, in two or three voices, and listen to them one at a time before choosing:

```bash
python tools/vo.py make lines.json --voice XrExE9yKIg1WjnnlVkGX --name matilda
python tools/vo.py make lines.json --voice nPczCjzI2devNBz1zQrb --name brian
```

Then carry on with step 2 below.

## Way 2: free credits through TTSWP (how the LetAIApply trailer was voiced)

[TTSWP](https://wordpress.org/plugins/text-to-speech-tts/) ("Text to Speech - TTSWP", by Norse Digital
Group) is a WordPress plugin that turns posts into audio with ElevenLabs voices. It runs ElevenLabs
through its own service and charges its own credits, so no ElevenLabs account or key is needed.

**How we got the credits (October 2026):**

1. Our main site isn't WordPress, so we put a small WordPress site on our own server just for this:
   hidden from search engines, and only we can sign in.
2. We installed the TTSWP plugin and pressed **Connect Site**, then **Claim**, in wp-admin. That makes
   a free TTSWP account for the site.
3. That gave **10,000 welcome credits** (once per site), plus **50,000 promotion credits** for
   ElevenLabs' newest model (Eleven V4, 2 credits a character) during an offer that ran until
   13 October 2026.
4. The trailer's script in three voices (Brian, Sarah and Matilda, 24 files) used about 2,900 of the
   promotion credits, just before the offer ended. Matilda was chosen.
5. After the offer ended, a test line cost one credit a character (22 credits for "Made with idra
   motion.").

Offers like that come and go; the welcome credits are the dependable part. One site is all you need.

**Make the lines** with `tools/ttswp-say.php`. Copy it and your `lines.json` to the WordPress server
and run it with [WP-CLI](https://wp-cli.org) from the site's folder, as the user that owns the site's
files (for example `sudo -u www-data wp ...`):

```bash
wp eval-file ttswp-say.php voices | grep -i matilda
wp eval-file ttswp-say.php say lines.json XrExE9yKIg1WjnnlVkGX matilda vo-raw
```

Copy `vo-raw` back to your computer (for example with `scp`) and carry on with step 2 below. The files
are named exactly like the ones `vo.py make` writes.

- After each line it prints what that line cost and how many credits are left. The balance is also on
  your TTSWP dashboard.
- A line that already has its file is skipped, so running it again never pays twice. Delete a file to
  make that line again.
- The plugin hands back a download link that expires within minutes; the script downloads it at once.
- The script calls the plugin's own code, so a big plugin update could change it. Tested with TTSWP
  3.3.37 and WP-CLI 2.12.
- Rights: TTSWP's terms (checked 14 October 2026) say you keep all rights to the audio you generate,
  and ElevenLabs' terms apply to their part. Read both for your own use.

## Step 2: even it out

```bash
python tools/vo.py level vo-raw --out vo
```

Every line at -19 LUFS, 48 kHz mono WAV, plus `vo/info.json` with each line's length. The final mix
sits at -16 LUFS, so the voice stays clearly on top.

## Step 3: time the words (Whisper)

```bash
pip install faster-whisper
python tools/vo.py words vo-raw
```

Free, runs on your own computer, no key. It writes `vo-raw/words.json`: every word with the second it
starts and ends. Time the picture to these.

Whisper can mishear a name (it heard "idra" as "Hydra"). The times are still right, and the times are
all we use.

## Writing the script for a voice

- Write names the way they should be said: "Let A.I. Apply", "idra motion".
- Short lines, one idea each, two to five seconds apiece.
- Generate a couple of voices and listen to each one alone before choosing. Then time everything to
  the chosen voice.

## Voices we like

All ElevenLabs default voices; the ids work with both ways above.

| Voice | Id | Sound |
| --- | --- | --- |
| Matilda | `XrExE9yKIg1WjnnlVkGX` | Knowledgeable, professional (the LetAIApply trailer) |
| Brian | `nPczCjzI2devNBz1zQrb` | Deep, resonant, comforting |
| Sarah | `EXAVITQu4vr4xnSDxMaL` | Mature, reassuring, confident |
| George | `JBFqnCBsd6RMkjVDRZzb` | Warm British storyteller |
| Bill | `pqHfZKP75CvOlQylNhV4` | Wise, mature, balanced |
