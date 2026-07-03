"""Verify Qwen3-TTS voice cloning from an ElevenLabs reference."""
import inspect, time
import numpy as np
from mlx_audio.tts.utils import load_model

HERE = "/Users/benjamin/EscapeVelocity/PersonalAI/PAI/Packs/pai-voice-system/src/qwen3-sidecar"
m = load_model("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit")
sr = int(getattr(m, "sample_rate", 24000))
print("sample_rate:", sr)
print("SIG generate:", inspect.signature(m.generate))
if hasattr(m, "_generate_icl"):
    print("SIG _generate_icl:", inspect.signature(m._generate_icl))

ref_wav = f"{HERE}/refs/aurelia.wav"
ref_txt = open(f"{HERE}/refs/aurelia.txt").read().strip()
text = "This is Aurelia, cloned locally from my own voice reference. How do I sound now?"

# Try the documented generate(...) with ref_audio/ref_text
def extract(res):
    if inspect.isgenerator(res):
        res = list(res)
    c = res[0] if isinstance(res, (list, tuple)) else res
    for a in ("audio", "wav", "waveform"):
        if hasattr(c, a):
            return getattr(c, a)
    return c

t0 = time.time()
try:
    res = m.generate(text=text, ref_audio=ref_wav, ref_text=ref_txt)
    audio = extract(res)
    print(f"generate(ref_audio,ref_text) OK in {time.time()-t0:.1f}s shape={getattr(audio,'shape',None)}")
except Exception as e:
    print("generate(ref_audio,ref_text) FAILED:", repr(e))
    audio = None

if audio is not None:
    arr = np.clip(np.asarray(audio, dtype=np.float32).squeeze(), -1, 1)
    import wave
    with wave.open(f"{HERE}/clone-smoke.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((arr * 32767).astype("<i2").tobytes())
    print("WROTE clone-smoke.wav")
