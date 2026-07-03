"""Smoke test: load Qwen3-TTS VoiceDesign model and synthesize one clip."""
import sys, time, inspect

from mlx_audio.tts.utils import load_model

MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"
print(f"loading {MODEL} ...", flush=True)
t0 = time.time()
model = load_model(MODEL)
print(f"loaded in {time.time()-t0:.1f}s; sample_rate={getattr(model,'sample_rate',None)}", flush=True)

# Discover the generation API actually present on this build
methods = [m for m in dir(model) if 'generate' in m.lower()]
print("generate methods:", methods, flush=True)
if hasattr(model, "generate_voice_design"):
    print("SIG generate_voice_design:", inspect.signature(model.generate_voice_design), flush=True)

text = "Cluster is green. Voice server is live."
instruct = "Warm, articulate adult female voice, calm and confident, natural American accent, measured pace."

t0 = time.time()
res = model.generate_voice_design(text=text, instruct=instruct)
# generate_* may return a list, a single result, or a generator
if inspect.isgenerator(res):
    res = list(res)
print(f"synth in {time.time()-t0:.1f}s; type={type(res)}", flush=True)

# Normalize to an audio array
audio = None
sr = getattr(model, "sample_rate", 24000)
def grab(r):
    for attr in ("audio", "wav", "waveform"):
        if hasattr(r, attr):
            return getattr(r, attr)
    return r
cand = res[0] if isinstance(res, (list, tuple)) else res
audio = grab(cand)
print("audio type:", type(audio), "shape:", getattr(audio, "shape", None), flush=True)

from mlx_audio.audio_io import write as audio_write
out = "/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-voice-system/src/qwen3-sidecar/smoke.wav"
audio_write(out, audio, sr)
print("WROTE", out, flush=True)
