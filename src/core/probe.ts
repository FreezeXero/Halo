// Looks at the computer before planning: macOS version, chip, installed tools and apps.
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runSandboxed } from "./exec.js";
import { isWindows } from "../platform.js";
import { listStartMenuApps } from "../win/apps.js";
import { runPowerShell } from "../win/ps.js";

export interface Environment {
  os: "macOS" | "Windows";
  osVersion: string;
  chip: string;
  homebrew: string | null;
  python3: string | null;
  apps: string[];
  /** Windows' app installer, when it's there. */
  winget?: string | null;
}

async function firstLine(command: string): Promise<string | null> {
  const r = await runSandboxed(command, 15_000);
  const line = r.output.trim().split("\n")[0]?.trim();
  return r.code === 0 && line ? line : null;
}

function listApps(): string[] {
  const names = new Set<string>();
  for (const dir of ["/Applications", join(homedir(), "Applications")]) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".app")) names.add(f.slice(0, -4));
    } catch {
      // Folder missing or not readable: skip it.
    }
  }
  return [...names].sort();
}

async function probeWindows(): Promise<Environment> {
  const r = await runPowerShell("$o = Get-CimInstance Win32_OperatingSystem; 'os:' + $o.Caption + ' ' + $o.Version; 'arch:' + $env:PROCESSOR_ARCHITECTURE; 'winget:' + $(try { (winget --version) } catch { '' }); 'python:' + $(try { (python --version) 2>&1 } catch { '' })", 20_000);
  const field = (k: string) => new RegExp(`^${k}:(.*)$`, "m").exec(r.output)?.[1]?.trim() || null;
  const arch = field("arch");
  return {
    os: "Windows",
    osVersion: field("os") ?? "unknown",
    chip: arch === "ARM64" ? "ARM (arm64)" : arch === "AMD64" ? "Intel or AMD (x64)" : arch ?? "unknown",
    homebrew: null,
    python3: field("python"),
    apps: listStartMenuApps().map((a) => a.name),
    winget: field("winget"),
  };
}

export async function probeEnvironment(): Promise<Environment> {
  if (isWindows()) return probeWindows();
  const [osVersion, chip, homebrew, python3] = await Promise.all([
    firstLine("sw_vers -productVersion"),
    firstLine("uname -m"),
    firstLine("brew --version"),
    firstLine("python3 --version"),
  ]);
  return {
    os: "macOS",
    osVersion: osVersion ?? "unknown",
    chip: chip === "arm64" ? "Apple silicon (arm64)" : chip === "x86_64" ? "Intel (x86_64)" : chip ?? "unknown",
    homebrew,
    python3,
    apps: listApps(),
  };
}

/** A short description of the computer for the AI. */
export function describeEnvironment(env: Environment): string {
  if (env.os === "Windows") {
    return [
      `Operating system: ${env.osVersion}`,
      `Processor: ${env.chip}`,
      `winget (app installer): ${env.winget || "not available"}`,
      `Python: ${env.python3 ?? "not installed"}`,
      `Installed apps: ${env.apps.slice(0, 80).join(", ")}`,
    ].join("\n");
  }
  return [
    `Operating system: macOS ${env.osVersion}`,
    `Chip: ${env.chip}`,
    `Homebrew: ${env.homebrew ?? "not installed"}`,
    `Python 3: ${env.python3 ?? "not installed"}`,
    `Installed apps: ${env.apps.slice(0, 80).join(", ")}`,
  ].join("\n");
}
