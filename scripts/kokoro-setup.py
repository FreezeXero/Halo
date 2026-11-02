"""Run after creating .kokoro and installing kokoro-onnx and soundfile."""
import os
from pathlib import Path
import subprocess

# Windows 10 and 11 ship curl in System32; macOS has it in /usr/bin.
curl = str(Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32" / "curl.exe") if os.name == "nt" else "/usr/bin/curl"

root = Path(__file__).resolve().parent.parent / ".kokoro"
root.mkdir(exist_ok=True)
base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
    target = root / name
    if target.exists():
        continue
    print(f"Downloading {name}…", flush=True)
    temporary = target.with_suffix(".part")
    subprocess.run([curl, "--fail", "--location", "--retry", "3", "--proto", "=https", "--proto-redir", "=https", "--output", str(temporary), base + name], check=True)
    temporary.replace(target)
print("Kokoro Heart is ready.")
