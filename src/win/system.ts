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

// ---------- Sound outputs (which device the sound plays on) ----------
// Lists the active outputs with Core Audio, and switches the default with the IPolicyConfig interface Windows' own
// Sound settings use (there is no PowerShell command for it).

const OUTPUTS_TYPE = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct HaloPropKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Sequential)] public struct HaloPropVar { public short vt; short r1, r2, r3; public IntPtr p; public IntPtr p2; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHaloPropStore { int GetCount(out int c); int GetAt(int i, out HaloPropKey k); int GetValue(ref HaloPropKey k, out HaloPropVar v); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHaloVol { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float l, Guid c); int j(); int GetMasterVolumeLevelScalar(out float l); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool b, Guid c); int GetMute(out bool b); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHaloDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int OpenPropertyStore(int access, out IHaloPropStore s); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); int GetState(out int s); }
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHaloCollection { int GetCount(out int c); int Item(int i, out IHaloDevice d); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHaloEnum { int EnumAudioEndpoints(int flow, int mask, out IHaloCollection c); int GetDefaultAudioEndpoint(int flow, int role, out IHaloDevice d); int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IHaloDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class HaloEnumCom { }
[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHaloPolicy { int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j(); int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role); }
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class HaloPolicyCom { }
public static class HaloOutputs {
  static IHaloEnum En() { return (IHaloEnum)new HaloEnumCom(); }
  static string Name(IHaloDevice d) {
    IHaloPropStore s; d.OpenPropertyStore(0, out s);
    var k = new HaloPropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    HaloPropVar v; s.GetValue(ref k, out v);
    return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
  }
  static IHaloVol Vol(IHaloDevice d) { object o; var id = typeof(IHaloVol).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o)); return (IHaloVol)o; }
  public static string List() {
    var e = En(); IHaloDevice def; string defId = "";
    if (e.GetDefaultAudioEndpoint(0, 1, out def) == 0) def.GetId(out defId);
    IHaloCollection c; Marshal.ThrowExceptionForHR(e.EnumAudioEndpoints(0, 1, out c));
    int n; c.GetCount(out n);
    var sb = new System.Text.StringBuilder();
    for (int i = 0; i < n; i++) {
      IHaloDevice d; c.Item(i, out d); string id; d.GetId(out id);
      float lv = -1; bool mu = false; try { var v = Vol(d); v.GetMasterVolumeLevelScalar(out lv); v.GetMute(out mu); } catch {}
      sb.Append("output|" + (id == defId ? "default" : "other") + "|" + id + "|" + (int)Math.Round(lv * 100) + "|" + (mu ? "muted" : "on") + "|" + Name(d) + "\\n");
    }
    return sb.ToString();
  }
  public static void SetDefault(string id) {
    var p = (IHaloPolicy)new HaloPolicyCom();
    for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(p.SetDefaultEndpoint(id, role));
  }
  public static void Unmute(string id, float atLeast) {
    IHaloDevice d; Marshal.ThrowExceptionForHR(En().GetDevice(id, out d));
    var v = Vol(d); v.SetMute(false, Guid.Empty);
    float lv; v.GetMasterVolumeLevelScalar(out lv); if (lv < atLeast) v.SetMasterVolumeLevelScalar(atLeast, Guid.Empty);
  }
}
'@`;

export const OUTPUTS_READ = `${OUTPUTS_TYPE}\n[HaloOutputs]::List()`;

export interface SoundOutput { id: string; name: string; isDefault: boolean; level: number; muted: boolean }

/** A Core Audio endpoint id, e.g. {0.0.0.00000000}.{2049b039-f1cf-46b8-b284-46f1777aaf87}. Anything else is refused. */
export function safeOutputId(id: string): boolean {
  return /^\{[0-9.]+\}\.\{[0-9a-f-]{36}\}$/i.test(id);
}

/** Makes this output the default for everything, unmutes it and brings a near-silent volume up, then lists again. */
export function outputSwitch(id: string, minLevel = 40): string {
  if (!safeOutputId(id)) throw new Error("not a sound output id");
  const quoted = psQuote(id);
  return `${OUTPUTS_TYPE}\n[HaloOutputs]::SetDefault(${quoted})\n[HaloOutputs]::Unmute(${quoted}, ${(Math.max(0, Math.min(100, minLevel)) / 100).toFixed(2)})\n[HaloOutputs]::List()`;
}

export function parseOutputs(out: string): SoundOutput[] {
  return out.split(/\r?\n/).flatMap((line) => {
    const m = /^output\|(default|other)\|([^|]+)\|(-?\d+)\|(muted|on)\|(.*)$/.exec(line.trim());
    return m ? [{ id: m[2], name: m[5].trim(), isDefault: m[1] === "default", level: Number(m[3]), muted: m[4] === "muted" }] : [];
  });
}

/** Outputs that usually have no speakers: a monitor's or TV's sound through the graphics card, or a digital (optical) out. */
export function likelySilent(name: string): boolean {
  return /\b(NVIDIA|AMD) High Definition Audio\b|Intel.*Display Audio|\bHDMI\b|DisplayPort|Digital Output|S\/PDIF|SPDIF/i.test(name);
}

/** Where the sound should go instead: headphones first (the person is probably wearing them), then speakers. */
export function bestOutput(outputs: SoundOutput[]): SoundOutput | null {
  const usable = outputs.filter((o) => !likelySilent(o.name));
  const rank = (o: SoundOutput) => (/headphone|headset|airpods|buds|earphone/i.test(o.name) ? 0 : /speaker/i.test(o.name) ? 1 : 2);
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** What's wrong with the sound, in plain words, and what Halo would switch to. null: nothing wrong it can see. */
export function soundDiagnosis(outputs: SoundOutput[]): { problem: string; target: SoundOutput; switchTo: boolean } | null {
  const current = outputs.find((o) => o.isDefault);
  if (!current) {
    const target = bestOutput(outputs);
    return target ? { problem: "No sound output is chosen", target, switchTo: true } : null;
  }
  if (likelySilent(current.name)) {
    const target = bestOutput(outputs);
    if (target) return { problem: `The sound is going to ${current.name}, which usually has no speakers`, target, switchTo: true };
  }
  if (current.muted) return { problem: `${current.name} is muted`, target: current, switchTo: false };
  if (current.level >= 0 && current.level < 10) return { problem: `${current.name} is turned almost all the way down (${current.level}%)`, target: current, switchTo: false };
  return null;
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
