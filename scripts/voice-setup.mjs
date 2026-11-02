// Downloads the small English speech model (~142 MB) so voice works offline.
// Saves to ~/.cache/calhack/ggml-base.en.bin. Run with: npm run voice:setup
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const URL_ = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const DIR = join(homedir(), ".cache", "calhack");
const DEST = join(DIR, "ggml-base.en.bin");
const PART = DEST + ".part";
const MIN_BYTES = 100 * 1024 * 1024;

const mb = (n) => (n / 1024 / 1024).toFixed(1);

// Windows has no Homebrew: fetch whisper-cli.exe from whisper.cpp's own GitHub release (pinned).
const WHISPER_ZIP = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
const WHISPER_DIR = join(DIR, "whisper");

async function download(url, to) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(to));
}

async function windowsWhisper() {
  const found = [join(WHISPER_DIR, "whisper-cli.exe"), join(WHISPER_DIR, "Release", "whisper-cli.exe")].find((p) => existsSync(p));
  if (found) {
    console.log(`Voice tool already installed: ${found}`);
    return;
  }
  mkdirSync(WHISPER_DIR, { recursive: true });
  const zip = join(DIR, "whisper-bin-x64.zip");
  console.log("Downloading the voice tool (whisper.cpp, about 8 MB)");
  try {
    await download(WHISPER_ZIP, zip);
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:DEST -Force"], {
      env: { ...process.env, ZIP: zip, DEST: WHISPER_DIR },
      stdio: "inherit",
    });
    console.log(`Done. Voice tool is in ${WHISPER_DIR}`);
  } finally {
    rmSync(zip, { force: true });
  }
}

if (process.platform === "win32") {
  try {
    await windowsWhisper();
  } catch (e) {
    console.error(`\nCouldn't set up the voice tool: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

if (existsSync(DEST) && statSync(DEST).size > MIN_BYTES) {
  console.log(`Speech model already installed: ${DEST}`);
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
console.log(`Downloading speech model to ${DEST}`);

try {
  const res = await fetch(URL_, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  let lastPrint = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    got += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 250) {
      lastPrint = now;
      const pct = total ? ` (${Math.floor((got / total) * 100)}%)` : "";
      process.stdout.write(`\r  ${mb(got)} MB${total ? ` of ${mb(total)} MB` : ""}${pct}   `);
    }
  });
  await pipeline(body, createWriteStream(PART));
  process.stdout.write(`\r  ${mb(got)} MB done.                    \n`);

  const size = statSync(PART).size;
  if (size < MIN_BYTES) throw new Error(`file is only ${mb(size)} MB, which is too small`);
  if (total && size !== total) throw new Error(`got ${size} bytes but expected ${total}`);
  renameSync(PART, DEST);
  console.log(`Done. Voice is ready: ${DEST}`);
} catch (e) {
  rmSync(PART, { force: true });
  console.error(`\nCouldn't download the speech model: ${e instanceof Error ? e.message : e}`);
  console.error("Check your internet connection and run it again.");
  process.exit(1);
}
