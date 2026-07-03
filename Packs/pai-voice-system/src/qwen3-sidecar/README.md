# Qwen3-TTS Local Sidecar

Local text-to-speech backend for the PAI voice server, using **Qwen3-TTS via
[mlx-audio](https://github.com/Blaizzy/mlx-audio)** on Apple Silicon. This is
the "Local Qwen3-TTS sidecar" tier the voice server already expected
(`../VoiceServer/server.ts`, Tier 2). It clones each persona's voice from its
original ElevenLabs voice and serves speech fully offline.

> **Why not LM Studio?** LM Studio can *load* the `qwen3_tts` GGUF but its server
> exposes no TTS HTTP route (`/v1/audio/speech` → "Unexpected endpoint or
> method"). mlx-audio is the working local backend.

## Architecture

```
Claude Code Stop hook  →  voice server :8770  →  pronunciation filter  →  this sidecar :8889  →  WAV  →  afplay
   (emits 🗣️ line)        (routes by persona    (k8s→kubernetes, …)      (Qwen3-TTS clone)
                            NAME, not voice_id)
```

Routing is **by persona name** (`aurelia` | `tinkerbelle` | `cybill`), matching
the other TTS environments (plato / laptop). The persona travels in the
`voice` field of the `/notify` payload (see `stop-hook-voice.ts`
`NotificationPayload.voice`). Personas can share an ElevenLabs `voice_id`, so the
name — not the id — is authoritative.

## HTTP contract (what the voice server calls)

```
POST /tts   { "text": str, "voice": str, "speed": float }  →  audio/wav (16-bit mono 24kHz)
GET  /health                                               →  200 {"status":"ok"}
```

For each request the sidecar looks for `refs/<voice>.wav` + `refs/<voice>.txt`:
- **found → clone mode** — reproduces that speaker's timbre (`generate(ref_audio, ref_text, speed)`)
- **missing → design mode** — synthesizes from the `instruct` description in `voices.json`

## Voices

| Persona | Source (ElevenLabs) | Reference |
|---------|---------------------|-----------|
| aurelia | Influencer Emily (Irish) | `refs/aurelia.wav` |
| tinkerbelle | Jessica – Playful, Bright, Warm | `refs/tinkerbelle.wav` |
| cybill | Elizabeth – Professional British Narrator | `refs/cybill.wav` |

Roles without a reference (`will`, `researcher`, `analyst`, …) use description
prompts in `voices.json`.

## Files

| File | Purpose |
|------|---------|
| `server.py` | The sidecar HTTP server (single-threaded — MLX GPU streams are thread-affine). |
| `voices.json` | Voice-design `instruct` prompts (fallback for voices without a reference). |
| `refs/` | Cloning references: `<persona>.wav` + `<persona>.txt` (transcript). |
| `generate-refs.ts` | One-time: pull references from ElevenLabs voice IDs (reads key from `~/.env`). |
| `list-voices.ts` | List the account's ElevenLabs voices (resolve names → IDs). |
| `start-voice-stack.sh` | Dev launcher for sidecar + voice server (launchd is the durable path). |
| `smoke.py`, `clone-smoke.py` | Manual API smoke tests. |

## Running (durable — launchd)

Both services run as user LaunchAgents (auto-start at login, restart on crash):

```
~/Library/LaunchAgents/com.pai.qwen3-sidecar.plist   # :8889 sidecar
~/Library/LaunchAgents/com.pai.voice-server.plist    # :8770 voice server (TTS_BACKEND=qwen3)
```

```bash
# reload after editing voices.json / refs / server.py
launchctl kickstart -k gui/$(id -u)/com.pai.qwen3-sidecar
# reload after editing the voice server
launchctl kickstart -k gui/$(id -u)/com.pai.voice-server
# stop / start
launchctl bootout   gui/$(id -u)/com.pai.qwen3-sidecar
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pai.qwen3-sidecar.plist
# logs
tail -f logs/{sidecar,voice-server}.log
```

Dev (foreground, no launchd): `./start-voice-stack.sh`.

## Adding or re-pulling a voice

1. Find the ElevenLabs voice ID: `bun run list-voices.ts`
2. Add it to `PERSONAS` in `generate-refs.ts`
3. Ensure `ELEVENLABS_API_KEY=...` is in `~/.env`, then `bun run generate-refs.ts`
4. `launchctl kickstart -k gui/$(id -u)/com.pai.qwen3-sidecar`

The ElevenLabs key is needed **only** to capture references. Runtime is fully
local — no key, no network.

## Setup (fresh machine)

```bash
uv venv --python 3.12
uv pip install mlx-audio
# models download on first load (~1.8 GB each): Base (clone) + VoiceDesign (optional)
```

## Backend

- **Engine:** mlx-audio + `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` (clone + design)
- **Hardware:** Apple Silicon (MLX/Metal); ~1–2 s per voice line after a ~1 s warm load
- **Sample rate:** 24 kHz mono
