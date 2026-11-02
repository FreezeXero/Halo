// Safety rules for PowerShell, the Windows side of core/risk.ts. Code decides, not the AI.
// "safe" only for commands that just read. "blocked" for anything that deletes for good, hides what it runs, downloads
// and runs code, weakens the PC's protection, or adds a way in. Everything else that changes the PC is "ask".
import type { Assessment, Finding, RiskLevel } from "../core/types.js";
import { RISK_ORDER } from "../core/types.js";

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/;

/** Commands (cmdlets and programs) that only read. Anything not listed is treated as a change. */
const READ_COMMANDS = new Set([
  "where-object", "where", "?", "select-object", "select", "sort-object", "sort", "measure-object", "measure", "group-object", "group",
  "format-list", "fl", "format-table", "ft", "format-wide", "out-string", "convertto-json", "convertfrom-json", "convertto-csv",
  "foreach-object", "foreach", "%", "select-string", "test-path", "resolve-path", "split-path", "join-path", "write-output", "echo",
  "ipconfig", "systeminfo", "whoami", "hostname", "tasklist", "driverquery", "getmac", "where.exe", "ver", "winget", "netsh", "powercfg",
  // Language keywords: they only shape the script; what runs inside them is checked on its own.
  "if", "else", "elseif", "foreach", "for", "while", "do", "switch", "try", "catch", "finally", "return", "exit", "in",
]);
/** Get-* cmdlets read, except a few that reach out to the internet. */
const NETWORK_GETS = new Set(["get-content"]); // Get-Content can read any file, which is fine; listed so the rule is explicit.

/** Programs that read only with certain words. */
function externalReadOnly(cmd: string, segment: string): boolean {
  if (cmd === "ipconfig") return !/\/(release|renew|flushdns|registerdns)/i.test(segment);
  if (cmd === "winget") return /^\s*winget(\.exe)?\s+(list|search|show|--version|-v)\b/i.test(segment);
  if (cmd === "netsh") return /\bshow\b/i.test(segment) && !/\b(set|add|delete|reset|connect|disconnect)\b/i.test(segment);
  if (cmd === "powercfg") return /\/(list|l|query|q|getactivescheme|a|batteryreport)\b/i.test(segment) && !/\/(setactive|change|delete|import|hibernate)/i.test(segment);
  return true;
}

interface Rule {
  rule: string;
  level: RiskLevel;
  test: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  { rule: "runs-text-as-code", level: "blocked", test: /\b(invoke-expression|iex)\b|\[scriptblock\]::create/i, reason: "It runs text as code, which hides what it really does." },
  { rule: "encoded-command", level: "blocked", test: /(^|\s)-e(n|nc|nco|ncod|ncode|ncoded|ncodedcommand)?\s+[A-Za-z0-9+/=]{16,}|frombase64string/i, reason: "It hides the real command in scrambled (encoded) text." },
  { rule: "download-and-run", level: "blocked", test: /(downloadstring|downloadfile|invoke-webrequest|\biwr\b|invoke-restmethod|\birm\b|start-bitstransfer|bitsadmin|certutil[^;|\n]*-urlcache|\bcurl(\.exe)?\b|\bwget\b)[^\n]*(\|\s*(powershell|pwsh|cmd)|\bstart-process\b|&\s*\$|\.ps1\b|\.exe\b|\.bat\b|\.cmd\b|\.msi\b)/i, reason: "It downloads something from the internet and runs it." },
  { rule: "deletes-for-good", level: "blocked", test: /\b(remove-item|rm|rmdir|rd|del|erase|ri)\b|\.delete\s*\(|\[system\.io\.(file|directory)\]::delete/i, reason: "It deletes for good. Halo only ever moves things to the Recycle Bin, so they can come back." },
  { rule: "erase-disk", level: "blocked", test: /\b(format-volume|clear-disk|initialize-disk|remove-partition|diskpart|format(\.com)?\s+[a-z]:)/i, reason: "It erases a disk." },
  { rule: "boot-or-backups", level: "blocked", test: /\bbcdedit\b|\bvssadmin\b[^\n]*\bdelete\b|\bwbadmin\b[^\n]*\bdelete\b|\bcipher(\.exe)?\b[^\n]*\/w/i, reason: "It changes how Windows starts or deletes its backups." },
  { rule: "disable-defender", level: "blocked", test: /set-mppreference\b[^\n]*-disable\w*\s+(\$true|1)|add-mppreference\b[^\n]*-exclusion|\b(sc(\.exe)?\s+(stop|config)|stop-service|set-service)\b[^\n]*windefend|uninstall-windowsfeature[^\n]*defender/i, reason: "It turns off Windows Security (antivirus) or hides files from it." },
  { rule: "firewall-off", level: "blocked", test: /set-netfirewallprofile\b[^\n]*-enabled\s+(false|\$false|0)|netsh\s+(advfirewall|firewall)\b[^\n]*\b(state\s+off|opmode\s+disable)/i, reason: "It turns off the firewall." },
  { rule: "remote-access", level: "blocked", test: /enable-psremoting|\bwinrm\b|set-item\s+wsman:|fdenytsconnections|new-netfirewallrule\b[^\n]*-action\s+allow|\bnet\s+share\b[^\n]*=/i, reason: "It lets other computers get into this PC." },
  { rule: "new-account", level: "blocked", test: /\bnet\s+(user|localgroup)\b[^\n]*\/add|new-localuser|add-localgroupmember/i, reason: "It adds a user account or gives an account more power." },
  { rule: "execution-policy", level: "blocked", test: /set-executionpolicy\b[^\n]*\b(unrestricted|bypass)\b/i, reason: "It lets any script run on this PC from now on." },
  { rule: "lolbins", level: "blocked", test: /\bmshta\b|\brundll32\b[^\n]*(javascript|http)|\bregsvr32\b[^\n]*\/i:\s*http|\bwmic\b[^\n]*process\s+call\s+create|\bmsiexec\b[^\n]*https?:/i, reason: "It uses a known trick to run code from the internet." },
  { rule: "runs-at-startup", level: "blocked", test: /schtasks\b[^\n]*\/create|register-scheduledtask|new-service\b|\bsc(\.exe)?\s+create\b|\\currentversion\\run\b/i, reason: "It makes something run by itself every time the PC starts." },
  { rule: "registry-delete", level: "blocked", test: /\breg(\.exe)?\s+delete\b|remove-itemproperty\b[^\n]*hk(lm|ey_local_machine)/i, reason: "It deletes system settings from the registry." },
  { rule: "admin", level: "ask", test: /-verb\s+runas|\bhk(lm|ey_local_machine)\b|\brestart-service\b|\bset-service\b/i, reason: "It needs administrator access." },
  { rule: "restart", level: "ask", test: /\b(stop-computer|restart-computer)\b|\bshutdown(\.exe)?\s/i, reason: "It restarts or shuts down the PC." },
  { rule: "close-apps", level: "ask", test: /\b(stop-process|taskkill|kill|spps)\b/i, reason: "It closes programs, and unsaved work in them could be lost." },
  { rule: "download", level: "ask", test: /downloadstring|downloadfile|invoke-webrequest|\biwr\b|invoke-restmethod|\birm\b|start-bitstransfer|\bcurl(\.exe)?\b|\bwget\b/i, reason: "It downloads something from the internet." },
];

/** The first word of each command in a script: after the start, a pipe, a semicolon, a brace, a bracket or `&&`. */
export function commandWords(script: string): { word: string; segment: string }[] {
  const out: { word: string; segment: string }[] = [];
  const segments = script.split(/\r?\n|;|\|\|?|&&|\{|\}|\(|\)/);
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg || seg.startsWith("#")) continue;
    // A segment that starts with $var, [Type], a quoted string, a number, @() or an operator doesn't run anything by itself.
    // Anything else is a command: a cmdlet, a keyword, or a program by path (C:\\x.exe, .\\x.ps1), which is never read-only.
    const m = /^(&|\.(?=\s))?\s*([^\s$[\]'"@0-9(\-=+!,][^\s'"]*)/.exec(seg);
    if (!m) continue;
    out.push({ word: (m[1] ? m[1] : "") + m[2].toLowerCase(), segment: seg });
  }
  return out;
}

/** True when nothing in the script writes, calls a changing method, or runs a command that isn't on the read list. */
export function readsOnly(script: string): boolean {
  if (/(^|[^-])>{1,2}(?!\s*\$null)/.test(script.replace(/-gt|-ge|-lt|-le/gi, ""))) return false; // redirecting into a file
  if (/\]::\w+\s*=[^=]|\.\s*(delete|kill|remove\w*|set\w*|invoke\w*|start|stop|close|write\w*|create\w*|move\w*|copy\w*|rename\w*|clear\w*|reset\w*|add\w*|put\w*|save\w*|execute\w*|enable\w*|disable\w*)\s*\(/i.test(script)) return false;
  if (/(^|[\s;|{(])(&|\.)\s*[$'"]/.test(script)) return false; // & $x, . 'file.ps1': runs something by name
  // Calling into .NET directly ([System.IO.File]::WriteAllText(...)) can do anything. Only plain maths, text and dates read.
  for (const m of script.matchAll(/\[([\w.]+)\]::(\w+)\s*\(/g)) {
    if (!/^(system\.)?(math|string|datetime|timespan|convert|int|int32|int64|double|char|regex|guid)$/i.test(m[1])) return false;
  }
  for (const { word, segment } of commandWords(script)) {
    if (word.startsWith("&") || word.startsWith(".")) return false;
    if (word.startsWith("get-") || NETWORK_GETS.has(word)) continue;
    if (!READ_COMMANDS.has(word) && !READ_COMMANDS.has(word.replace(/\.exe$/, ""))) return false;
    if (!externalReadOnly(word.replace(/\.exe$/, ""), segment)) return false;
  }
  return true;
}

export function assessPowerShell(raw: string): Assessment & { reasons: string[] } {
  const findings: Finding[] = [];
  if (INVISIBLE.test(raw)) findings.push({ rule: "invisible-characters", level: "blocked", reason: "The command contains invisible characters. This is a trick to hide extra code inside something that looks harmless." });
  const text = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').trim();
  if (!text) return { level: "safe", findings: [], readOnly: true, reasons: [] };
  for (const r of RULES) if (r.test.test(text)) findings.push({ rule: r.rule, level: r.level, reason: r.reason });
  // The "download" ask is covered by "download-and-run" when both match.
  if (findings.some((f) => f.rule === "download-and-run")) findings.splice(findings.findIndex((f) => f.rule === "download"), findings.some((f) => f.rule === "download") ? 1 : 0);
  const readOnly = findings.length === 0 && readsOnly(text);
  if (!readOnly && findings.length === 0) findings.push({ rule: "changes-something", level: "ask", reason: "It changes something on this PC." });
  const level = findings.reduce<RiskLevel>((acc, f) => (RISK_ORDER[f.level] > RISK_ORDER[acc] ? f.level : acc), "safe");
  return { level, findings, readOnly, reasons: findings.map((f) => f.reason) };
}
