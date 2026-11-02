// Stages the "I can't hear my call" demo on Windows, and undoes it.
//   npm run demo:break-sound   sends the sound to a monitor with no speakers (remembering where it was)
//   npm run demo:reset-sound   puts it back where it was
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPowerShell } from "../win/ps.js";
import { likelySilent, OUTPUTS_READ, outputSwitch, parseOutputs, safeOutputId } from "../win/system.js";

const SAVE = join(tmpdir(), "halo-demo-sound.txt");

async function list() {
  const r = await runPowerShell(OUTPUTS_READ, 20_000);
  const outputs = parseOutputs(r.output);
  if (!outputs.length) throw new Error(`Couldn't read the sound outputs: ${r.output.trim().slice(-300)}`);
  return outputs;
}

async function switchTo(id: string) {
  const r = await runPowerShell(outputSwitch(id, 0), 20_000);
  const now = parseOutputs(r.output).find((o) => o.isDefault);
  if (now?.id !== id) throw new Error(`Couldn't switch: ${r.output.trim().slice(-300)}`);
  return now;
}

async function main() {
  if (process.platform !== "win32") throw new Error("This demo script is for Windows. On a Mac use scripts/demo-break-sound.sh.");
  const mode = process.argv[2];
  const outputs = await list();
  const current = outputs.find((o) => o.isDefault);

  if (mode === "break") {
    const silent = outputs.find((o) => likelySilent(o.name) && !o.isDefault);
    if (!silent) {
      if (current && likelySilent(current.name)) return console.log(`Already broken: sound plays on ${current.name}.`);
      throw new Error("No monitor or digital output to send the sound to, so this PC can't stage the demo.");
    }
    // Only save once, so running this twice doesn't overwrite the real setting with the broken one.
    if (current && !existsSync(SAVE)) writeFileSync(SAVE, current.id);
    const now = await switchTo(silent.id);
    console.log(`Sound now plays on ${now.name} (no speakers). Run npm run demo:reset-sound to undo.`);
    return;
  }

  if (mode === "reset") {
    const saved = existsSync(SAVE) ? readFileSync(SAVE, "utf8").trim() : "";
    if (!saved || !safeOutputId(saved) || !outputs.some((o) => o.id === saved)) {
      console.log(`Nothing saved to go back to. Sound plays on ${current?.name ?? "nothing"}.`);
      return;
    }
    const now = await switchTo(saved);
    rmSync(SAVE, { force: true });
    console.log(`Put the sound back on ${now.name}.`);
    return;
  }

  throw new Error("Use: break or reset");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
