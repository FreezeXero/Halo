// The real Windows PC behind the agent's tools: the same shape as realMac() in agent/mac.ts.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { ScreenDeps } from "../agent/autopilot.js";
import { folderPath } from "../agent/danger.js";
import { listFilesIn, type MacDeps } from "../agent/tools.js";
import type { Executor } from "../core/runner.js";
import { playwrightForms } from "../agent/webform.js";
import { fileSearchCommand, findStartMenuApp, forceQuitWindowsApp, installWithWinget, listStartMenuApps, openWindowsApp, quitWindowsApp, revealWindowsFile, runningWindowsApps } from "./apps.js";
import { runPowerShell, runPowerShellReadOnly } from "./ps.js";
import { windowsUi } from "./ui.js";

export function realWindows(opts: { execute: Executor; trash: (path: string) => Promise<void>; protectedApps?: string[]; screen?: ScreenDeps }): MacDeps {
  const home = homedir();
  return {
    home,
    screen: opts.screen,
    // Reading windows by name goes with screen access, like on the Mac.
    ui: opts.screen ? windowsUi : undefined,
    webForm: playwrightForms,
    protectedApps: ["explorer", "File Explorer", "Halo", "Electron", ...(opts.protectedApps ?? [])],
    sandboxed: (c, t) => runPowerShellReadOnly(c, t),
    // The Mac's built-in checks don't apply here; Windows tools run their own fixed scripts.
    checkRunner: async () => ({ code: 1, output: "Not available on Windows." }),
    execute: opts.execute,
    run: (c) => runPowerShell(c, 30_000),
    listApps: () => listStartMenuApps(),
    findApp: (name) => findStartMenuApp(name),
    runningApps: () => runningWindowsApps().catch(() => []),
    quitApp: quitWindowsApp,
    forceQuitApp: forceQuitWindowsApp,
    openApp: openWindowsApp,
    trash: opts.trash,
    exists: existsSync,
    // Switching speakers needs an undocumented Windows interface: for now Halo opens Sound settings instead.
    listOutputs: async () => [],
    setOutput: async () => {
      throw new Error("Switching speakers isn't available on Windows yet.");
    },
    listFiles: (folder, max) => listFilesIn(folderPath(folder, home), max),
    spotlight: async (q, timeoutMs) => {
      const t0 = Date.now();
      const command = fileSearchCommand(q, home);
      if (!command) return { paths: [], timedOut: false, ms: 0 };
      const r = await runPowerShell(command, timeoutMs);
      return { paths: r.code === 0 ? r.output.split("\n").map((l) => l.trim()).filter(Boolean) : [], timedOut: r.timedOut, ms: Date.now() - t0 };
    },
    installOfficial: installWithWinget,
    reveal: revealWindowsFile,
    now: () => Date.now(),
  };
}
