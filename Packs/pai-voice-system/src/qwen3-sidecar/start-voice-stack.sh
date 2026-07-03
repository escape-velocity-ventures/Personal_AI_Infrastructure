#!/usr/bin/env bash
# Bring up the local voice stack:
#   1. Qwen3-TTS sidecar (mlx-audio)  -> :8889  (/tts, /health)
#   2. PAI voice server               -> :8888  (/notify) — cascade forced to local Qwen
#
# The Claude Code Stop hook already POSTs 🗣️ lines to the voice server.
set -euo pipefail

SIDECAR_DIR="/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-voice-system/src/qwen3-sidecar"
VOICE_DIR="/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-voice-system/src/VoiceServer"
LOG_DIR="$SIDECAR_DIR/logs"
mkdir -p "$LOG_DIR"

echo "==> starting Qwen3-TTS sidecar on :8889"
"$SIDECAR_DIR/.venv/bin/python" "$SIDECAR_DIR/server.py" > "$LOG_DIR/sidecar.log" 2>&1 &
SIDECAR_PID=$!
echo "    sidecar pid=$SIDECAR_PID (log: $LOG_DIR/sidecar.log)"

# Wait for the sidecar to finish loading the model (health returns 200)
echo "==> waiting for sidecar /health (model load can take ~30-60s first run)"
for i in $(seq 1 120); do
  if curl -sf -o /dev/null http://127.0.0.1:8889/health; then echo "    sidecar healthy"; break; fi
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then echo "!! sidecar died — see log"; tail -20 "$LOG_DIR/sidecar.log"; exit 1; fi
  sleep 1
done

echo "==> starting PAI voice server on :8770 (TTS_BACKEND=qwen3)"
# Port 8770 = what settings.json VOICE_SERVER_URL targets (the Stop hook posts here).
# TTS_BACKEND=qwen3 -> never use ElevenLabs; remote Dante (plato.local:8770) fails fast -> local :8889 -> say
TTS_BACKEND=qwen3 \
QWEN3_LOCAL_URL="http://localhost:8889" \
PORT=8770 \
  bun run "$VOICE_DIR/server.ts" > "$LOG_DIR/voice-server.log" 2>&1 &
VOICE_PID=$!
echo "    voice-server pid=$VOICE_PID (log: $LOG_DIR/voice-server.log)"

sleep 2
curl -sf http://127.0.0.1:8770/health && echo || echo "!! voice server health not yet ready"

echo
echo "PIDs: sidecar=$SIDECAR_PID voice=$VOICE_PID"
echo "Stop with: kill $SIDECAR_PID $VOICE_PID"
echo "$SIDECAR_PID $VOICE_PID" > "$LOG_DIR/pids"
