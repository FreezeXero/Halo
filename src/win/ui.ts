// Windows: reading and acting on a window by name (ui-elements.ps1, through UI Automation), plus the raw mouse and
// keyboard commands the screen autopilot uses when an app doesn't list its buttons.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UiDeps } from "../agent/uipilot.js";
import { parseWindow, type CloseButton, type UiItem, type UiWindow } from "../mac/ui.js";
import { POWERSHELL, psQuote } from "./ps.js";

const here = dirname(fileURLToPath(import.meta.url));

export function uiScript(): string | null {
  const root = process.env.CALHACK_ROOT ?? join(here, "..", "..");
  return [join(here, "ui-elements.ps1"), join(root, "src", "win", "ui-elements.ps1")].find((p) => existsSync(p)) ?? null;
}

/** Arguments for the helper. Each value is passed as its own argument, so nothing in a name can become code. */
export function helperArgs(script: string, args: string[]): string[] {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args.map((a) => (a === "" ? '""' : a))];
}

function call(args: string[], timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const script = uiScript();
  if (!script) return Promise.resolve({ ok: false, error: "The Windows screen helper (ui-elements.ps1) is missing." });
  return new Promise((resolve) => {
    execFile(POWERSHELL, helperArgs(script, args), { timeout: timeoutMs, maxBuffer: 4_000_000, windowsHide: true, env: { ...process.env, STRIDE_PID: String(process.pid) } }, (err, stdout) => {
      const text = stdout?.toString() ?? "";
      const start = text.indexOf("{");
      try {
        resolve(JSON.parse(text.slice(start)) as Record<string, unknown>);
      } catch {
        resolve({ ok: false, error: err?.message ?? "The Windows screen helper gave no answer." });
      }
    });
  });
}

export async function listWindowWin(app?: string): Promise<UiWindow | { error: string }> {
  return parseWindow(await call(["list", app ?? ""]));
}

export async function actOnWin(app: string, item: UiItem, how: "press" | "select" | "focus" | "increase" | "decrease" = "press"): Promise<{ ok: boolean; error?: string; did?: string; value?: number }> {
  const r = await call(["act", app, item.path, item.role, item.name, how]);
  return { ok: !!r.ok, error: r.error ? String(r.error) : undefined, did: r.did ? String(r.did) : undefined, value: typeof r.value === "number" ? r.value : undefined };
}

export async function typeIntoWin(app: string, item: UiItem, text: string): Promise<{ ok: boolean; error?: string }> {
  if (item.secure) return { ok: false, error: "That's a password box. Only you type there." };
  const r = await call(["type", app, item.path, item.role, item.name, text]);
  return { ok: !!r.ok, error: r.error ? String(r.error) : undefined };
}

export async function closeSheetWin(app: string, button: CloseButton): Promise<{ ok: boolean; pressed: string | null; closed: boolean; error?: string }> {
  const r = await call(["closesheet", app, button]);
  return { ok: !!r.ok, pressed: typeof r.pressed === "string" ? r.pressed : null, closed: r.closed === true, error: r.error ? String(r.error) : undefined };
}

/** The same act as one PowerShell command, so a sensitive one goes through the executor like any other command. */
export function actCommandWin(app: string, item: UiItem, how: string): string {
  const script = uiScript() ?? "ui-elements.ps1";
  return `& ${psQuote(script)} act ${[app, item.path, item.role, item.name, how].map((a) => psQuote(a)).join(" ")}`;
}

export const windowsUi: UiDeps = { list: listWindowWin, act: actOnWin, type: typeIntoWin, command: actCommandWin, closeSheet: closeSheetWin };

// ---------- Raw mouse and keyboard, for the screenshot route ----------

const USER32 = `Add-Type -Namespace Halo -Name Input -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e); [DllImport("user32.dll")] public static extern uint GetDpiForSystem(); [DllImport("user32.dll")] public static extern System.IntPtr SetProcessDpiAwarenessContext(System.IntPtr v);'`;

/**
 * A real mouse click at a point in Halo's screen points (Electron's DIPs), like a person's: move, pause, press, release.
 * The script makes itself DPI aware and scales the point to real pixels, so it lands right on scaled displays.
 */
export function mouseClickCommandWin(x: number, y: number, times: 1 | 2 = 1): string {
  const X = Math.round(x);
  const Y = Math.round(y);
  return [
    USER32,
    "try { [void][Halo.Input]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}",
    "$s = 1.0; try { $s = [Halo.Input]::GetDpiForSystem() / 96.0 } catch {}",
    `[void][Halo.Input]::SetCursorPos([int](${X} * $s), [int](${Y} * $s))`,
    "Start-Sleep -Milliseconds 200",
    `for ($i = 0; $i -lt ${times}; $i++) { [Halo.Input]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 50; [Halo.Input]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100 }`,
  ].join("; ");
}

const SEND_KEYS: Record<string, string> = { return: "{ENTER}", enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", space: " ", down: "{DOWN}", up: "{UP}", left: "{LEFT}", right: "{RIGHT}" };

/** Text for SendKeys: its special characters are wrapped in braces so they're typed, not read as shortcuts. */
export function sendKeysText(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, "{$&}");
}

export function keyCommandWin(key: string): string | null {
  const k = SEND_KEYS[key.toLowerCase()];
  return k === undefined ? null : `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(k)})`;
}

export function typeCommandWin(text: string): string {
  return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(sendKeysText(text))})`;
}
