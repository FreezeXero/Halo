// Windows apps: what's installed (the Start menu's shortcuts), what's running, opening, closing and installing with winget.
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AppInfo } from "../agent/tools.js";
import { psQuote, runPowerShell } from "./ps.js";

/** The Start menu folders, for everyone and for this person. */
export function startMenuFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (env.ProgramData) out.push(join(env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"));
  if (env.APPDATA) out.push(join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"));
  return out;
}

/** Shortcut names that aren't apps a person means ("Uninstall Zoom", "Read me", "Help"). */
const NOT_AN_APP = /\b(uninstall|readme|read me|help|documentation|release notes|license|website|manual)\b/i;

/** Every app in the Start menu, by its shortcut. Synchronous, like the Mac's list of Applications. */
export function listStartMenuApps(folders = startMenuFolders()): AppInfo[] {
  const seen = new Map<string, AppInfo>();
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p, depth + 1);
      else if (/\.(lnk|url)$/i.test(n)) {
        const name = n.replace(/\.(lnk|url)$/i, "");
        if (!NOT_AN_APP.test(name) && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, path: p });
      }
    }
  };
  for (const f of folders) walk(f, 0);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Shortcuts whose name matches, best first: exact, then starts with, then contains. */
export function findStartMenuApp(name: string, apps = listStartMenuApps()): string[] {
  const want = squash(name.replace(/\.(lnk|exe)$/i, ""));
  if (!want) return [];
  const exact = apps.filter((a) => squash(a.name) === want);
  if (exact.length) return exact.map((a) => a.path);
  const starts = apps.filter((a) => squash(a.name).startsWith(want));
  if (starts.length) return starts.slice(0, 3).map((a) => a.path);
  return apps.filter((a) => squash(a.name).includes(want)).slice(0, 3).map((a) => a.path);
}

/** Programs with a window, by their window's app name (e.g. "Zoom", "Google Chrome"). */
export async function runningWindowsApps(): Promise<string[]> {
  const r = await runPowerShell("Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { if ($_.Description) { $_.Description } else { $_.ProcessName } } | Sort-Object -Unique", 15_000);
  return r.code === 0 ? r.output.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

/** The program a shortcut starts, as a process name ("Zoom.exe" → "Zoom"). */
function targetProcessScript(shortcut: string): string {
  return `$t = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(shortcut)}).TargetPath; if (-not $t) { throw "This shortcut doesn't point to a program." }; $n = [System.IO.Path]::GetFileNameWithoutExtension($t)`;
}

/** Closes an app politely (like clicking its X), waiting up to ~5 s. */
export async function quitWindowsApp(shortcut: string): Promise<void> {
  const r = await runPowerShell(`${targetProcessScript(shortcut)}; $p = @(Get-Process -Name $n -ErrorAction SilentlyContinue); foreach ($x in $p) { [void]$x.CloseMainWindow() }; for ($i = 0; $i -lt 20; $i++) { if (-not (Get-Process -Name $n -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }; if (Get-Process -Name $n -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) { throw "The app didn't close, so I left it alone." }`, 20_000);
  if (r.code !== 0) throw new Error(r.output.trim().split("\n").at(-1) || "The app didn't close.");
}

/** Force-closes an app that doesn't respond (unsaved work in it is lost). */
export async function forceQuitWindowsApp(shortcut: string): Promise<void> {
  const r = await runPowerShell(`${targetProcessScript(shortcut)}; if ($n -match '^(explorer|svchost|csrss|winlogon|lsass|services|dwm|System)$') { throw "That's part of Windows, so I left it alone." }; Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 800`, 20_000);
  if (r.code !== 0) throw new Error(r.output.trim().split("\n").at(-1) || "I couldn't close it.");
}

export async function openWindowsApp(path: string): Promise<void> {
  const r = await runPowerShell(`Start-Process ${psQuote(path)}`, 20_000);
  if (r.code !== 0) throw new Error(r.output.trim().split("\n").at(-1) || "It didn't open.");
}

export async function revealWindowsFile(path: string, open: boolean): Promise<void> {
  const r = await runPowerShell(open ? `Start-Process ${psQuote(path)}` : `Start-Process explorer.exe -ArgumentList ${psQuote(`/select,"${path}"`)}`, 20_000);
  if (r.code !== 0) throw new Error(r.output.trim().split("\n").at(-1) || "It didn't open.");
}

// ---------- Installing with winget (Windows' own app installer: makers' installers, checked against their hashes) ----------

/** Well-known apps and their exact winget ids. Anything else is matched by its exact name in the winget catalog. */
export const WINGET_IDS: Record<string, { id: string; name: string }> = {
  zoom: { id: "Zoom.Zoom", name: "Zoom" },
  chrome: { id: "Google.Chrome", name: "Google Chrome" },
  googlechrome: { id: "Google.Chrome", name: "Google Chrome" },
  firefox: { id: "Mozilla.Firefox", name: "Firefox" },
  teams: { id: "Microsoft.Teams", name: "Microsoft Teams" },
  microsoftteams: { id: "Microsoft.Teams", name: "Microsoft Teams" },
  slack: { id: "SlackTechnologies.Slack", name: "Slack" },
  spotify: { id: "Spotify.Spotify", name: "Spotify" },
  vlc: { id: "VideoLAN.VLC", name: "VLC" },
  discord: { id: "Discord.Discord", name: "Discord" },
  adobereader: { id: "Adobe.Acrobat.Reader.64-bit", name: "Adobe Acrobat Reader" },
  acrobatreader: { id: "Adobe.Acrobat.Reader.64-bit", name: "Adobe Acrobat Reader" },
  "7zip": { id: "7zip.7zip", name: "7-Zip" },
  notepadplusplus: { id: "Notepad++.Notepad++", name: "Notepad++" },
  vscode: { id: "Microsoft.VisualStudioCode", name: "Visual Studio Code" },
  visualstudiocode: { id: "Microsoft.VisualStudioCode", name: "Visual Studio Code" },
  whatsapp: { id: "9NKSQGP7F2NH", name: "WhatsApp" },
  skype: { id: "Microsoft.Skype", name: "Skype" },
  webex: { id: "Cisco.Webex", name: "Webex" },
  googledrive: { id: "Google.GoogleDrive", name: "Google Drive" },
  dropbox: { id: "Dropbox.Dropbox", name: "Dropbox" },
  libreoffice: { id: "TheDocumentFoundation.LibreOffice", name: "LibreOffice" },
  python: { id: "Python.Python.3.12", name: "Python" },
  git: { id: "Git.Git", name: "Git" },
  nodejs: { id: "OpenJS.NodeJS.LTS", name: "Node.js" },
  powertoys: { id: "Microsoft.PowerToys", name: "PowerToys" },
};

export function wingetFor(appName: string): { id: string; name: string } | null {
  return WINGET_IDS[squash(appName)] ?? WINGET_IDS[squash(appName.replace(/\b(app|desktop|for windows)\b/gi, ""))] ?? null;
}

/** A name winget can search for exactly: letters, digits, spaces and a few marks, nothing that could be an option. */
export function safeAppName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 .+&'-]{0,60}$/.test(name.trim());
}

export function wingetInstallCommand(app: { id?: string; name?: string }): string {
  const common = "--exact --accept-package-agreements --accept-source-agreements --silent --disable-interactivity";
  if (app.id) return `winget install --id ${psQuote(app.id)} ${common}`;
  return `winget install --name ${psQuote(app.name ?? "")} --source winget ${common}`;
}

export function wingetListCommand(app: { id?: string; name?: string }): string {
  return app.id ? `winget list --id ${psQuote(app.id)} --exact --disable-interactivity --accept-source-agreements` : `winget list --name ${psQuote(app.name ?? "")} --exact --disable-interactivity --accept-source-agreements`;
}

/** winget prints the matching package as a table row when it's installed; "No installed package" when not. */
export function wingetListed(output: string): boolean {
  return !/no installed package/i.test(output) && /^-{5,}/m.test(output);
}

export async function installWithWinget(appName: string): Promise<{ ok: boolean; message: string; evidence: import("../core/types.js").Evidence[] }> {
  const known = wingetFor(appName);
  if (!known && !safeAppName(appName)) return { ok: false, message: `"${appName}" doesn't look like an app name, so I didn't install anything.`, evidence: [] };
  const app = known ?? { name: appName.trim() };
  const evidence: import("../core/types.js").Evidence[] = [];
  const has = await runPowerShell("Get-Command winget -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source", 15_000);
  if (has.code !== 0 || !has.output.trim()) return { ok: false, message: "This PC doesn't have winget (Windows' App Installer), so I can't install apps yet. It comes from the Microsoft Store as \"App Installer\".", evidence };
  const before = await runPowerShell(wingetListCommand(app), 60_000);
  evidence.push({ kind: "before", command: wingetListCommand(app), code: before.code, output: before.output.trim().split("\n").slice(-3).join("\n") });
  if (before.code === 0 && wingetListed(before.output)) return { ok: true, message: `${known?.name ?? appName} is already installed.`, evidence };
  const cmd = wingetInstallCommand(app);
  const r = await runPowerShell(cmd, 15 * 60_000);
  evidence.push({ kind: "run", command: cmd, code: r.code, output: r.output.trim().split("\n").slice(-6).join("\n") });
  const after = await runPowerShell(wingetListCommand(app), 60_000);
  const ok = after.code === 0 && wingetListed(after.output);
  evidence.push({ kind: "after", command: wingetListCommand(app), code: ok ? 0 : 1, output: after.output.trim().split("\n").slice(-3).join("\n") });
  if (ok) return { ok, message: `${known?.name ?? appName} is installed.`, evidence };
  const why = /no package found/i.test(r.output) ? `I couldn't find "${appName}" in Windows' app catalog, so I didn't download anything from other websites.` : `${known?.name ?? appName} didn't finish installing${/cancel|denied|1602|0x80070005/i.test(r.output) ? " (the install was cancelled or needed your OK)" : ""}.`;
  return { ok: false, message: why, evidence };
}

// ---------- Finding files ----------

/** Searches the person's own folders by name (and optionally modified within N days). Never system folders. */
export function fileSearchCommand(q: { name?: string; modifiedWithinDays?: number }, home = homedir()): string | null {
  const name = (q.name ?? "").replace(/[*?[\]`'"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return null;
  const roots = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"].map((d) => join(home, d)).filter((d) => existsSync(d) || process.platform !== "win32");
  const since = q.modifiedWithinDays && q.modifiedWithinDays > 0 ? ` | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-${Math.min(3650, Math.round(q.modifiedWithinDays))}) }` : "";
  return `Get-ChildItem -Path ${roots.map(psQuote).join(",")} -Recurse -Depth 6 -File -Filter ${psQuote(`*${name}*`)} -ErrorAction SilentlyContinue${since} | Select-Object -First 200 -ExpandProperty FullName`;
}

export function shortcutName(path: string): string {
  return basename(path).replace(/\.(lnk|url)$/i, "");
}
