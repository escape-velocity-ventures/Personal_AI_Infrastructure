#!/usr/bin/env bun
/**
 * Generate Qwen3-TTS voice-cloning references from the ElevenLabs voice IDs.
 *
 * One-time: calls ElevenLabs per persona, saves refs/<name>.wav (24kHz mono PCM)
 * + refs/<name>.txt (the transcript). The sidecar's clone mode then reproduces
 * that timbre locally — no further ElevenLabs calls.
 *
 * Key is read from ~/.env (ELEVENLABS_API_KEY=...), never from argv/chat.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// --- load ELEVENLABS_API_KEY from ~/.env ---
const envPath = join(homedir(), ".env");
let apiKey = process.env.ELEVENLABS_API_KEY || "";
if (!apiKey && existsSync(envPath)) {
  const txt = await Bun.file(envPath).text();
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.+)\s*$/);
    if (m) apiKey = m[1].replace(/^['"]|['"]$/g, "").trim();
  }
}
if (!apiKey) {
  console.error("No ELEVENLABS_API_KEY in env or ~/.env. Add it, then re-run.");
  process.exit(1);
}

// ElevenLabs source voices per persona (resolved by name from the account, 2026-07-02):
//   aurelia     = "Influencer Emily"                     (female, Irish)
//   tinkerbelle = "Jessica – Playful, Bright, Warm"      (female, American)
//   cybill      = "Elizabeth – Professional British Narrator" (female, British)
const PERSONAS: Record<string, string> = {
  aurelia: "odyUrTN5HMVKujvVAgWW",
  tinkerbelle: "cgSgspJ2msm6clMCkdW9",
  cybill: "AXdMgz6evoL7OPd7eU12",
};

// ~15s of phonetically varied, natural speech. Content is irrelevant to cloning
// (timbre is captured) but MUST match the saved transcript for ref_text.
const REF_TEXT =
  "Hello — it's good to hear from you. I've been thinking about what we discussed, " +
  "and I believe we're on the right track. Let's take this one step at a time, " +
  "and I'll walk you through everything as we go.";

const MODEL_ID = "eleven_multilingual_v2";
const OUT_DIR = join(import.meta.dir, "refs");
mkdirSync(OUT_DIR, { recursive: true });

// Wrap raw 16-bit mono PCM into a WAV container.
function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  const dataLen = pcm.length;
  w(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, dataLen, true);
  const out = new Uint8Array(44 + dataLen);
  out.set(new Uint8Array(header), 0); out.set(pcm, 44);
  return out;
}

for (const [name, voiceId] of Object.entries(PERSONAS)) {
  process.stdout.write(`Generating ref for ${name} (${voiceId}) ... `);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_24000`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": "audio/pcm" },
    body: JSON.stringify({
      text: REF_TEXT,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    console.log(`FAILED ${r.status}: ${(await r.text()).slice(0, 200)}`);
    continue;
  }
  const pcm = new Uint8Array(await r.arrayBuffer());
  const wav = pcmToWav(pcm, 24000);
  writeFileSync(join(OUT_DIR, `${name}.wav`), wav);
  writeFileSync(join(OUT_DIR, `${name}.txt`), REF_TEXT);
  console.log(`ok (${(wav.length / 1024).toFixed(0)} KB)`);
}
console.log(`\nDone. References in ${OUT_DIR}`);
