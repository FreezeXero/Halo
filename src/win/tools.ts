// The agent's tools on Windows. Tools that work the same everywhere are shared with the Mac (agent/tools.ts);
// the ones that touch the system are rewritten here with fixed, tested PowerShell and a read-back for every change.
import { addEvidence, finishOnScreen, n, numOrNull, obj, openCommand, s, settingsAppName, str, strOrNull, tail, TOOLS, type AgentTool, type ToolContext } from "../agent/tools.js";
import { parseEvent, whenLabel, type CalendarEvent } from "../mac/calendar.js";
import { linkFor } from "../mac/front.js";
import { psQuote } from "./ps.js";
import { assessPowerShell } from "./risk.js";
import {
  DARK_MODE_READ, darkModeSet, DISK_READ, INTERNET_CHECK, parseDarkMode, parseInternet, parsePointerSize, parseRadio, parseTextScale, parseVolume,
  OUTPUTS_READ, outputSwitch, parseOutputs, soundDiagnosis, type SoundOutput,
  POINTER_SIZE_READ, POINTER_SIZES, pointerSizeSet, printerFixCommand, printerProblems, PRINTERS_READ, radioCommand, safePrinterName,
  SETTINGS_PAGE, SETTINGS_PAGES, TEXT_SCALE_READ, VOLUME_READ, volumeSet, type RadioKind, type WinPrinter,
} from "./system.js";
import { parsePsJson } from "./ps.js";

const onOff = (b: boolean | null) => (b === null ? "Unknown" : b ? "On" : "Off");

// ---------- look ----------

const soundStatus: AgentTool = {
  name: "sound_status",
  kind: "look",
  description: "Check the PC's volume and whether the sound is muted.",
  input_schema: obj({}),
  label: () => "Checking your sound…",
  async run(_input, ctx) {
    const r = await ctx.mac.run(VOLUME_READ);
    const v = parseVolume(r.output);
    const ref = addEvidence(ctx, { kind: "before", command: "read the speakers' volume and mute", code: r.code, output: tail(r.output, 2) });
    if (r.code !== 0 || v.level === null) return `[${ref}] I couldn't read the volume: ${tail(r.output, 2)}`;
    return `[${ref}] Volume ${v.level}%${v.muted ? ", muted" : ", not muted"}.`;
  },
};

const diskUsage: AgentTool = {
  name: "disk_usage",
  kind: "look",
  description: "How much free space each drive has.",
  input_schema: obj({}),
  label: () => "Checking your storage…",
  async run(_input, ctx) {
    const r = await ctx.mac.run(DISK_READ);
    const ref = addEvidence(ctx, { kind: "before", command: "Get-PSDrive (free space)", code: r.code, output: tail(r.output, 6) });
    return `[${ref}] ${r.code === 0 ? tail(r.output, 6) : `I couldn't read it: ${tail(r.output, 2)}`}`;
  },
};

const runCheck: AgentTool = {
  name: "run_check",
  kind: "look",
  description: "Run one read-only PowerShell command to look something up (for example `Get-ComputerInfo -Property OsName,OsVersion`, `Get-PnpDevice -Class Bluetooth`, `Get-Printer`). Halo's safety rules refuse anything that could change the PC.",
  input_schema: obj({ command: str("One read-only PowerShell command") }),
  label: () => "Looking something up…",
  async run(input, ctx) {
    const command = s(input, "command");
    const a = assessPowerShell(command);
    if (!a.readOnly) return `Refused: run_check is only for commands that read (${a.reasons[0] ?? "this one could change something"}).`;
    const r = await ctx.mac.sandboxed(command, 30_000);
    const ref = addEvidence(ctx, { kind: "before", command, code: r.code, output: tail(r.output, 6) });
    return `[${ref}] exit ${r.code}\n${r.output.trim().slice(0, 4000)}`;
  },
};

const checkProblem: AgentTool = {
  name: "check_problem",
  kind: "look",
  description: "Check a common problem with built-in tests: printer (paused, offline, stuck print jobs), internet (connected, which network), sound (muted, very low). Use before fix_problem.",
  input_schema: obj({ problem: { type: "string", enum: ["printer", "internet", "sound"] } }),
  label: (i) => `Checking your ${s(i, "problem")}…`,
  async run(input, ctx) {
    const problem = s(input, "problem");
    if (problem === "printer") {
      const r = await ctx.mac.run(PRINTERS_READ);
      const printers = parsePsJson<WinPrinter>(r.output);
      const real = printers.filter((p) => !p.virtual);
      const lines = real.map((p) => `${p.name}${p.isDefault ? " (default)" : ""}: ${printerProblems(p).join(", ") || "ready"}, ${p.jobs} job(s) waiting`);
      const ref = addEvidence(ctx, { kind: "before", command: "Get-Printer + Get-PrintJob (each printer's state and jobs)", code: r.code, output: lines.join("\n") || tail(r.output, 3) });
      if (r.code !== 0) return `[${ref}] I couldn't read the printers: ${tail(r.output, 2)}`;
      if (!real.length) return `[${ref}] No printer is set up on this PC. To add one, use open_settings with ms-settings:printers, then guide_person with "Add a printer or scanner, then add the printer that shows up".`;
      return `[${ref}] ${lines.join("; ")}`;
    }
    if (problem === "internet") {
      const r = await ctx.mac.run(INTERNET_CHECK);
      const i = parseInternet(r.output);
      const wifi = parseRadio("WiFi", (await ctx.mac.run(radioCommand("WiFi", "status"))).output);
      const ref = addEvidence(ctx, { kind: "before", command: "Get-NetConnectionProfile + Wi-Fi radio", code: r.code, output: `${tail(r.output, 2)}; Wi-Fi radio: ${wifi ?? "unknown"}` });
      if (i.online) return `[${ref}] Connected to the internet through ${i.via || "a network"}${i.network ? ` (${i.network})` : ""}.`;
      return `[${ref}] Not connected to the internet. Wi-Fi is ${wifi ?? "unknown"}${i.network ? `, network "${i.network}" has no internet` : ""}.`;
    }
    const r = await ctx.mac.run(VOLUME_READ);
    const v = parseVolume(r.output);
    const ref = addEvidence(ctx, { kind: "before", command: "read the speakers' volume and mute", code: r.code, output: tail(r.output, 2) });
    const issues = [v.muted ? "muted" : "", v.level !== null && v.level < 15 ? `very low (${v.level}%)` : ""].filter(Boolean);
    return `[${ref}] Sound: ${issues.join(", ") || `fine (${v.level ?? "?"}%)`}.`;
  },
};

// ---------- act ----------

const openSettings: AgentTool = {
  name: "open_settings",
  kind: "act",
  description: `Open Windows Settings at the right page for the person, so they never have to find it. Give an ms-settings: link, e.g. ${Object.entries(SETTINGS_PAGES).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join(", ")}. Use this before guide_person when something on that page has to be clicked.`,
  input_schema: obj({ settings_url: str("An ms-settings: link, e.g. ms-settings:display") }),
  label: () => "Opening Settings…",
  async run(input, ctx) {
    const url = s(input, "settings_url");
    if (!SETTINGS_PAGE.test(url)) return "Refused: that isn't a Windows Settings link (it must look like ms-settings:display).";
    const command = openCommand(url);
    const r = await ctx.mac.run(command);
    let up = false;
    for (let t = 0; t < 8 && r.code === 0 && !up; t++) {
      await new Promise((x) => setTimeout(x, 300));
      up = (await ctx.mac.run(`if (Get-Process -Name ${settingsAppName()} -ErrorAction SilentlyContinue) { 'open' } else { exit 1 }`)).code === 0;
    }
    const ref = addEvidence(ctx, { kind: "after", command, code: up ? 0 : 1, output: up ? "Settings is open" : tail(r.output, 2) || "Settings didn't open" });
    return up ? `[${ref}] Settings is open at ${url}.` : `Couldn't open Settings: ${tail(r.output, 2)}`;
  },
};

const setVolume: AgentTool = {
  name: "set_volume",
  kind: "act",
  description: "Set the speakers' volume (0-100) and/or mute or unmute, then read it back.",
  input_schema: obj({ level: numOrNull("0-100, or null to leave it"), muted: { type: ["boolean", "null"], description: "true to mute, false to unmute, null to leave it" } }),
  label: () => "Changing the volume…",
  async run(input, ctx) {
    const level = n(input, "level");
    const muted = typeof input.muted === "boolean" ? input.muted : null;
    if (level === null && muted === null) return "Nothing to change: give a level or muted.";
    const before = parseVolume((await ctx.mac.run(VOLUME_READ)).output);
    const r = await ctx.mac.run(volumeSet({ level, muted }));
    const after = parseVolume(r.output);
    const ok = r.code === 0 && (level === null || (after.level !== null && Math.abs(after.level - level) <= 1)) && (muted === null || after.muted === muted);
    const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: `set volume${level !== null ? ` ${level}%` : ""}${muted !== null ? (muted ? ", mute" : ", unmute") : ""}`, code: ok ? 0 : 1, output: tail(r.output, 2) });
    const show = (v: { level: number | null; muted: boolean | null }) => (v.level === null ? "Unknown" : `${v.level}%${v.muted ? ", muted" : ""}`);
    ctx.beforeAfter.push({ label: "Sound", before: show(before), after: show(after) });
    return ok ? `[${ref}] Now: ${show(after)}.` : `[${ref}] It didn't change as asked: ${show(after)}. ${tail(r.output, 2)}`;
  },
};

type Change = { ok: boolean; before: string; after: string; proof: string; error?: string };

/** Settings Windows only lets you change in the Settings app: Halo opens the page and does the clicks there itself. */
async function onSettingsScreen(ctx: ToolContext, page: string, instruction: string, readBack: () => Promise<{ value: string; ok: boolean }>, before: string): Promise<Change> {
  if (!ctx.mac.screen) return { ok: false, before, after: before, proof: "", error: "Halo can't see the screen, so it can't click in Settings." };
  const g = await finishOnScreen(ctx, { instruction, settingsUrl: page, noHandoff: true });
  const after = await readBack();
  return { ok: after.ok, before, after: after.value, proof: `${g.by === "calhack" ? "Halo did it in Settings" : "Done in Settings"}; read back: ${after.value}`, error: g.result === "failed" ? g.trail.at(-1) : undefined };
}

export const WIN_SETTINGS: Record<string, { label: string; values: string[]; apply: (ctx: ToolContext, value: string) => Promise<Change> }> = {
  dark_mode: {
    label: "Dark mode",
    values: ["on", "off"],
    apply: async (ctx, v) => {
      const before = parseDarkMode((await ctx.mac.run(DARK_MODE_READ)).output);
      const r = await ctx.mac.run(darkModeSet(v === "on"));
      const after = parseDarkMode((await ctx.mac.run(DARK_MODE_READ)).output);
      return { ok: r.code === 0 && after === (v === "on"), before: onOff(before), after: onOff(after), proof: `Personalize: AppsUseLightTheme reads ${after === null ? "?" : after ? 0 : 1}`, error: r.code ? tail(r.output, 2) : undefined };
    },
  },
  pointer_size: {
    label: "Mouse pointer size",
    values: ["normal", "larger", "large", "extra large"],
    apply: async (ctx, v) => {
      const want = POINTER_SIZES[v] ?? 3;
      const before = parsePointerSize((await ctx.mac.run(POINTER_SIZE_READ)).output);
      const r = await ctx.mac.run(pointerSizeSet(want));
      const after = parsePointerSize((await ctx.mac.run(POINTER_SIZE_READ)).output);
      const show = (x: number | null) => (x === null ? "Unknown" : x <= 1 ? "Normal" : `Size ${x}`);
      return { ok: r.code === 0 && after === want, before: show(before), after: show(after), proof: `Accessibility: CursorSize reads ${after ?? "?"}`, error: r.code ? tail(r.output, 2) : undefined };
    },
  },
  text_size: {
    label: "Text size",
    values: ["larger", "smaller"],
    apply: async (ctx, v) => {
      const read = async () => parseTextScale((await ctx.mac.run(TEXT_SCALE_READ)).output);
      const was = await read();
      const instruction = v === "larger"
        ? "Make the text bigger: move the Text size slider up by about a quarter (to about 125% if it's at 100%), then press Apply"
        : "Make the text smaller: move the Text size slider down by about a quarter, then press Apply";
      return onSettingsScreen(ctx, SETTINGS_PAGES.text_size, instruction, async () => {
        // Windows takes a moment to apply it.
        await new Promise((x) => setTimeout(x, 1500));
        const now = await read();
        return { value: now === null ? "Unknown" : `${now}%`, ok: now !== null && was !== null && (v === "larger" ? now > was : now < was) };
      }, was === null ? "Unknown" : `${was}%`);
    },
  },
  do_not_disturb: {
    label: "Do not disturb",
    values: ["on", "off"],
    apply: async (ctx, v) => {
      // Windows keeps this switch in Settings > System > Notifications (no command for it): read it from the page.
      const readToggle = async () => {
        const w = ctx.mac.ui ? await ctx.mac.ui.list(settingsAppName()).catch(() => null) : null;
        const item = w && !("error" in w) ? w.items.find((i) => /do not disturb/i.test(i.name) && i.value !== undefined) : undefined;
        return item ? (item.value === 1 ? "on" : "off") : null;
      };
      const g = await onSettingsScreen(ctx, SETTINGS_PAGES.notifications, `Turn ${v} the "Do not disturb" switch`, async () => {
        const now = await readToggle();
        return { value: now === null ? "Unknown" : now === "on" ? "On" : "Off", ok: now === v };
      }, "Unknown");
      return { ...g, proof: `"Do not disturb" switch in Settings reads ${g.after}` };
    },
  },
};

const changeSetting: AgentTool = {
  name: "change_setting",
  kind: "act",
  description: `Change a Windows setting yourself, by a tested route, and read it back to prove it took. Settings: ${Object.entries(WIN_SETTINGS).map(([k, v]) => `${k} (${v.values.join("/")})`).join(", ")}. Always use this for these (the person never has to do them). Wallpaper is a personal choice: use open_settings with ms-settings:personalization-background, then guide_person so they pick.`,
  input_schema: obj({ setting: { type: "string", enum: Object.keys(WIN_SETTINGS) }, value: str("One of the values listed for that setting") }),
  label: (i) => `Changing ${(WIN_SETTINGS[s(i, "setting")]?.label ?? "a setting").toLowerCase()}…`,
  async run(input, ctx) {
    const def = WIN_SETTINGS[s(input, "setting")];
    const value = s(input, "value").toLowerCase();
    if (!def) return `Refused: I don't have a tested route for "${s(input, "setting")}". Use open_settings + guide_person instead.`;
    if (!def.values.includes(value)) return `"${value}" isn't one of: ${def.values.join(", ")}.`;
    const r = await def.apply(ctx, value);
    const ref = addEvidence(ctx, { kind: "after", outcome: r.ok ? "passed" : "failed", command: `${def.label}: set to ${value}`, code: r.ok ? 0 : 1, output: r.proof || r.error || "" });
    ctx.beforeAfter.push({ label: def.label, before: r.before, after: r.after });
    return r.ok ? `[${ref}] ${def.label}: ${r.before} → ${r.after} (checked).` : `[${ref}] ${def.label} didn't change${r.error ? `: ${r.error}` : ""}. Try open_settings + guide_person.`;
  },
};

function radioTool(kind: RadioKind, name: string, label: string): AgentTool {
  return {
    name,
    kind: "act",
    description: `Turn ${label} on or off (the same switch as in quick settings), then read it back.${kind === "WiFi" ? " Turning Wi-Fi off cuts Halo off from the internet, so do that only when asked, and last." : ""}`,
    input_schema: obj({ on: { type: "boolean", description: `true to turn ${label} on, false for off` } }),
    label: (i) => `Turning ${label} ${i.on === true ? "on" : "off"}…`,
    async run(input, ctx) {
      const want = input.on === true;
      const was = parseRadio(kind, (await ctx.mac.run(radioCommand(kind, "status"))).output);
      if (was === "none") return `This PC has no ${label} switch Halo can reach.`;
      if (was === (want ? "on" : "off")) {
        const ref = addEvidence(ctx, { kind: "after", outcome: "passed", command: `${label} status`, code: 0, output: `${label} is already ${was}` });
        return `[${ref}] ${label} is already ${was}.`;
      }
      if (kind === "WiFi" && !want) {
        // Without Wi-Fi there's no Claude to finish the run: end it here, with the proof we have.
        const r = await ctx.mac.run(radioCommand(kind, "off"));
        const now = parseRadio(kind, r.output);
        const ref = addEvidence(ctx, { kind: "after", outcome: now === "off" ? "passed" : "failed", command: `${label} off`, code: now === "off" ? 0 : 1, output: tail(r.output, 2) });
        ctx.beforeAfter.push({ label, before: "On", after: now === "off" ? "Off" : "On" });
        ctx.autoFinish = { verdict: now === "off" ? "done" : "cant_do", headline: now === "off" ? "Wi-Fi is off." : "Wi-Fi didn't turn off.", details: now === "off" ? ["Press the Wi-Fi button in quick settings to turn it back on."] : [], proofRefs: [{ ref, shows: `${label} reads ${now}` }] };
        return `[${ref}] ${label}: ${now}.`;
      }
      const r = await ctx.mac.run(radioCommand(kind, want ? "on" : "off"));
      const now = parseRadio(kind, r.output);
      const ok = now === (want ? "on" : "off");
      const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: `${label} ${want ? "on" : "off"}`, code: ok ? 0 : 1, output: tail(r.output, 2) });
      ctx.beforeAfter.push({ label, before: was === "on" ? "On" : "Off", after: now === "on" ? "On" : now === "off" ? "Off" : "Unknown" });
      return ok ? `[${ref}] ${label} is ${now} now (checked).` : `[${ref}] ${label} didn't switch: ${tail(r.output, 2)}`;
    },
  };
}

const fixProblem: AgentTool = {
  name: "fix_problem",
  kind: "act",
  description: "Fix a problem check_problem found, with tested steps, then check again. printer: turns a paused printer back on, brings an offline one back online, and clears stuck print jobs. sound: unmutes and sets the volume to 50%. internet: turns Wi-Fi off and on again. Run check_problem first.",
  input_schema: obj({ problem: { type: "string", enum: ["printer", "internet", "sound"] }, printer_name: strOrNull("For printer: the printer's exact name from check_problem, or null for every printer with a problem") }),
  label: (i) => `Fixing your ${s(i, "problem")}…`,
  async run(input, ctx) {
    const problem = s(input, "problem");
    if (problem === "sound") return setVolume.run({ level: 50, muted: false }, ctx);
    if (problem === "internet") {
      const off = await ctx.mac.run(radioCommand("WiFi", "off"));
      await new Promise((x) => setTimeout(x, 2000));
      const on = await ctx.mac.run(radioCommand("WiFi", "on"));
      let online = false;
      for (let t = 0; t < 10 && !online; t++) {
        await new Promise((x) => setTimeout(x, 1500));
        online = parseInternet((await ctx.mac.run(INTERNET_CHECK)).output).online;
      }
      const ref = addEvidence(ctx, { kind: "after", outcome: online ? "passed" : "failed", command: "Wi-Fi off and on, then check the internet", code: online ? 0 : 1, output: `${tail(off.output, 1)} → ${tail(on.output, 1)}; internet: ${online ? "connected" : "not connected"}` });
      ctx.beforeAfter.push({ label: "Internet", before: "Not connected", after: online ? "Connected" : "Still not connected" });
      return online ? `[${ref}] Wi-Fi restarted and the internet is back (checked).` : `[${ref}] I restarted Wi-Fi, but the internet still isn't back. The router may need turning off and on.`;
    }
    const read = async () => parsePsJson<WinPrinter>((await ctx.mac.run(PRINTERS_READ)).output).filter((p) => !p.virtual);
    const before = await read();
    const only = s(input, "printer_name");
    const targets = before.filter((p) => (only ? p.name === only : printerProblems(p).length > 0));
    if (!targets.length) return only ? `No printer is called "${only}". Use check_problem to see the names.` : "No printer has a problem I can fix. Use check_problem first.";
    const did: string[] = [];
    for (const p of targets) {
      if (!safePrinterName(p.name)) continue;
      if (p.state & 1) did.push(`${p.name}: turn back on → ${tail((await ctx.mac.execute(printerFixCommand(p.name, "resume"))).output, 1)}`);
      if (p.offline) did.push(`${p.name}: back online → ${tail((await ctx.mac.execute(printerFixCommand(p.name, "online"))).output, 1)}`);
      if (p.stuck > 0 || (only && p.jobs > 0)) did.push(`${p.name}: clear stuck jobs → ${tail((await ctx.mac.execute(printerFixCommand(p.name, "clear-jobs"))).output, 1)}`);
    }
    const after = await read();
    const rows = targets.map((p) => {
      const now = after.find((x) => x.name === p.name);
      return { name: p.name, before: printerProblems(p).join(", ") || "Ready", after: now ? printerProblems(now).join(", ") || "Ready" : "Not found" };
    });
    const ok = rows.every((r) => r.after === "Ready");
    for (const r of rows) ctx.beforeAfter.push({ label: r.name, before: r.before, after: r.after });
    const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: "Get-Printer + Get-PrintJob after the fix", code: ok ? 0 : 1, output: rows.map((r) => `${r.name}: ${r.after}`).join("\n") });
    if (did.length) ctx.ui.detail(did.join("\n"), true);
    return ok ? `[${ref}] Fixed: ${rows.map((r) => `${r.name} is ready`).join("; ")} (checked).` : `[${ref}] Still not right: ${rows.map((r) => `${r.name}: ${r.after}`).join("; ")}. If it says paused and won't resume, Windows may need an administrator; if it's a paper jam or out of paper, that's on the printer itself.`;
  },
};

const installApp: AgentTool = {
  name: "install_app",
  kind: "act",
  description: "Make sure an app is installed: checks first, and if it's missing installs it with winget, Windows' own app installer (the maker's installer, checked against its known fingerprint), then checks it's there. Never from download sites. Use this for any 'download/install X' step; opening a download page is not installing.",
  input_schema: obj({ app_name: str("The app's name, e.g. Zoom") }),
  label: (i) => `Checking ${s(i, "app_name")}…`,
  async run(input, ctx) {
    const name = s(input, "app_name");
    if (!name) return "Which app? Give its name.";
    const had = ctx.mac.findApp(name);
    if (had.length) {
      const ref = addEvidence(ctx, { kind: "after", outcome: "passed", command: `check ${name} is installed`, code: 0, output: `${name} is in the Start menu (${had[0]})` });
      ctx.beforeAfter.push({ label: name, before: "Installed", after: "Installed" });
      return `[${ref}] ${name} is already installed, so nothing was downloaded.${/zoom/i.test(name) ? " Zoom updates itself when it opens." : ""}`;
    }
    const ok = ctx.approvedPlan?.length ? true : await ctx.ui.confirm({ title: `Install ${name}?`, message: `I'll install ${name} with Windows' own app installer, from its maker. Windows may ask you to say yes.`, yes: "Yes, install", no: "Not now" });
    if (!ok) return "The person said no. Don't install.";
    ctx.ui.status(`Installing ${name}…`);
    const r = await ctx.mac.installOfficial(name);
    const refs = r.evidence.map((e) => addEvidence(ctx, e));
    if (r.ok) ctx.beforeAfter.push({ label: name, before: "Not installed", after: "Installed" });
    return `[${refs.join(", ")}] ${r.message}`;
  },
};

const runCommand: AgentTool = {
  name: "run_command",
  kind: "act",
  description: "Last resort: run one PowerShell command that changes something, when no other tool can do it. Halo's safety rules check it first: dangerous commands are refused, and anything that changes the PC asks the person. Never use it to delete files (use move_files_to_trash) or to get around a refusal.",
  input_schema: obj({ command: str("One PowerShell command"), plain_description: str("What it does, in plain words for a non-technical person, e.g. 'Restart the printing system'") }),
  label: (i) => `${s(i, "plain_description") || "Running a command"}…`,
  async run(input, ctx) {
    const command = s(input, "command");
    const about = s(input, "plain_description") || "Run this";
    const a = assessPowerShell(command);
    if (a.level === "blocked") return `Refused by Halo's safety rules: ${a.findings.find((f) => f.level === "blocked")?.reason ?? "not safe"}. Don't try another way around it; tell the person why.`;
    if (!a.readOnly) {
      const ok = await ctx.ui.confirm({ title: `${about}?`, message: `This step needs your OK: ${a.reasons.join(" ")}`, details: [command], yes: "Yes, go ahead", no: "No" });
      if (!ok) return "The person said no. Not run.";
    }
    const r = await ctx.mac.execute(command);
    for (const l of r.log ?? []) ctx.ui.detail(l, true);
    const ref = addEvidence(ctx, { kind: "run", command, code: r.code, output: tail(r.output, 4) });
    return `[${ref}] exit ${r.code}\n${r.output.trim().slice(0, 3000)}`;
  },
};

const setSoundOutput: AgentTool = {
  name: "set_sound_output",
  kind: "act",
  description: "Switch where the sound plays (speakers, headphones, a TV) in Settings > Sound, and check it took.",
  input_schema: obj({ output_name: str("Words from the device's name, e.g. 'Speakers' or 'AirPods'") }),
  label: () => "Switching where the sound plays…",
  async run(input, ctx) {
    const want = s(input, "output_name");
    if (!want) return "Which output? Give its name.";
    const g = await finishOnScreen(ctx, { instruction: `In "Choose where to play sound", pick the output called "${want}"`, settingsUrl: SETTINGS_PAGES.sound, noHandoff: true });
    const ref = addEvidence(ctx, { kind: "after", outcome: g.result === "done" ? "passed" : "failed", command: `choose "${want}" in Sound settings`, code: g.result === "done" ? 0 : 1, output: g.trail.slice(-2).join("; ") });
    if (g.result === "done") ctx.beforeAfter.push({ label: "Sound goes to", before: "Something else", after: want });
    return g.result === "done" ? `[${ref}] Sound now plays on "${want}".` : `[${ref}] I couldn't switch it: ${g.trail.at(-1) ?? "it didn't work"}.`;
  },
};

/** An Outlook appointment, read back by its subject and start time. Outlook (desktop) is the calendar most PCs with Office use. */
function startOf(e: CalendarEvent): Date {
  return new Date(e.year, e.month - 1, e.day, e.hour, e.minute);
}

function outlookAddCommand(e: CalendarEvent): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const body = [e.notes, e.url ? `Join: ${e.url}` : ""].filter(Boolean).join("\n");
  return [
    "$o = New-Object -ComObject Outlook.Application",
    `$start = [datetime]::ParseExact(${psQuote(iso(startOf(e)))}, 'yyyy-MM-dd HH:mm', $null)`,
    "$items = $o.GetNamespace('MAPI').GetDefaultFolder(9).Items",
    `$same = @($items | Where-Object { $_.Subject -eq ${psQuote(e.title)} -and $_.Start -eq $start })`,
    "if ($same.Count) { 'exists|' + $same[0].ReminderMinutesBeforeStart; exit 0 }",
    "$a = $o.CreateItem(1)",
    `$a.Subject = ${psQuote(e.title)}`,
    "$a.Start = $start",
    `$a.Duration = ${Math.round(e.durationMinutes)}`,
    `$a.Body = ${psQuote(body)}`,
    e.alertMinutesBefore > 0 ? `$a.ReminderSet = $true; $a.ReminderMinutesBeforeStart = ${Math.round(e.alertMinutesBefore)}` : "$a.ReminderSet = $false",
    "$a.Save()",
    `$check = @($o.GetNamespace('MAPI').GetDefaultFolder(9).Items | Where-Object { $_.Subject -eq ${psQuote(e.title)} -and $_.Start -eq $start })`,
    "if ($check.Count) { 'added|' + $check[0].ReminderMinutesBeforeStart } else { 'missing|'; exit 1 }",
  ].join("\n");
}

const addCalendarEvent: AgentTool = {
  name: "add_calendar_event",
  kind: "act",
  description: "Add an event to the person's calendar (Outlook on this PC; otherwise Halo opens it in their calendar app and saves it), with an alert before it, then read it back. Use for appointments, calls and visits. If the message has a link to join, pass its words as join_link_text. Use the date exactly as written; work out the year from today's date.",
  input_schema: obj({
    title: str("Short title, e.g. 'Video visit with Dr. Priya Patel'"),
    start: str("Local start time on this PC as YYYY-MM-DDTHH:MM, e.g. 2026-10-26T10:00"),
    duration_minutes: numOrNull("Length in minutes; null for 30"),
    alert_minutes_before: numOrNull("Minutes before the start for the alert, e.g. 15; null for no alert"),
    notes: strOrNull("Useful details (appointment number, phone), or null"),
    url: strOrNull("An https link to join, if you know its full address, or null"),
    join_link_text: strOrNull("The words of the message's link to join, e.g. 'Join your visit', or null"),
  }),
  label: () => "Adding it to your calendar…",
  async run(input, ctx) {
    let joinUrl = s(input, "url");
    const linkText = s(input, "join_link_text");
    if (linkText && !joinUrl) joinUrl = linkFor(ctx.messageLinks ?? [], linkText) ?? "";
    const e = parseEvent({ title: s(input, "title"), start: s(input, "start"), durationMinutes: n(input, "duration_minutes"), alertMinutesBefore: n(input, "alert_minutes_before"), notes: s(input, "notes"), url: joinUrl }, ctx.mac.now());
    if ("problem" in e) return `Not added: ${e.problem}`;
    const when = whenLabel(e);
    const outlook = await ctx.mac.run(outlookAddCommand(e));
    const last = outlook.output.trim().split("\n").pop() ?? "";
    if (outlook.code === 0 && /^(added|exists)\|/.test(last)) {
      const alert = Number(last.split("|")[1]);
      const ref = addEvidence(ctx, { kind: "after", outcome: "passed", command: `look up "${e.title}" in Outlook's calendar on ${when}`, code: 0, output: `"${e.title}" is in Outlook on ${when}${Number.isFinite(alert) && alert > 0 ? `, alert ${alert} min before` : ""}` });
      ctx.beforeAfter.push({ label: "Calendar", before: last.startsWith("exists") ? "Already there" : "Not in calendar", after: `${when}${Number.isFinite(alert) && alert > 0 ? `, alert ${alert} min before` : ""}` });
      return `[${ref}] ${last.startsWith("exists") ? "It was already in the calendar" : "Added"}: "${e.title}" on ${when}.`;
    }
    // No Outlook: a calendar file, opened in the person's calendar app, and Halo presses Save there itself.
    const pad = (x: number) => String(x).padStart(2, "0");
    const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const end = new Date(startOf(e).getTime() + e.durationMinutes * 60_000);
    const esc = (t: string) => t.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Halo//EN", "BEGIN:VEVENT", `UID:${Date.now()}@stride`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(startOf(e))}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(e.title)}`,
      ...(e.notes || e.url ? [`DESCRIPTION:${esc([e.notes, e.url ? `Join: ${e.url}` : ""].filter(Boolean).join("\n"))}`] : []), ...(e.url ? [`URL:${e.url}`] : []),
      ...(e.alertMinutesBefore > 0 ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${Math.round(e.alertMinutesBefore)}M`, "END:VALARM"] : []), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const write = `$f = Join-Path $env:TEMP ('stride-event-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.ics'); Set-Content -Path $f -Value ${psQuote(ics)} -Encoding UTF8; Start-Process $f; $f`;
    const w = await ctx.mac.run(write);
    if (w.code !== 0) return `Couldn't add it to the calendar: ${tail(w.output, 2)}`;
    const g = await finishOnScreen(ctx, { instruction: `Save the new event "${e.title}" on ${when} in the calendar (press Save, or Save & close)`, noHandoff: true });
    const ok = g.result === "done";
    const ref = addEvidence(ctx, { kind: "after", outcome: ok ? "passed" : "failed", command: `save "${e.title}" in the calendar app`, code: ok ? 0 : 1, output: g.trail.slice(-2).join("; ") });
    if (ok) ctx.beforeAfter.push({ label: "Calendar", before: "Not in calendar", after: when });
    return ok ? `[${ref}] Added "${e.title}" on ${when} in the calendar app.` : `[${ref}] I opened the event in the calendar app but couldn't save it: ${g.trail.at(-1) ?? ""}`;
  },
};

/** "Headphones (Freeze's AirPods Pro #3)" → "your headphones (Freeze's AirPods Pro #3)": the kind first, as people say it. */
function outputLabel(o: SoundOutput): string {
  const m = /^(.+?)\s*\((.+)\)$/.exec(o.name);
  return m ? `${m[1].toLowerCase()} (${m[2]})` : o.name;
}

const fixSound: AgentTool = {
  name: "fix_sound",
  kind: "act",
  description: "Use FIRST for any sound complaint (\"I can't hear anything\", a call or video is silent, \"the sound thing is broken\"). In one step it finds why: the sound going to a monitor or TV with no speakers, or the output muted or turned almost all the way down. It tells the person what it will change, switches to their headphones or speakers, unmutes, and checks it took.",
  input_schema: obj({}),
  label: () => "Checking where your sound is going…",
  async run(_input, ctx) {
    const read = await ctx.mac.run(OUTPUTS_READ);
    const before = parseOutputs(read.output);
    const ref0 = addEvidence(ctx, { kind: "before", command: "list the sound outputs", code: read.code, output: before.map((o) => `${o.isDefault ? "* " : ""}${o.name} ${o.level}%${o.muted ? " muted" : ""}`).join("; ") || tail(read.output, 2) });
    if (!before.length) return `[${ref0}] I couldn't read the sound outputs: ${tail(read.output, 2)}. Try sound_status and set_volume.`;
    const d = soundDiagnosis(before);
    const current = before.find((o) => o.isDefault);
    if (!d) return `[${ref0}] Nothing looks wrong: sound plays on ${current?.name ?? "the default output"} at ${current?.level ?? "?"}%, not muted. The app itself may be muted, or its own sound setting may point somewhere else.`;
    const ok = await ctx.ui.confirm({
      title: d.switchTo ? `Switch your sound to ${outputLabel(d.target)}?` : "Turn your sound back on?",
      message: `${d.problem}.${d.switchTo ? ` I'll play it on ${outputLabel(d.target)} instead.` : ""}`,
      yes: d.switchTo ? "Yes, switch it" : "Yes, turn it on",
      no: "No, leave it",
    });
    if (!ok) return `[${ref0}] They said no, so nothing changed. Problem found: ${d.problem}.`;
    const r = await ctx.mac.run(outputSwitch(d.target.id));
    const after = parseOutputs(r.output);
    const now = after.find((o) => o.isDefault);
    const worked = r.code === 0 && now?.id === d.target.id && !now.muted && now.level >= 10;
    const ref = addEvidence(ctx, { kind: "after", outcome: worked ? "passed" : "failed", command: `play sound on ${d.target.name}, unmuted`, code: worked ? 0 : 1, output: now ? `${now.name} ${now.level}%${now.muted ? " muted" : ""}` : tail(r.output, 2) });
    ctx.beforeAfter.push({ label: "Sound plays on", before: current ? `${current.name}${current.muted ? ", muted" : ""}` : "Nothing", after: now ? `${now.name}, ${now.level}%` : "Unknown" });
    return worked ? `[${ref}] Fixed: sound now plays on ${now.name} at ${now.level}%, not muted (checked).` : `[${ref}] I tried, but it didn't take: ${tail(r.output, 2)}`;
  },
};

// ---------- the Windows tool list ----------

const OVERRIDES: AgentTool[] = [
  soundStatus, diskUsage, runCheck, checkProblem, openSettings, setVolume, changeSetting,
  radioTool("WiFi", "set_wifi", "Wi-Fi"), radioTool("Bluetooth", "set_bluetooth", "Bluetooth"),
  fixProblem, installApp, runCommand, setSoundOutput, addCalendarEvent,
];

/** Mac-only tools with no Windows version yet: app bundles to the Trash, and FaceTime. */
const MAC_ONLY = new Set(["move_app_to_trash", "start_call"]);

/** The Mac's list, in its order, with Windows versions swapped in and Mac-only tools left out. */
export function windowsTools(base: AgentTool[] = TOOLS): AgentTool[] {
  const byName = new Map(OVERRIDES.map((t) => [t.name, t]));
  // fix_sound is Windows-only; it goes in front of the other sound tools.
  return [fixSound, ...base.filter((t) => !MAC_ONLY.has(t.name)).map((t) => byName.get(t.name) ?? t)];
}
