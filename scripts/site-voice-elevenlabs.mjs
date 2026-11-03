// Records the landing page demo's lines with ElevenLabs voices, into site/audio/ (the same files site-voice.py makes).
// Needs ELEVENLABS_API_KEY in .env (elevenlabs.io > Profile > API keys). Never commit the key.
//   node scripts/site-voice-elevenlabs.mjs            records all the demo lines
//   node scripts/site-voice-elevenlabs.mjs --samples  records one line in several voices, to pick from (site/voice-compare/)
// Change the two voices below to the ones you pick. Keep the lines in step with the demo in site/index.html.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Premade ElevenLabs voices (Voice Library > Default), by id.
const VOICES = {
  sarah: "EXAVITQu4vr4xnSDxMaL", // young woman, soft, warm
  jessica: "cgSgspJ2msm6clMCkdW9", // young woman, expressive
  matilda: "XrExE9yKIg1WjnnlVkGX", // woman, friendly
  alice: "Xb7hH8MSUJpSbSDYk0k2", // British woman, confident
  lily: "pFZP5JQG7iQjIQuC4Bku", // British woman, warm
  bill: "pqHfZKP75CVOyXcXqjdK", // older American man, trustworthy
  george: "JBFqnCBsd6RMkjVDRZzb", // older British man, warm
  brian: "nPczCjzI2devNBz1zQrb", // American man, deep
  chris: "iP95p4xoKVk53GoZ742B", // American man, casual
};
const HALO = VOICES.sarah;
const PERSON = VOICES.bill;
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

const LINES = {
  ask: [PERSON, "The sound thing is broken. I can't hear Sam."],
  found: [HALO, "Your call is fine. The sound is going to your monitor, which has no speakers."],
  offer: [HALO, "I'll switch it to your laptop speakers. Okay?"],
  yes: [PERSON, "Yes."],
  done: [HALO, "Switched to your laptop speakers. You should hear Sam now."],
  "scam-ask": [PERSON, "This says my computer has a virus, and I have to call them. Should I?"],
  "scam-warn": [HALO, "Don't call. This is a scam. Real warnings never ask you to phone a number."],
  "scam-done": [HALO, "I closed that page. Your computer is fine, and nothing was installed."],
  "text-ask": [PERSON, "I can't read this. The words are too small."],
  "text-offer": [HALO, "I'll make the text bigger everywhere on your computer. Okay?"],
  "text-yes": [PERSON, "Yes, please."],
  "text-done": [HALO, "Done. Everything is bigger now. Tell me if you want it even larger."],
};

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  try {
    const m = readFileSync(join(root, ".env"), "utf8").match(/^\s*ELEVENLABS_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  } catch {}
  throw new Error("Put ELEVENLABS_API_KEY=... in .env first (elevenlabs.io > Profile > API keys).");
}

async function record(voice, text, file) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs said ${r.status}: ${(await r.text()).slice(0, 300)}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`${file.split(/[\\/]/).pop()}: ${text}`);
}

if (process.argv.includes("--samples")) {
  const out = join(root, "site", "voice-compare");
  mkdirSync(out, { recursive: true });
  for (const [name, id] of Object.entries(VOICES)) {
    const woman = ["sarah", "jessica", "matilda", "alice", "lily"].includes(name);
    try {
      await record(id, woman ? LINES.found[1] : LINES.ask[1], join(out, `el-${name}.mp3`));
    } catch (e) {
      console.log(`skipped ${name}: ${e.message}`); // a voice ElevenLabs no longer offers shouldn't stop the rest
    }
  }
} else {
  const out = join(root, "site", "audio");
  mkdirSync(out, { recursive: true });
  for (const [name, [voice, text]] of Object.entries(LINES)) await record(voice, text, join(out, `${name}.mp3`));
}
