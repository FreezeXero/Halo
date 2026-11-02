# Handoff: make Stride actually do the work, and run on Windows

This file is for the next person (or Claude Code) picking this up. It explains what changed on the branch
`feat/do-it-and-windows`, what was checked, what wasn't, and what's left. Read it fully before changing anything.

## Ground rules

- **Do not push to `Bn0717/CalHacks-13.0` (the team's repo) or open PRs there** unless Rafay (Freeze) says so. This copy is his to work on.
- Keep Stride's safety model: code decides what's safe, not the AI. No permanent deletes (Trash / Recycle Bin only). Passwords,
  payments, permission prompts, sign-in and personal choices (like which wallpaper) stay with the person. Every change gets a read-back.
- Plain words in anything the person sees. No em dashes in user-facing text.
- Run `npm run typecheck` and `npm test` before every commit.

## The problem we were fixing

1. **Stride made the person do too much.** It would make a plan, then hand steps back ("now you click X") instead of doing them.
2. **It only worked on macOS.** About 27 source files call Mac-only things (AppleScript, Swift helpers, `networksetup`, `lpstat`, `sandbox-exec`, Homebrew).

## Part 1: "do it, don't hand it back" (Mac and Windows) — commit `c5803c6`

Root causes found and fixed:

| Where | What it did | Now |
|---|---|---|
| `src/agent/autopilot.ts` (screenshot route) | Gave up on the **first** failed click, and after 3 looks where nothing changed. Then the whole step went to the person. | Retries: up to 3 misses in a row; when clicks change nothing it tells the next look "try a different control" (twice) before giving up; one retry on a model error; 20 actions instead of 12. |
| `src/agent/ui-safety.ts` (screen rules for the AI) | "If you are unsure which control is right, make it handling person." | Unsure on an ordinary screen → pick the best match and try; you'll see the result. Only secrets, permissions, sign-in, payment, terms and personal choices go to the person. |
| `src/agent/tools.ts` `finishOnScreen` | One autopilot attempt, then the person. | A second, fresh attempt (with what went wrong) before anything is handed back. |
| `src/agent/uipilot.ts` (fast route by button names) | 8 rounds. | 12 rounds. |
| `src/agent/agent.ts` system prompt | Said "open Settings then guide_person" for text/pointer size even though `change_setting` does them. No "keep going" rule. | `change_setting` first; new rule 4: keep going, take the next route when one fails, never end with steps for the person except the private kinds. |
| `src/agent/agent.ts` budget | 14 turns (+2 per plan step, max +16), effort `low`. | 20 turns (+3 per step, max +30), effort `medium` (override with `CALHACK_AGENT_EFFORT`). |
| `src/agent/agent.ts` `handedBack()` self-check | Only caught check-in links/forms, only after an approved plan. | Also catches settings/apps/clicks left to the person ("Next, open Settings and turn on dark mode"), with or without a plan, but never passwords, permissions, payments or choices. One nudge per run. |

Tests added in `tests/autopilot.test.ts` and `tests/selfcheck.test.ts`.

## Part 2: Windows support — commit right after `c5803c6` on the same branch

### How it's wired

- `src/platform.ts`: `isWindows()`. `CALHACK_PLATFORM=windows|mac` overrides it (tests use this).
- `src/win/` is the Windows layer:
  - `ps.ts`: runs Windows PowerShell 5.1 (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass`), `psQuote`, JSON parsing. `runPowerShellReadOnly` is the stand-in for macOS's read-only sandbox: it only runs scripts `win/risk.ts` says just read.
  - `risk.ts`: PowerShell safety rules (blocked: iex/encoded commands, download-and-run, any delete, disk erase, bcdedit, Defender/firewall off, remote access, new accounts, execution policy, LOLBins, startup persistence, registry deletes; ask: admin, restart, closing apps, downloads, any other change). `readsOnly()` allowlists Get-* and a few programs.
  - `system.ts`: fixed scripts with read-backs: dark mode (registry Personalize), volume/mute (Core Audio via C# `Add-Type`), pointer size (CursorSize + CursorBaseSize + `SystemParametersInfo(SPI_SETCURSORS)`), text-size read-back (TextScaleFactor), Wi-Fi/Bluetooth radios (`Windows.Devices.Radios`, no admin), internet check, printers (`Win32_Printer` + `Get-PrintJob`: resume, back online, clear stuck jobs), disk, `ms-settings:` pages.
  - `apps.ts`: installed apps = Start menu shortcuts (sync, like the Mac's /Applications), running apps, quit / force quit via the shortcut's target, open, reveal, **installs with winget** (known ids + exact-name fallback), file search in the person's folders.
  - `ui-elements.ps1` + `ui.ts`: the Windows twin of `src/mac/ui-elements.swift`. UI Automation: `list` the front window's buttons/rows/switches/sliders/fields (roles mapped to Mac AX names so the same prompts work), `act` (invoke/toggle/select/expand/slider step/click), `type` (never into password boxes), `closesheet` (Done/OK/Cancel only). Plus raw mouse/keys (`SetCursorPos`/`mouse_event`, SendKeys) for the screenshot route. DPI aware.
  - `deps.ts`: `realWindows()`, same shape as `realMac()` (`MacDeps`).
  - `tools.ts`: `windowsTools()` = the Mac tool list with Windows versions swapped in (sound_status, disk_usage, run_check, check_problem, open_settings, set_volume, change_setting, set_wifi, set_bluetooth, fix_problem, install_app, run_command, set_sound_output, add_calendar_event) and Mac-only ones dropped (move_app_to_trash, start_call). Shared tools (guide_person, propose_plan, finish, ask_person, check_screen, files...) are reused.
- `src/agent/agent.ts`: picks `windowsTools()` and `windowsSystem(SYSTEM)` (the same prompt with Windows names + a short "On Windows" section) when `isWindows()`.
- `src/agent/tools.ts`: new platform helpers `openCommand`, `activateCommand`, `settingsLink`, `settingsAppName`; used by guide_person, finishOnScreen, open_website, join_meeting.
- `src/agent/autopilot.ts`: `actionCommand` builds Windows click/type/key commands on Windows.
- `src/app/main.ts`: hotkey `Ctrl+Alt+D` on Windows; `computer()` picks `realWindows`/`realMac`; on Windows every request goes to the agent (the older step-by-step "instructions" route runs bash and is skipped); mic permission prompt is Mac-only; **on Windows `execute` runs commands itself, not through Droid** (set `CALHACK_WIN_DROID=1` to try Droid once someone confirms Droid's shell on Windows is PowerShell).
- `src/core/exec.ts`: `runSandboxed`/`runNormally` go to PowerShell on Windows. `src/core/probe.ts`: Windows environment. `src/mac/front.ts`: front app on Windows. `src/mac/capture.ts`: helper skipped off macOS (Stride's windows hide from captures with content protection instead). `src/agent/webform.ts`: Edge/Chrome paths on Windows. Voice: whisper-cli.exe paths, Kokoro venv `Scripts\python.exe`, `npm run voice:heart:setup:win`.
- `scripts/copy-static.mjs` copies `ui-elements.ps1` into `dist/win`.
- Tests: `tests/windows.test.ts` (22 tests: risk rules, script builders, parsers, tool list, prompt, click/key commands).

### What was checked

- `npm run typecheck` passes; `npm run build` passes.
- `npm test`: everything passes except **4 tests that only pass on a real Mac** (`agent.test.ts` "opens apps directly…", three in `plan.test.ts` that need `sandbox-exec`). They failed before these changes too.

### What was NOT checked (do this first on a real Windows PC)

**None of the Windows code has run on Windows yet.** It was written on Linux. The PowerShell couldn't even be syntax-checked
there. Expect small fixes. Most likely trouble spots, in order:

1. `src/win/ui-elements.ps1`: run `powershell -ExecutionPolicy Bypass -File src\win\ui-elements.ps1 list` with Settings open. Check it prints JSON with items, roles and frames; then try `act`.
2. Volume (`system.ts` `VOLUME_READ`/`volumeSet`): the Core Audio C# snippet.
3. Radios (`radioCommand`): the WinRT `Await` helper in Windows PowerShell 5.1.
4. Pointer size: does the pointer actually resize live after `SPI_SETCURSORS`? If not, route it through Settings like text size.
5. Text size and Do not disturb go through the Settings app with the autopilot (`onSettingsScreen` in `win/tools.ts`). Check the window is found by the name `SystemSettings` (`settingsAppName()`), and DND's switch is found by name on Windows 11.
6. Calendar: Outlook COM first, `.ics` + "press Save" fallback.
7. Coordinates: screenshots come from Electron in DIPs; clicks scale by `GetDpiForSystem()/96`. Check on a 125%/150% scaled display.
8. `frontAppName()` on Windows, and that Stride skips its own window (`STRIDE_PID`).

### What's left (suggested order)

1. Run it on Windows and fix whatever the checks above turn up. Add a `scripts/windows-smoke.ps1` that exercises each script read-only.
2. Windows setup section in README (Node 22, `npm install`, `.env`, `npm start`, winget, voice setup).
3. Uninstalling apps on Windows (winget uninstall, with a confirm, since it isn't undoable like the Trash).
4. Sound output switching by command (needs the undocumented IPolicyConfig COM interface; today it clicks through Settings).
5. Decide about Droid on Windows (`CALHACK_WIN_DROID`), then route sensitive commands through it like on the Mac.
6. The older "instructions" route (`instructionsFlow`, bash plans, `core/risk.ts`) is Mac-only; on Windows the agent handles everything. Fine for now.
7. Browser page text/links on Windows (`browserUrl`, `pageLinks` use AppleScript): without them the agent works from the screenshot.

## Running it

```bash
npm install
cp .env.example .env    # then add ANTHROPIC_API_KEY (and FACTORY_API_KEY / TYPESAFE_API_KEY if you have them)
npm run typecheck && npm test
npm start               # builds and opens the app
```

Hotkey: `⌃⌥⌘D` on Mac, `Ctrl+Alt+D` on Windows (`CALHACK_HOTKEY` to change it). Debug logs: `CALHACK_DEBUG=1`.
Never put API keys in code, commits, screenshots or chat.
