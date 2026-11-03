"""Records the landing page demo's spoken lines with Halo's own local voice (Kokoro), into site/audio/.
Run with the Kokoro venv: .kokoro/Scripts/python scripts/site-voice.py (Windows) or .kokoro/bin/python (Mac).
Keep the lines in step with the demo script in site/index.html."""
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).resolve().parent.parent
out = root / "site" / "audio"
out.mkdir(parents=True, exist_ok=True)
model = Kokoro(str(root / ".kokoro" / "kokoro-v1.0.onnx"), str(root / ".kokoro" / "voices-v1.0.bin"))

HALO, PERSON = "af_heart", "am_puck"
LINES = {
    # 1. Sound
    "ask": (PERSON, 0.92, "The sound thing is broken. I can't hear Sam."),
    "found": (HALO, 1.0, "Your call is fine. The sound is going to your monitor, which has no speakers."),
    "offer": (HALO, 1.0, "I'll switch it to your laptop speakers. Okay?"),
    "yes": (PERSON, 0.95, "Yes."),
    "done": (HALO, 1.0, "Switched to your laptop speakers. You should hear Sam now."),
    # 2. Scam
    "scam-ask": (PERSON, 0.92, "This says my computer has a virus, and I have to call them. Should I?"),
    "scam-warn": (HALO, 1.0, "Don't call. This is a scam. Real warnings never ask you to phone a number."),
    "scam-done": (HALO, 1.0, "I closed that page. Your computer is fine, and nothing was installed."),
    # 3. Text size
    "text-ask": (PERSON, 0.92, "I can't read this. The words are too small."),
    "text-offer": (HALO, 1.0, "I'll make the text bigger everywhere on your computer. Okay?"),
    "text-yes": (PERSON, 0.95, "Yes, please."),
    "text-done": (HALO, 1.0, "Done. Everything is bigger now. Tell me if you want it even larger."),
}

for name, (voice, speed, text) in LINES.items():
    samples, rate = model.create(text, voice=voice, speed=speed, lang="en-us")
    path = out / f"{name}.mp3"
    sf.write(str(path), samples, rate, format="MP3")
    print(f"{path.name}: {len(samples) / rate:.1f}s")
