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

HALO, PERSON = "af_heart", "am_michael"
LINES = {
    "ask": (PERSON, 0.92, "The sound thing is broken. I can't hear Sam."),
    "found": (HALO, 1.0, "Your call is fine. The sound is going to your monitor, which has no speakers."),
    "offer": (HALO, 1.0, "I'll switch it to your laptop speakers. Okay?"),
    "yes": (PERSON, 0.95, "Yes."),
    "done": (HALO, 1.0, "Switched to your laptop speakers. You should hear Sam now."),
}

for name, (voice, speed, text) in LINES.items():
    samples, rate = model.create(text, voice=voice, speed=speed, lang="en-us")
    path = out / f"{name}.mp3"
    sf.write(str(path), samples, rate, format="MP3")
    print(f"{path.name}: {len(samples) / rate:.1f}s")
