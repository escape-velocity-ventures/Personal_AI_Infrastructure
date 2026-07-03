#!/usr/bin/env python3
"""
Qwen3-TTS local sidecar for the PAI voice server.

Implements the contract the voice server's Tier-2 local path expects
(pai-voice-system/src/VoiceServer/server.ts):

    POST /tts   { "text": str, "voice": str, "speed": float }  -> audio/wav bytes
    GET  /health                                               -> 200 {"status":"ok"}

Backend: mlx-audio + Qwen3-TTS VoiceDesign (Apple Silicon, MLX). Voice character
comes from a natural-language `instruct` string per persona (voices.json) — no
reference audio required.

Env:
    QWEN3_SIDECAR_PORT   default 8889
    QWEN3_MODEL          default mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit
"""
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

from mlx_audio.tts.utils import load_model

PORT = int(os.environ.get("QWEN3_SIDECAR_PORT", "8889"))
# Base model does BOTH voice cloning (ref_audio) and voice-design (instruct).
MODEL_ID = os.environ.get("QWEN3_MODEL", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit")
HERE = os.path.dirname(os.path.abspath(__file__))
REFS_DIR = os.path.join(HERE, "refs")

with open(os.path.join(HERE, "voices.json")) as f:
    VOICES = json.load(f)

def instruct_for(voice: str) -> str:
    entry = VOICES.get((voice or "").lower()) or VOICES.get("default")
    return entry["instruct"]

def ref_for(voice: str):
    """Return (wav_path, ref_text) if a cloning reference exists for this voice, else None."""
    name = (voice or "").lower()
    wav = os.path.join(REFS_DIR, f"{name}.wav")
    txt = os.path.join(REFS_DIR, f"{name}.txt")
    if os.path.exists(wav) and os.path.exists(txt):
        with open(txt) as fh:
            return wav, fh.read().strip()
    return None

print(f"[qwen3-sidecar] loading {MODEL_ID} ...", flush=True)
_t0 = time.time()
MODEL = load_model(MODEL_ID)
SAMPLE_RATE = int(getattr(MODEL, "sample_rate", 24000) or 24000)
print(f"[qwen3-sidecar] model ready in {time.time()-_t0:.1f}s (sr={SAMPLE_RATE})", flush=True)

# MLX generation is not safe to run concurrently — serialize.
_LOCK = threading.Lock()


def _extract_audio(res):
    """Normalize mlx-audio return (generator | list | result) to a float np array."""
    import inspect
    if inspect.isgenerator(res):
        res = list(res)
    cand = res[0] if isinstance(res, (list, tuple)) else res
    for attr in ("audio", "wav", "waveform"):
        if hasattr(cand, attr):
            cand = getattr(cand, attr)
            break
    arr = np.asarray(cand, dtype=np.float32).squeeze()
    return arr


def synth(text: str, voice: str, speed: float = 1.0) -> bytes:
    ref = ref_for(voice)
    with _LOCK:
        if ref:
            wav, ref_text = ref
            # Voice cloning: reproduce the reference speaker's timbre.
            res = MODEL.generate(text=text, ref_audio=wav, ref_text=ref_text, speed=speed)
        else:
            # No reference for this voice → fall back to description-based design.
            res = MODEL.generate(text=text, instruct=instruct_for(voice), speed=speed)
        audio = _extract_audio(res)
    # float [-1,1] -> 16-bit PCM WAV
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._send(200, json.dumps({"status": "ok", "model": MODEL_ID}).encode())
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path.rstrip("/") != "/tts":
            self._send(404, b'{"error":"not found"}')
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n) or b"{}")
            text = (payload.get("text") or "").strip()
            voice = payload.get("voice") or "default"
            try:
                speed = float(payload.get("speed") or 1.0)
            except (TypeError, ValueError):
                speed = 1.0
            if not text:
                self._send(400, b'{"error":"missing text"}')
                return
            mode = "clone" if ref_for(voice) else "design"
            t0 = time.time()
            wav = synth(text, voice, speed)
            print(f"[qwen3-sidecar] /tts voice={voice} mode={mode} speed={speed} "
                  f"chars={len(text)} {time.time()-t0:.1f}s {len(wav)}B", flush=True)
            self._send(200, wav, ctype="audio/wav")
        except Exception as e:
            print(f"[qwen3-sidecar] ERROR: {e}", file=sys.stderr, flush=True)
            self._send(500, json.dumps({"error": str(e)}).encode())


if __name__ == "__main__":
    # Single-threaded on purpose: MLX GPU streams are thread-affine, so all
    # inference must stay on the thread that loaded the model. TTS is serial anyway.
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[qwen3-sidecar] listening on http://127.0.0.1:{PORT}  (/tts, /health)", flush=True)
    srv.serve_forever()
