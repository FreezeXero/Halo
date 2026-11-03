# Halo

**Just say it. Halo does it.**

Halo is an AI that uses your computer for you. Press one key, say what's wrong the way you'd tell a grandkid, and Halo looks at your screen, fixes it, and asks before every change.

It's built for people who would rather not learn computers, and for the families who usually get the phone call.

**Website and interactive demos:** [halodoes.com](https://halodoes.com)

Halo started as **Stride**, built in under 36 hours at Cal Hacks. It now runs on **Windows 11** and **macOS**.

## What it can do

- **"There's no sound"**: finds sound going to a monitor with no speakers, switches it to your headphones or speakers, unmutes, and checks it worked.
- **"My printer stopped working"**: finds a paused printer or stuck print jobs, fixes them, and checks the printer is ready.
- **"Get me ready for my doctor's visit"**: adds it to your calendar, fills in the check-in form for you to submit, sets up Zoom, and joins the call when it's time.
- **"Reload the page" / "go to YouTube" / "search for..."**: runs straight away as a keyboard shortcut, with no AI call.
- **"Look at my screen"**: Halo reads what's in front of you and helps with whatever is there.
- **Scams**: stops fake "verify you're human" pages and tech-support pop-ups before you press anything.
- **"Delete all my files"**: refuses, explains why and offers a safe option instead.

## Safety

These rules live in Halo's code, not its prompt, so a website, an email or a scammer can't talk it out of them.

- Every change is read back to you before it happens.
- Halo never types passwords, never pays for anything, and never handles sign-ins or permission prompts.
- Nothing is deleted for good: files go to the Trash or Recycle Bin.
- Personal choices stay with you.

## How it works

1. **Listen:** you press the shortcut and talk. Speech is turned into text on your computer.
2. **Decide:** simple commands run instantly. Known fixes (sound, printers, settings) use built-in routines that talk to the system directly. Everything else goes to Claude, which plans step by step.
3. **Guard:** our code rates every step. Dangerous steps are refused and risky ones ask you first.
4. **Act:** Halo runs only the steps that passed.
5. **Check:** Halo looks again and tells you what changed. If it can't prove the fix worked, it says so.

## Tech stack

| Part | What we use |
|---|---|
| **App** | Electron + TypeScript on Node.js 22 |
| **Reasoning** | Claude Opus 5.5 (Anthropic SDK) with tool use and prompt caching |
| **Finding buttons** | TypeSafe Jev for on-screen targets, with Claude as the fallback |
| **Hearing** | whisper.cpp, on the device |
| **Speaking** | Kokoro, a natural voice that runs on the device |
| **Windows** | PowerShell and native Windows APIs (Core Audio, printers, Wi-Fi, settings) |
| **Mac** | Swift helpers (Accessibility, ScreenCaptureKit, CoreAudio), AppleScript, and Factory Droid for approved commands |
| **Web forms** | Playwright |
| **Checks** | Zod for every AI answer, shell-quote for command safety |
| **Tests** | Vitest, 650+ tests |

## Setup

You need Node.js 22 or later, on Windows 11 or macOS.

```bash
npm install
```

Copy `.env.example` to `.env` and add your `ANTHROPIC_API_KEY` from console.anthropic.com. The other keys are optional and explained in that file.

Voice (optional, recommended):

```bash
npm run voice:setup
```

Then the natural voice, on Windows:

```bash
npm run voice:heart:setup:win
```

or on a Mac:

```bash
npm run voice:heart:setup
```

## Run

```bash
npm start
```

Press **Ctrl+Alt+D** on Windows or **Ctrl+Option+Cmd+D** on a Mac, then say what you need. On a Mac, allow **Screen Recording**, **Accessibility** and **Automation** the first time, then restart the app.

To try the sound fix on Windows, `npm run demo:break-sound` moves your sound to a silent output and `npm run demo:reset-sound` puts it back.

## Test

```bash
npm test
```

## Learn more

[docs/DETAILS.md](docs/DETAILS.md) covers the safety rules, the Windows layer, the demo script and the benchmarks.
