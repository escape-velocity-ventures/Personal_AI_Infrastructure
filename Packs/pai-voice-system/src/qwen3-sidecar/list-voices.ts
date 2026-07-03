#!/usr/bin/env bun
// List ElevenLabs voices (name -> id + labels). Names/IDs are not secret; key stays in ~/.env.
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let apiKey = process.env.ELEVENLABS_API_KEY || "";
const envPath = join(homedir(), ".env");
if (!apiKey && existsSync(envPath)) {
  for (const line of (await Bun.file(envPath).text()).split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.+)\s*$/);
    if (m) apiKey = m[1].replace(/^['"]|['"]$/g, "").trim();
  }
}
if (!apiKey) { console.error("no key"); process.exit(1); }

const r = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
  headers: { "xi-api-key": apiKey },
});
if (!r.ok) { console.error("HTTP", r.status, (await r.text()).slice(0, 300)); process.exit(1); }
const data = await r.json();
const voices = data.voices || [];
console.log(`account has ${voices.length} voices\n`);
const want = /sarah|ava|emily|influencer/i;
for (const v of voices) {
  const labels = v.labels || {};
  const tag = `${labels.gender || ""} ${labels.accent || ""} ${labels.description || ""} ${v.category || ""}`.trim();
  const hit = want.test(v.name) ? "  <<< MATCH" : "";
  if (want.test(v.name) || voices.length <= 40) {
    console.log(`${v.name.padEnd(22)} ${v.voice_id}  [${tag}]${hit}`);
  }
}
