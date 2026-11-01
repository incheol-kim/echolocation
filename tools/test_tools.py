import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The original performance files are not in the repository. Put them in media/ or point ECHO_MIDI / ECHO_WAV / ECHO_MP3
# at them; the tests that need them are skipped otherwise.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIDI = os.environ.get("ECHO_MIDI") or os.path.join(ROOT, "media", "echolocation.mid")
WAV = os.environ.get("ECHO_WAV") or os.path.join(ROOT, "media", "echolocation.wav")
MP3 = os.environ.get("ECHO_MP3") or os.path.join(ROOT, "media", "echolocation.mp3")


@unittest.skipUnless(os.path.exists(MIDI), "original MIDI not present: " + MIDI)
class TestMidi(unittest.TestCase):
    def test_midi_track1(self):
        from parse_midi import parse_midi
        r = parse_midi(MIDI, track=1)
        notes = r["notes"]
        self.assertEqual(len(notes), 1605)
        t, pitch, vel, dur = notes[0]
        self.assertAlmostEqual(t, 1.267, places=2)
        self.assertEqual((pitch, vel), (81, 94))
        self.assertGreater(dur, 0)
        self.assertAlmostEqual(notes[-1][0], 346.92, places=1)
        self.assertGreater(len(r["pedal"]), 0)


@unittest.skipUnless(os.path.exists(WAV), "original WAV not present: " + WAV)
class TestAudio(unittest.TestCase):
    def test_audio_shape(self):
        from analyze_audio import analyze_audio
        r = analyze_audio(WAV, fps=30)
        for k in ("env", "low", "high"):
            v = r[k]
            self.assertLessEqual(abs(len(v) - 10650), 1, k)
            self.assertTrue(all(0 <= x <= 1000 for x in v), k)
            self.assertEqual(max(v), 1000, k)


if __name__ == "__main__":
    unittest.main()
