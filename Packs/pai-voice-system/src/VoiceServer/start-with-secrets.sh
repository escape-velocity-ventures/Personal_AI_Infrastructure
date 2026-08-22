#!/bin/bash
# Resolves ELEVENLABS_API_KEY and DANTE_TTS_TOKEN via tb-sec (with an
# off-network cache fallback — see resolve-secret-cached.sh) instead of
# storing them as plaintext plist literals (TinkerBelle-config-26gbq leak-
# vector fix). The plist passes only non-secret config; this wrapper
# injects both credentials into the child's environment.
#
# Canonical, identical across every machine running this pack's voice
# server (hermes, scylla, ...) — the plist's ProgramArguments always
# points at this same repo-relative path, so one file change here is one
# `git pull` away from taking effect everywhere, not a per-machine hand
# edit (TinkerBelle-config-d159r).
#
# Neither credential is treated as fatal to starting: ElevenLabs and Dante
# are each one tier of a 4-tier cascade (dante-tts -> local-qwen3 ->
# elevenlabs -> macos-say in server.ts), and macos-say never needs a
# credential at all. Refusing to start the whole notification service
# because one optional tier's secret is unavailable — the exact failure
# mode this script replaces — is worse than just running with fewer
# working tiers. (Contrast plato's dante-tts GATEWAY wrapper, which stays
# fatal-on-empty: an empty token THERE means "auth silently disabled" for
# the shared whole-house endpoint, a materially different risk.)
set -uo pipefail

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="$HOME/.cache/pai-voice-system"
mkdir -p "$CACHE_DIR"
chmod 700 "$CACHE_DIR"

ELEVENLABS_API_KEY="$("$SCRIPT_DIR/resolve-secret-cached.sh" elevenlabs "$CACHE_DIR/elevenlabs-api-key.cache")" \
  || echo "start-with-secrets: no ElevenLabs credential (live or cached) — starting without that tier" >&2
export ELEVENLABS_API_KEY

DANTE_TTS_TOKEN="$("$SCRIPT_DIR/resolve-secret-cached.sh" dante "$CACHE_DIR/dante-tts-token.cache")" \
  || echo "start-with-secrets: no Dante credential (live or cached) — starting without that tier" >&2
export DANTE_TTS_TOKEN

exec /Users/benjamin/.bun/bin/bun run "$SCRIPT_DIR/server.ts"
