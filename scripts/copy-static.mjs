// Copies the app's HTML, CSS and plain JS files next to the compiled code.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/app/ui", { recursive: true });
cpSync("src/app/ui", "dist/app/ui", { recursive: true });
cpSync("src/app/preload.cjs", "dist/app/preload.cjs");
// The Windows screen helper (PowerShell, run as a file).
mkdirSync("dist/win", { recursive: true });
cpSync("src/win/ui-elements.ps1", "dist/win/ui-elements.ps1");
console.log("Copied app UI files to dist/app");
