// Runs PowerShell on Windows. Every command Halo builds for Windows is a PowerShell script.
// Windows has no read-only sandbox like macOS's sandbox-exec, so "read-only" here means: our safety rules
// (win/risk.ts) checked that the script only reads, and anything else is refused before it runs.
import { spawn } from "node:child_process";
import type { ExecResult } from "../core/exec.js";
import { assessPowerShell } from "./risk.js";

const MAX_OUTPUT = 20_000;

/** A PowerShell single-quoted string: nothing inside it is expanded or run. */
export function psQuote(text: string): string {
  return "'" + text.replace(/'/g, "''").replace(/[‘’‚‛]/g, "''") + "'";
}

/** Windows PowerShell 5.1 ships with every Windows 10 and 11, so Halo uses it rather than PowerShell 7. */
export const POWERSHELL = "powershell.exe";

/** Arguments for running one script: no profile, no prompts, output as UTF-8. */
export function psArgs(script: string): string[] {
  const prelude = "$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ";
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", prelude + script];
}

export function runPowerShell(script: string, timeoutMs = 30_000, file = POWERSHELL): Promise<ExecResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, psArgs(script), { windowsHide: true });
    } catch (err) {
      resolve({ code: 127, output: String(err), timedOut: false });
      return;
    }
    let output = "";
    const add = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, output: String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: output.slice(-MAX_OUTPUT).replace(/\r\n/g, "\n"), timedOut });
    });
  });
}

/** Runs a script only if our rules say it just reads. The Windows stand-in for the macOS read-only sandbox. */
export async function runPowerShellReadOnly(script: string, timeoutMs = 30_000): Promise<ExecResult> {
  const a = assessPowerShell(script);
  if (!a.readOnly) return { code: 126, output: `Refused: this command isn't read-only (${a.reasons[0] ?? "it could change something"}).`, timedOut: false };
  return runPowerShell(script, timeoutMs);
}

/** Parses JSON that PowerShell printed (ConvertTo-Json). A single object comes back as an array of one. */
export function parsePsJson<T>(output: string): T[] {
  const start = output.search(/[[{]/);
  if (start < 0) return [];
  try {
    const v = JSON.parse(output.slice(start)) as T | T[];
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}
