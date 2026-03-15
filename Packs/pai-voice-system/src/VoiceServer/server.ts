#!/usr/bin/env bun
/**
 * Voice Server - Personal AI Voice notification server
 *
 * TTS cascade (configurable via TTS_BACKEND env var):
 *   1. Cluster Qwen3-TTS (network, 2s timeout)
 *   2. Local Qwen3-TTS sidecar (localhost:8889, 5s timeout)
 *   3. ElevenLabs API
 *   4. macOS say (fallback)
 */

import { serve } from "bun";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

// Load .env from user home directory
const envPath = join(homedir(), '.env');
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text();
  envContent.split('\n').forEach(line => {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) return;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && value && !key.startsWith('#')) {
      process.env[key] = value;
    }
  });
}

const PORT = parseInt(process.env.PORT || "8888");
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!ELEVENLABS_API_KEY) {
  console.error('Warning: ELEVENLABS_API_KEY not found in ~/.env');
  console.error('Voice server will use macOS say command as fallback');
  console.error('Add: ELEVENLABS_API_KEY=your_key_here to ~/.env');
}

// ==========================================================================
// Qwen3-TTS Configuration
// ==========================================================================

// TTS backend selection: "auto" (default), "qwen3" (skip ElevenLabs), "elevenlabs" (skip Qwen3)
const TTS_BACKEND = (process.env.TTS_BACKEND || 'auto') as 'auto' | 'qwen3' | 'elevenlabs';

// Dante TTS gateway — whole-house audio via remote speak endpoint
const DANTE_TTS_URL = process.env.DANTE_TTS_URL || 'http://plato.local:8770';
const DANTE_TTS_TOKEN = process.env.DANTE_TTS_TOKEN || '';
const DANTE_TTS_TIMEOUT = parseInt(process.env.DANTE_TTS_TIMEOUT || '30000');  // 30s — synthesis + playback on remote

// Qwen3-TTS endpoints — local sidecar for fallback when off-site
const QWEN3_LOCAL_URL = process.env.QWEN3_LOCAL_URL || 'http://localhost:8889';
const QWEN3_LOCAL_TIMEOUT = 15000;   // 15s — MLX inference on Apple Silicon takes 2-8s depending on text length

// Map ElevenLabs voice IDs to Qwen3 voice reference names
const QWEN3_VOICE_MAP: Record<string, string> = {
  // --- Primary voices ---
  'odyUrTN5HMVKujvVAgWW': 'aurelia',     // Aurelia (DA)
  'cgSgspJ2msm6clMCkdW9': 'tinkerbelle', // TinkerBelle

  // --- Role-based voices (voices.json) ---
  'bIHbv24MWmeRgasZH58o': 'will',        // Default/Assistant/Engineer/Security
  'MClEFoImJXBTgLwdLI5n': 'researcher',  // Researcher/Architect/Designer/Writer
  'M563YhMmA0S8vEYwkgYa': 'analyst',     // Analyst/Intern

  // --- Named agent voices ---
  'fTtv3eikoepIosk8dTZ5': 'vera',        // Vera Sterling (Algorithm)
  'ZF6FPAbjXT4488VcRRnw': 'priya',       // Priya Desai (Artist + Designer)
  'AXdMgz6evoL7OPd7eU12': 'ava',         // Ava Chen/Sterling (Researchers + QA)
  '8xsdoepm9GrzPPzYsiLP': 'remy',        // Remy (CodexResearcher)
  'iLVmqjzCGGvqtMCk6vVQ': 'marcus',     // Marcus Webb (Engineer + Gemini)
  'fSw26yDDQPyodv5JgLow': 'johannes',    // Johannes (GrokResearcher)
  // NOTE: serena (muZKMsIDGYtIkjjiUS82) and rook (xvHLFjaUEpx4BOf7EiDd)
  // not cloned — ElevenLabs voices deleted/expired. They fall through to ElevenLabs API.
};

// Speak via Dante TTS gateway — fire-and-forget, plays on remote speakers
async function speakViaDante(
  text: string,
  voice: string,
  speed: number = 1.0,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DANTE_TTS_TIMEOUT);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (DANTE_TTS_TOKEN) {
      headers['Authorization'] = `Bearer ${DANTE_TTS_TOKEN}`;
    }
    const response = await fetch(`${DANTE_TTS_URL}/speak`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, voice, speed }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dante TTS error: ${response.status} - ${errorText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// Check if Dante TTS gateway is reachable
async function checkDanteHealth(timeout: number = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(`${DANTE_TTS_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    const data = await response.json() as { status?: string; backendHealthy?: boolean };
    return data.status === 'ok' && data.backendHealthy === true;
  } catch {
    return false;
  }
}

// Generate speech using Qwen3-TTS sidecar (returns WAV audio)
async function generateSpeechQwen3(
  text: string,
  qwen3Voice: string,
  baseUrl: string,
  timeout: number,
  speed: number = 1.0,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: qwen3Voice, speed }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Qwen3-TTS error: ${response.status} - ${errorText}`);
    }

    return await response.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

// Check if a Qwen3-TTS endpoint is healthy
async function checkQwen3Health(baseUrl: string, timeout: number = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

// Load DA identity from DAIDENTITY.md (single source of truth)
let daVoiceId: string | null = null;
let daVoiceProsody: ProsodySettings | null = null;
let daName = "Assistant";

const DAIDENTITY_PATH = join(homedir(), '.claude', 'skills', 'CORE', 'USER', 'DAIDENTITY.md');

try {
  if (existsSync(DAIDENTITY_PATH)) {
    const content = readFileSync(DAIDENTITY_PATH, 'utf-8');

    // Extract fields from markdown format: **Field:** Value
    const nameMatch = content.match(/\*\*Name:\*\*\s*(\w+)/);
    const voiceMatch = content.match(/\*\*Voice\s*ID:\*\*\s*(\S+)/i);

    if (nameMatch?.[1]) {
      daName = nameMatch[1];
    }
    if (voiceMatch?.[1]) {
      daVoiceId = voiceMatch[1];
      console.log(`Loaded DA voice ID from DAIDENTITY.md: ${daVoiceId}`);
    }
  }
} catch (error) {
  console.warn('Failed to load DA identity from DAIDENTITY.md:', error);
}

if (!daVoiceId) {
  console.warn('No Voice ID found in DAIDENTITY.md');
  console.warn('Add: **Voice ID:** your_elevenlabs_voice_id to DAIDENTITY.md');
}

// Default voice ID: DAIDENTITY.md is source of truth, env var is fallback
const DEFAULT_VOICE_ID = daVoiceId || process.env.ELEVENLABS_VOICE_ID || "";

// Voice configuration types
interface ProsodySettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
  volume?: number;  // Playback volume (0.0-1.0), optional
}

interface VoiceConfig {
  voice_id: string;
  voice_name: string;
  stability: number;
  similarity_boost: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
  prosody?: ProsodySettings;
  description: string;
  type: string;
}

interface VoicesConfig {
  voices: Record<string, VoiceConfig>;
}

// Default voice settings (ElevenLabs API defaults)
const DEFAULT_PROSODY: ProsodySettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  speed: 1.0,
  use_speaker_boost: true,
};

// Load voices configuration from CORE skill (canonical source for agent voices)
let voicesConfig: VoicesConfig | null = null;
try {
  const corePersonalitiesPath = join(homedir(), '.claude', 'skills', 'CORE', 'SYSTEM', 'AGENTPERSONALITIES.md');
  if (existsSync(corePersonalitiesPath)) {
    const markdownContent = readFileSync(corePersonalitiesPath, 'utf-8');
    // Extract JSON block from markdown
    const jsonMatch = markdownContent.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      voicesConfig = JSON.parse(jsonMatch[1]);
      console.log('Loaded agent voice personalities from AGENTPERSONALITIES.md');
    }
  }
} catch (error) {
  console.warn('Failed to load agent voice personalities');
}

// Load user pronunciation customizations
let pronunciations: Record<string, string> = {};
try {
  const pronunciationsPath = join(homedir(), '.claude', 'skills', 'CORE', 'USER', 'pronunciations.json');
  if (existsSync(pronunciationsPath)) {
    const content = readFileSync(pronunciationsPath, 'utf-8');
    pronunciations = JSON.parse(content);
    console.log(`Loaded ${Object.keys(pronunciations).length} pronunciation(s) from USER config`);
  }
} catch (error) {
  console.warn('Failed to load pronunciation customizations');
}

// Apply pronunciation substitutions to text before TTS
function applyPronunciations(text: string): string {
  let result = text;
  for (const [term, pronunciation] of Object.entries(pronunciations)) {
    // Case-insensitive replacement with word boundaries
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    result = result.replace(regex, pronunciation);
  }
  return result;
}

// Escape special characters for AppleScript
function escapeForAppleScript(input: string): string {
  // Escape backslashes first, then double quotes
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Strip any bracket markers from message (legacy cleanup)
function stripMarkers(message: string): string {
  return message.replace(/\[[^\]]*\]/g, '').trim();
}

// Get voice configuration by voice ID or agent name
function getVoiceConfig(identifier: string): VoiceConfig | null {
  if (!voicesConfig) return null;

  // Try direct agent name lookup
  if (voicesConfig.voices[identifier]) {
    return voicesConfig.voices[identifier];
  }

  // Try voice_id lookup
  for (const config of Object.values(voicesConfig.voices)) {
    if (config.voice_id === identifier) {
      return config;
    }
  }

  return null;
}

// Sanitize input for TTS and notifications - allow natural speech punctuation
function sanitizeForSpeech(input: string): string {
  // Allow: letters, numbers, spaces, common punctuation for natural speech
  // Explicitly block: shell metacharacters, path traversal, script tags, markdown
  const cleaned = input
    .replace(/<script/gi, '')  // Remove script tags
    .replace(/\.\.\//g, '')     // Remove path traversal
    .replace(/[;&|><`$\\]/g, '') // Remove shell metacharacters
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // Strip bold markdown: **text** -> text
    .replace(/\*([^*]+)\*/g, '$1')       // Strip italic markdown: *text* -> text
    .replace(/`([^`]+)`/g, '$1')         // Strip inline code: `text` -> text
    .replace(/#{1,6}\s+/g, '')           // Strip markdown headers: ### -> (empty)
    .trim()
    .substring(0, 500);

  return cleaned;
}

// Validate user input - check for obviously malicious content
function validateInput(input: any): { valid: boolean; error?: string; sanitized?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Invalid input type' };
  }

  if (input.length > 500) {
    return { valid: false, error: 'Message too long (max 500 characters)' };
  }

  // Sanitize and check if anything remains
  const sanitized = sanitizeForSpeech(input);

  if (!sanitized || sanitized.length === 0) {
    return { valid: false, error: 'Message contains no valid content after sanitization' };
  }

  return { valid: true, sanitized };
}

// Generate speech using ElevenLabs API with full prosody support
async function generateSpeech(
  text: string,
  voiceId: string,
  prosody?: Partial<ProsodySettings>
): Promise<ArrayBuffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  // Merge provided prosody with defaults
  const settings = { ...DEFAULT_PROSODY, ...prosody };

  // ElevenLabs API voice_settings format (speed goes INSIDE voice_settings)
  const voiceSettings = {
    stability: settings.stability,
    similarity_boost: settings.similarity_boost,
    style: settings.style,
    speed: settings.speed, // Speed belongs in voice_settings, not top-level
    use_speaker_boost: settings.use_speaker_boost,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: voiceSettings,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  return await response.arrayBuffer();
}

// Get volume setting from DA config or request (defaults to 1.0 = 100%)
function getVolumeSetting(requestVolume?: number): number {
  // Request volume takes priority
  if (typeof requestVolume === 'number' && requestVolume >= 0 && requestVolume <= 1) {
    return requestVolume;
  }
  // Then DA voice config from settings.json
  if (daVoiceProsody?.volume !== undefined && daVoiceProsody.volume >= 0 && daVoiceProsody.volume <= 1) {
    return daVoiceProsody.volume;
  }
  return 1.0; // Default to full volume
}

// Play audio using afplay (macOS)
async function playAudio(audioBuffer: ArrayBuffer, requestVolume?: number): Promise<void> {
  const tempFile = `/tmp/voice-${Date.now()}.mp3`;

  // Write audio to temp file
  await Bun.write(tempFile, audioBuffer);

  const volume = getVolumeSetting(requestVolume);

  return new Promise((resolve, reject) => {
    // afplay -v takes a value from 0.0 to 1.0
    const proc = spawn('/usr/bin/afplay', ['-v', volume.toString(), tempFile]);

    proc.on('error', (error) => {
      console.error('Error playing audio:', error);
      reject(error);
    });

    proc.on('exit', (code) => {
      // Clean up temp file
      spawn('/bin/rm', [tempFile]);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`afplay exited with code ${code}`));
      }
    });
  });
}

// Play WAV audio using afplay (macOS) — for Qwen3-TTS output
async function playAudioWav(audioBuffer: ArrayBuffer, requestVolume?: number): Promise<void> {
  const tempFile = `/tmp/voice-${Date.now()}.wav`;
  await Bun.write(tempFile, audioBuffer);
  const volume = getVolumeSetting(requestVolume);

  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/afplay', ['-v', volume.toString(), tempFile]);
    proc.on('error', (error) => { console.error('Error playing WAV:', error); reject(error); });
    proc.on('exit', (code) => {
      spawn('/bin/rm', [tempFile]);
      code === 0 ? resolve() : reject(new Error(`afplay exited with code ${code}`));
    });
  });
}

// Use macOS say command as fallback
async function speakWithSay(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/say', [text]);

    proc.on('error', (error) => {
      console.error('Error with say command:', error);
      reject(error);
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`say exited with code ${code}`));
      }
    });
  });
}

// Spawn a process safely
function spawnSafe(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);

    proc.on('error', (error) => {
      console.error(`Error spawning ${command}:`, error);
      reject(error);
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

// Send macOS notification with voice
async function sendNotification(
  title: string,
  message: string,
  voiceEnabled = true,
  voiceId: string | null = null,
  requestProsody?: Partial<ProsodySettings>
) {
  // Validate and sanitize inputs
  const titleValidation = validateInput(title);
  const messageValidation = validateInput(message);

  if (!titleValidation.valid) {
    throw new Error(`Invalid title: ${titleValidation.error}`);
  }

  if (!messageValidation.valid) {
    throw new Error(`Invalid message: ${messageValidation.error}`);
  }

  // Use pre-sanitized values from validation
  const safeTitle = titleValidation.sanitized!;
  let safeMessage = stripMarkers(messageValidation.sanitized!);

  // Generate and play voice using TTS cascade
  if (voiceEnabled) {
    const voice = voiceId || DEFAULT_VOICE_ID;
    const spokenMessage = applyPronunciations(safeMessage);
    const qwen3Voice = QWEN3_VOICE_MAP[voice];

    // Resolve prosody for ElevenLabs (used as fallback)
    const voiceConfigEntry = getVoiceConfig(voice);
    let prosody: Partial<ProsodySettings> = {};
    if (voiceConfigEntry) {
      prosody = voiceConfigEntry.prosody ?? {
        stability: voiceConfigEntry.stability,
        similarity_boost: voiceConfigEntry.similarity_boost,
        style: voiceConfigEntry.style ?? DEFAULT_PROSODY.style,
        speed: voiceConfigEntry.speed ?? DEFAULT_PROSODY.speed,
        use_speaker_boost: voiceConfigEntry.use_speaker_boost ?? DEFAULT_PROSODY.use_speaker_boost,
      };
    } else if (voice === DEFAULT_VOICE_ID && daVoiceProsody) {
      prosody = daVoiceProsody;
    }
    if (requestProsody) {
      prosody = { ...prosody, ...requestProsody };
    }
    const settings = { ...DEFAULT_PROSODY, ...prosody };
    const volume = (prosody as any)?.volume ?? daVoiceProsody?.volume;
    const speed = settings.speed ?? 1.0;

    let played = false;

    // --- Tier 1: Dante TTS gateway (whole-house audio) ---
    if (!played && qwen3Voice && TTS_BACKEND !== 'elevenlabs') {
      try {
        console.log(`[Tier 1] Dante TTS: voice=${qwen3Voice}, speed=${speed}`);
        await speakViaDante(spokenMessage, qwen3Voice, speed);
        played = true;
        console.log(`[Tier 1] Success — Dante TTS (remote playback)`);
      } catch (err: any) {
        console.log(`[Tier 1] Dante TTS unavailable: ${err.message?.substring(0, 80)}`);
      }
    }

    // --- Tier 2: Local Qwen3-TTS sidecar ---
    if (!played && qwen3Voice && TTS_BACKEND !== 'elevenlabs') {
      try {
        console.log(`[Tier 2] Local Qwen3-TTS: voice=${qwen3Voice}, speed=${speed}`);
        const wavBuffer = await generateSpeechQwen3(spokenMessage, qwen3Voice, QWEN3_LOCAL_URL, QWEN3_LOCAL_TIMEOUT, speed);
        await playAudioWav(wavBuffer, volume);
        played = true;
        console.log(`[Tier 2] Success — local Qwen3-TTS`);
      } catch (err: any) {
        console.log(`[Tier 2] Local Qwen3-TTS failed: ${err.message?.substring(0, 80)}`);
      }
    }

    // --- Tier 3: ElevenLabs API ---
    if (!played && ELEVENLABS_API_KEY && TTS_BACKEND !== 'qwen3') {
      try {
        console.log(`[Tier 3] ElevenLabs: voice=${voice}, speed=${speed}, stability=${settings.stability}`);
        const audioBuffer = await generateSpeech(spokenMessage, voice, prosody);
        await playAudio(audioBuffer, volume);
        played = true;
        console.log(`[Tier 3] Success — ElevenLabs`);
      } catch (err: any) {
        console.error(`[Tier 3] ElevenLabs failed: ${err.message?.substring(0, 80)}`);
      }
    }

    // --- Tier 4: macOS say (last resort) ---
    if (!played) {
      try {
        console.log(`[Tier 4] macOS say fallback`);
        await speakWithSay(spokenMessage);
        played = true;
      } catch (sayError) {
        console.error("[Tier 4] macOS say also failed:", sayError);
      }
    }
  }

  // Display macOS notification - escape for AppleScript
  try {
    const escapedTitle = escapeForAppleScript(safeTitle);
    const escapedMessage = escapeForAppleScript(safeMessage);
    const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name ""`;
    await spawnSafe('/usr/bin/osascript', ['-e', script]);
  } catch (error) {
    console.error("Notification display error:", error);
  }
}

// Rate limiting
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// Start HTTP server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const clientIp = req.headers.get('x-forwarded-for') || 'localhost';

    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ status: "error", message: "Rate limit exceeded" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 429
        }
      );
    }

    if (url.pathname === "/notify" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "PAI Notification";
        const message = data.message || "Task completed";
        const voiceEnabled = data.voice_enabled !== false;
        const voiceId = data.voice_id || data.voice_name || null; // Support both voice_id and voice_name

        // Accept prosody settings directly in request (for custom agents)
        // Also accept volume at top level for convenience
        const voiceSettings: Partial<ProsodySettings> | undefined = data.voice_settings
          ? { ...data.voice_settings, volume: data.volume ?? data.voice_settings.volume }
          : data.volume !== undefined
            ? { volume: data.volume }
            : undefined;

        if (voiceId && typeof voiceId !== 'string') {
          throw new Error('Invalid voice_id');
        }

        console.log(`Notification: "${title}" - "${message}" (voice: ${voiceEnabled}, voiceId: ${voiceId || DEFAULT_VOICE_ID})`);

        await sendNotification(title, message, voiceEnabled, voiceId, voiceSettings);

        return new Response(
          JSON.stringify({ status: "success", message: "Notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("Notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    if (url.pathname === "/pai" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "PAI Assistant";
        const message = data.message || "Task completed";

        console.log(`PAI notification: "${title}" - "${message}"`);

        await sendNotification(title, message, true, null);

        return new Response(
          JSON.stringify({ status: "success", message: "PAI notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("PAI notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    if (url.pathname === "/health") {
      const [danteHealthy, localHealthy] = await Promise.all([
        checkDanteHealth(),
        checkQwen3Health(QWEN3_LOCAL_URL),
      ]);

      return new Response(
        JSON.stringify({
          status: "healthy",
          port: PORT,
          tts_backend: TTS_BACKEND,
          tts_cascade: [
            { tier: 1, name: "dante-tts", url: DANTE_TTS_URL, available: danteHealthy },
            { tier: 2, name: "local-qwen3", url: QWEN3_LOCAL_URL, available: localHealthy },
            { tier: 3, name: "elevenlabs", available: !!ELEVENLABS_API_KEY },
            { tier: 4, name: "macos-say", available: true },
          ],
          default_voice_id: DEFAULT_VOICE_ID,
          qwen3_voices: Object.values(QWEN3_VOICE_MAP),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200
        }
      );
    }

    return new Response("Voice Server - POST to /notify or /pai", {
      headers: corsHeaders,
      status: 200
    });
  },
});

console.log(`Voice Server running on port ${PORT}`);
console.log(`TTS backend: ${TTS_BACKEND}`);
console.log(`TTS cascade: dante-tts → local-qwen3 → elevenlabs → macos-say`);
console.log(`Dante TTS: ${DANTE_TTS_URL}`);
console.log(`Qwen3 local: ${QWEN3_LOCAL_URL}`);
console.log(`Qwen3 voices: ${Object.values(QWEN3_VOICE_MAP).join(', ')}`);
console.log(`ElevenLabs: ${ELEVENLABS_API_KEY ? 'configured' : 'not configured'}`);
console.log(`Default voice: ${DEFAULT_VOICE_ID}`);
console.log(`POST to http://localhost:${PORT}/notify`);

// Check Qwen3-TTS availability at startup (non-blocking)
Promise.all([
  checkDanteHealth().then(ok => console.log(`Dante TTS: ${ok ? 'reachable' : 'unreachable'}`)),
  checkQwen3Health(QWEN3_LOCAL_URL).then(ok => console.log(`Qwen3 local: ${ok ? 'reachable' : 'unreachable'}`)),
]);
