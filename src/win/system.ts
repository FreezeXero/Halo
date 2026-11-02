// Fixed, tested PowerShell for Windows settings, sound, Wi-Fi, Bluetooth and printers. The AI picks a setting and a value;
// it never writes these scripts. Every change has a read-back that proves it took.
import { psQuote } from "./ps.js";

// ---------- Dark mode ----------

const PERSONALIZE = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

export function darkModeSet(on: boolean): string {
  const v = on ? 0 : 1; // the registry stores "uses LIGHT theme"
  return `Set-ItemProperty -Path ${psQuote(PERSONALIZE)} -Name AppsUseLightTheme -Value ${v} -Type DWord; Set-ItemProperty -Path ${psQuote(PERSONALIZE)} -Name SystemUsesLightTheme -Value ${v} -Type DWord`;
}
export const DARK_MODE_READ = `$p = Get-ItemProperty -Path ${psQuote(PERSONALIZE)}; "apps:" + $p.AppsUseLightTheme + ";system:" + $p.SystemUsesLightTheme`;
export function parseDarkMode(out: string): boolean | null {
  const m = /apps:(\d)/.exec(out);
  return m ? m[1] === "0" : null;
}

// ---------- Sound (the default speakers' volume and mute, through Windows' Core Audio) ----------

const AUDIO_TYPE = `Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class HaloAudio {
  static IAudioEndpointVolume Vol() {
    var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume v = null;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out v));
    return v;
  }
  public static float Volume { get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; } set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); } }
  public static bool Mute { get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; } set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); } }
}
'@`;

const AUDIO_PRINT = `"output volume:" + [int][Math]::Round([HaloAudio]::Volume * 100) + ", output muted:" + ([string][HaloAudio]::Mute).ToLower()`;

export const VOLUME_READ = `${AUDIO_TYPE}\n${AUDIO_PRINT}`;

export function volumeSet(o: { level?: number | null; muted?: boolean | null }): string {
  const lines = [AUDIO_TYPE];
  if (o.muted === true || o.muted === false) lines.push(`[HaloAudio]::Mute = $${o.muted}`);
  if (typeof o.level === "number" && Number.isFinite(o.level)) lines.push(`[HaloAudio]::Volume = ${(Math.max(0, Math.min(100, Math.round(o.level))) / 100).toFixed(2)}`);
  lines.push(AUDIO_PRINT);
  return lines.join("\n");
}

export function parseVolume(out: string): { level: number | null; muted: boolean | null } {
  const level = /output volume:(\d+)/.exec(out);
  const muted = /output muted:(true|false)/.exec(out);
  return { level: level ? Number(level[1]) : null, muted: muted ? muted[1] === "true" : null };
}

// ---------- Mouse pointer size ----------
// Settings > Accessibility > Mouse pointer > Size (1-15) stores CursorSize, and the cursor size in pixels in
// CursorBaseSize. SPI_SETCURSORS (0x57) makes Windows reload the pointers at the new size right away.

export const POINTER_SIZES: Record<string, number> = { normal: 1, larger: 3, large: 5, "extra large": 8 };

export function pointerSizeSet(size: number): string {
  const n = Math.max(1, Math.min(15, Math.round(size)));
  const px = 32 + (n - 1) * 16;
  return [
    `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Accessibility' -Name CursorSize -Value ${n} -Type DWord`,
    `Set-ItemProperty -Path 'HKCU:\\Control Panel\\Cursors' -Name CursorBaseSize -Value ${px} -Type DWord`,
    `Add-Type -Namespace Halo -Name Spi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, System.IntPtr c, uint d);'`,
    `[void][Halo.Spi]::SystemParametersInfo(0x57, 0, [IntPtr]::Zero, 3)`,
  ].join("; ");
}
export const POINTER_SIZE_READ = `$a = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Accessibility' -ErrorAction SilentlyContinue; $c = Get-ItemProperty -Path 'HKCU:\\Control Panel\\Cursors'; "size:" + $(if ($a.CursorSize) { $a.CursorSize } else { 1 }) + ";px:" + $(if ($c.CursorBaseSize) { $c.CursorBaseSize } else { 32 })`;
export function parsePointerSize(out: string): number | null {
  const m = /size:(\d+)/.exec(out);
  return m ? Number(m[1]) : null;
}

// ---------- Text size (read back only: the change goes through the Settings page, which applies it everywhere) ----------

export const TEXT_SCALE_READ = `$a = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Accessibility' -ErrorAction SilentlyContinue; "text:" + $(if ($a.TextScaleFactor) { $a.TextScaleFactor } else { 100 })`;
export function parseTextScale(out: string): number | null {
  const m = /text:(\d+)/.exec(out);
  return m ? Number(m[1]) : null;
}

// ---------- Wi-Fi and Bluetooth radios (Windows.Devices.Radios: the same switches as the quick settings, no admin) ----------

export type RadioKind = "WiFi" | "Bluetooth";

const RADIO_PRELUDE = [
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  "function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }",
  "[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null",
  "[Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null",
  "[Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null",
  "Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null",
  "$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])",
].join("\n");

export function radioCommand(kind: RadioKind, want: "on" | "off" | "status"): string {
  const lines = [RADIO_PRELUDE, `$r = $radios | Where-Object { $_.Kind -eq '${kind}' } | Select-Object -First 1`, `if (-not $r) { "${kind}:none"; exit 0 }`];
  if (want !== "status") {
    lines.push(`$s = Await ($r.SetStateAsync('${want === "on" ? "On" : "Off"}')) ([Windows.Devices.Radios.RadioAccessStatus])`);
    lines.push("Start-Sleep -Milliseconds 800");
    lines.push(`"access:" + $s`);
  }
  lines.push(`"${kind}:" + $r.State`);
  return lines.join("\n");
}

export function parseRadio(kind: RadioKind, out: string): "on" | "off" | "none" | null {
  const m = new RegExp(`${kind}:(On|Off|Disabled|Unknown|none)`).exec(out);
  if (!m) return null;
  return m[1] === "On" ? "on" : m[1] === "none" ? "none" : "off";
}

// ---------- Internet ----------

export const INTERNET_CHECK = `$p = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1 Name, IPv4Connectivity, InterfaceAlias; "network:" + $p.Name + ";via:" + $p.InterfaceAlias + ";internet:" + $p.IPv4Connectivity`;
export function parseInternet(out: string): { network: string; via: string; online: boolean } {
  return { network: /network:([^;\n]*)/.exec(out)?.[1]?.trim() ?? "", via: /via:([^;\n]*)/.exec(out)?.[1]?.trim() ?? "", online: /internet:Internet/.test(out) };
}

// ---------- Printers ----------

export const PRINTERS_READ = `Get-CimInstance Win32_Printer | ForEach-Object { $n = $_.Name; $jobs = @(Get-PrintJob -PrinterName $n -ErrorAction SilentlyContinue); [pscustomobject]@{ name = $n; isDefault = [bool]$_.Default; offline = [bool]$_.WorkOffline; status = [int]$_.PrinterStatus; state = [int]$_.PrinterState; jobs = $jobs.Count; stuck = @($jobs | Where-Object { $_.JobStatus -match 'Error|Paused|Blocked|Offline|Deleting' -or $_.SubmittedTime -lt (Get-Date).AddMinutes(-10) }).Count; virtual = ($n -match 'PDF|XPS|OneNote|Fax') } } | ConvertTo-Json -Compress`;

export interface WinPrinter {
  name: string;
  isDefault: boolean;
  offline: boolean;
  /** Win32_Printer.PrinterStatus: 3 = idle, 4 = printing, 5 = warming up, 7 = offline. */
  status: number;
  /** Win32_Printer.PrinterState bit flags: 1 = paused, 2 = error, 128 = offline, 8 = paper jam, 16 = out of paper. */
  state: number;
  jobs: number;
  stuck: number;
  virtual: boolean;
}

export function printerProblems(p: WinPrinter): string[] {
  const out: string[] = [];
  if (p.state & 1) out.push("paused");
  if (p.offline || p.status === 7 || p.state & 128) out.push("offline");
  if (p.state & 8) out.push("paper jam");
  if (p.state & 16) out.push("out of paper");
  if (p.state & 2 && !(p.state & 8) && !(p.state & 16)) out.push("has an error");
  if (p.stuck > 0) out.push(`${p.stuck} stuck print job${p.stuck === 1 ? "" : "s"}`);
  return out;
}

/** Only real names: letters, digits, spaces and a few marks. Anything else isn't a printer we found. */
export function safePrinterName(name: string): boolean {
  return /^[\w .,()&+#@\-\\/]{1,120}$/.test(name);
}

export function printerFixCommand(name: string, fix: "resume" | "online" | "clear-jobs" | "test-page"): string {
  const n = psQuote(name);
  const printer = `(Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq ${n} })`;
  if (fix === "clear-jobs") return `Get-PrintJob -PrinterName ${n} | Remove-PrintJob; "jobs left:" + @(Get-PrintJob -PrinterName ${n}).Count`;
  if (fix === "resume") return `${printer} | Invoke-CimMethod -MethodName Resume | Out-Null; "state:" + ${printer}.PrinterState`;
  if (fix === "online") return `${printer} | Set-CimInstance -Property @{ WorkOffline = $false }; "offline:" + ${printer}.WorkOffline`;
  return `${printer} | Invoke-CimMethod -MethodName PrintTestPage | Select-Object -ExpandProperty ReturnValue`;
}

// ---------- Disk ----------

export const DISK_READ = `Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and ($_.Used + $_.Free) -gt 0 } | ForEach-Object { $_.Name + ": " + [math]::Round($_.Free / 1GB, 1) + " GB free of " + [math]::Round(($_.Used + $_.Free) / 1GB, 1) + " GB" }`;

// ---------- Settings pages (ms-settings: links open the exact page) ----------

export const SETTINGS_PAGE = /^ms-settings:[A-Za-z0-9\-_]+(\?[A-Za-z0-9=&%._-]*)?$/;

export const SETTINGS_PAGES: Record<string, string> = {
  display: "ms-settings:display",
  sound: "ms-settings:sound",
  notifications: "ms-settings:notifications",
  bluetooth: "ms-settings:bluetooth",
  wifi: "ms-settings:network-wifi",
  network: "ms-settings:network",
  printers: "ms-settings:printers",
  colors: "ms-settings:colors",
  wallpaper: "ms-settings:personalization-background",
  text_size: "ms-settings:easeofaccess-display",
  mouse_pointer: "ms-settings:easeofaccess-mousepointer",
  apps: "ms-settings:appsfeatures",
  windows_update: "ms-settings:windowsupdate",
  camera_privacy: "ms-settings:privacy-webcam",
  microphone_privacy: "ms-settings:privacy-microphone",
  date_time: "ms-settings:dateandtime",
  storage: "ms-settings:storagesense",
  power: "ms-settings:powersleep",
};

/** Opens a link, page or file the Windows way. Only for things our code checked. */
export function startCommand(target: string): string {
  return `Start-Process ${psQuote(target)}`;
}
