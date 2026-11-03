// Records the landing page demo's lines with ElevenLabs voices (Eleven v4), into site/audio/.
// The key comes from .env.local (made by `npx @elevenlabs/cli onboard init`); the SDK reads ELEVENLABS_API_KEY itself.
//   npm run site:voices            records all the demo lines with the two voices below
//   npm run site:voices:samples    records one line in several voices, to pick from (site/voice-compare/, not published)
// Keep the lines in step with the demo in site/index.html.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = new ElevenLabsClient();
const MODEL = "eleven_v4";

// Premade ElevenLabs voices, by id.
const VOICES = {
  sarah: "EXAVITQu4vr4xnSDxMaL", // American woman: mature, reassuring, confident
  jessica: "cgSgspJ2msm6clMCkdW9", // American woman: playful, bright, warm
  matilda: "XrExE9yKIg1WjnnlVkGX", // American woman: knowledgeable, professional
  lily: "pFZP5JQG7iQjIQuC4Bku", // British woman: velvety
  george: "JBFqnCBsd6RMkjVDRZzb", // British man, middle-aged: warm storyteller
  brian: "nPczCjzI2devNBz1zQrb", // American man, middle-aged: deep, comforting
  chris: "iP95p4xoKVk53GoZ742B", // American man, middle-aged: charming, down-to-earth
};
const HALO = VOICES.sarah;
const PERSON = VOICES.chris;
const READER = VOICES.george; // the person in the text-size scene
const WOMEN = new Set(["sarah", "jessica", "matilda", "lily"]);

// [tags] set the delivery on Eleven v4; they aren't spoken.
const LINES = {
  // 1. A doctor's video visit, from the email: calendar, check-in form, Zoom.
  "visit-ask": [PERSON, "[unsure] My doctor sent me this email. Can you get me ready for the visit?"],
  "visit-plan": [HALO, "Sure. There are four things to do. I'll add it to your calendar, check you in, install Zoom, and test your camera and microphone."],
  "visit-form": [HALO, "I filled in your check-in with the details from the email. Take a look, then press Submit."],
  "visit-yes": [PERSON, "[relieved] Okay. I pressed it."],
  "visit-done": [HALO, "[warmly] You're all set for Thursday at ten thirty. Zoom is installed, and your camera and microphone work. Your medication list is private, so I left that one for you."],
  // 2. A fake "verify you're human" page that copies a hidden command.
  "click-ask": [PERSON, "[worried] This website says I have to press some keys to prove I'm human. Is that okay?"],
  "click-warn": [HALO, "[firmly] Stop. Don't press those. That page secretly copied a command, and pasting it would let strangers into your computer."],
  "click-done": [HALO, "Nothing was pasted, so your computer is safe. Close this page, and don't come back to it."],
  // 3. Text size. A calmer delivery (higher stability) for George.
  "text-ask": [READER, "I can't read this. The writing is far too small.", 0.7],
  "text-offer": [HALO, "I'll make the text easier to read, everywhere on your computer. Okay?"],
  "text-yes": [READER, "Yes, please.", 0.7],
  "text-done": [HALO, "[warmly] Done. That should be much easier to read now. Just say if you'd like it changed again."],
  // 4. A printer that stopped working after an update: Halo installs the new driver from Windows Update.
  "driver-ask": [PERSON, "[annoyed] My printer stopped working after the last update. Can you fix it?"],
  "driver-found": [HALO, "Your printer's driver is out of date, and Windows has a newer one waiting. I'll install it. Okay?"],
  "driver-yes": [PERSON, "Go ahead."],
  "driver-done": [HALO, "[warmly] Done. The new driver is installed, and I printed a test page to check. Your printer works again."],
};

async function record(voiceId, text, file, stability = 0.4) {
  const audio = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: MODEL,
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability, similarityBoost: 0.75 }, // 0.4: conversational, expressive but steady
  });
  await pipeline(Readable.fromWeb(audio), createWriteStream(file));
  console.log(`${file.split(/[\\/]/).pop()}: ${text}`);
}

if (process.argv.includes("--samples")) {
  const out = join(root, "site", "voice-compare");
  mkdirSync(out, { recursive: true });
  for (const [name, id] of Object.entries(VOICES)) {
    try {
      await record(id, WOMEN.has(name) ? LINES.found[1] : LINES.ask[1], join(out, `el-${name}.mp3`));
    } catch (e) {
      console.log(`skipped ${name}: ${e.message}`); // a voice the account can't use shouldn't stop the rest
    }
  }
} else {
  const out = join(root, "site", "audio");
  mkdirSync(out, { recursive: true });
  // --only a,b re-records just those lines.
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
  for (const [name, [voiceId, text, stability]] of Object.entries(LINES)) {
    if (!only || only.includes(name)) await record(voiceId, text, join(out, `${name}.mp3`), stability);
  }
}
