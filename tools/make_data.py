"""Write data/music.json from the exported MIDI and the mixdown WAV."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_midi import parse_midi
from analyze_audio import analyze_audio
from test_tools import MIDI, WAV

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    m = parse_midi(MIDI, track=1)
    a = analyze_audio(WAV, fps=30)
    out = {"dur": 355.0, "fps": 30, "notes": m["notes"], "pedal": m["pedal"], **a}
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    p = os.path.join(ROOT, "data", "music.json")
    with open(p, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(p, os.path.getsize(p), "bytes,", len(out["notes"]), "notes,", len(out["env"]), "frames")
