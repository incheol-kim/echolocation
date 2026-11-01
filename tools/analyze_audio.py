"""Loudness envelope and low/high band energy of a 24-bit stereo WAV.

Output values are 0..1000 per frame (fps frames per second): a dB-mapped
RMS where the loudest frame of each band is 1000 and -50 dB below it is 0.
"""
import array
import math
import wave

FLOOR_DB = 50.0


def _mono_12k(path):
    w = wave.open(path)
    nch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    if nch != 2 or sw != 3:
        raise ValueError("expected 24-bit stereo")
    raw = w.readframes(n)
    b = bytearray(len(raw) // 3 * 2)
    b[0::2] = raw[1::3]
    b[1::2] = raw[2::3]
    a = array.array("h")
    a.frombytes(bytes(b))
    del raw, b
    # 8 interleaved int16 values = 4 stereo frames -> one decimated sample
    s = [a[i::8] for i in range(8)]
    m = len(s[7])
    mono = [(s[0][k] + s[1][k] + s[2][k] + s[3][k] + s[4][k] + s[5][k] + s[6][k] + s[7][k]) * (1 / 8)
            for k in range(m)]
    return mono, sr / 4.0, n / sr


def _onepole(x, fc, sr, high=False):
    a = 1.0 - math.exp(-2 * math.pi * fc / sr)
    y = 0.0
    out = [0.0] * len(x)
    for i, v in enumerate(x):
        y += a * (v - y)
        out[i] = v - y if high else y
    return out


def _frames(x, hop, nframes):
    out = []
    for f in range(nframes):
        seg = x[f * hop:(f + 1) * hop]
        if not seg:
            out.append(0.0)
            continue
        out.append(math.sqrt(sum(v * v for v in seg) / len(seg)))
    return out


def _to_scale(rms):
    mx = max(rms) or 1.0
    res = []
    for r in rms:
        db = 20 * math.log10(max(r / mx, 1e-9))
        res.append(int(round(max(0.0, min(1.0, (db + FLOOR_DB) / FLOOR_DB)) * 1000)))
    return res


def analyze_audio(path, fps=30):
    mono, sr, dur = _mono_12k(path)
    hop = int(round(sr / fps))
    nframes = int(round(dur * fps))
    low = _onepole(_onepole(mono, 250, sr), 250, sr)
    high = _onepole(_onepole(mono, 2000, sr, high=True), 2000, sr, high=True)
    return {
        "env": _to_scale(_frames(mono, hop, nframes)),
        "low": _to_scale(_frames(low, hop, nframes)),
        "high": _to_scale(_frames(high, hop, nframes)),
    }
