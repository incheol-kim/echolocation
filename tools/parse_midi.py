"""Read note-on/off and sustain pedal events from a Standard MIDI File.

Times are returned in seconds using the file's tempo map.
"""
import struct


def _vlq(d, i):
    v = 0
    while True:
        b = d[i]
        i += 1
        v = (v << 7) | (b & 0x7F)
        if not b & 0x80:
            return v, i


def _read(path):
    d = open(path, "rb").read()
    if d[:4] != b"MThd":
        raise ValueError("not a MIDI file")
    _fmt, ntr, ppq = struct.unpack(">HHH", d[8:14])
    i = 14
    tracks, tempos = [], []
    for _ in range(ntr):
        if d[i:i + 4] != b"MTrk":
            raise ValueError("bad track chunk")
        ln = struct.unpack(">I", d[i + 4:i + 8])[0]
        j, end, tick, rs, ev = i + 8, i + 8 + ln, 0, None, []
        while j < end:
            dt, j = _vlq(d, j)
            tick += dt
            st = d[j]
            if st == 0xFF:
                typ = d[j + 1]
                ln2, k = _vlq(d, j + 2)
                if typ == 0x51:
                    tempos.append((tick, int.from_bytes(d[k:k + ln2], "big")))
                j = k + ln2
            elif st in (0xF0, 0xF7):
                ln2, k = _vlq(d, j + 1)
                j = k + ln2
            else:
                if st & 0x80:
                    rs = st
                    j += 1
                hi = rs & 0xF0
                n = 1 if hi in (0xC0, 0xD0) else 2
                a = d[j]
                b = d[j + 1] if n == 2 else 0
                j += n
                ev.append((tick, hi, a, b))
        tracks.append(ev)
        i = end
    return ppq, sorted(tempos), tracks


def parse_midi(path, track=1):
    ppq, tempos, tracks = _read(path)
    if not tempos or tempos[0][0] != 0:
        tempos = [(0, 500000)] + tempos

    def sec(tick):
        s, last, us = 0.0, 0, 500000
        for tt, u in tempos:
            if tt > tick:
                break
            s += (tt - last) * us / ppq / 1e6
            last, us = tt, u
        return s + (tick - last) * us / ppq / 1e6

    notes, pedal, open_ = [], [], {}
    for tick, hi, a, b in tracks[track]:
        t = sec(tick)
        if hi == 0x90 and b > 0:
            open_.setdefault(a, []).append(len(notes))
            notes.append([round(t, 4), a, b, 0.0])
        elif hi == 0x80 or (hi == 0x90 and b == 0):
            if open_.get(a):
                idx = open_[a].pop(0)
                notes[idx][3] = round(max(0.01, t - notes[idx][0]), 4)
        elif hi == 0xB0 and a == 64:
            pedal.append([round(t, 4), b])
    for idxs in open_.values():
        for idx in idxs:
            notes[idx][3] = 0.5
    notes.sort(key=lambda n: n[0])
    return {"notes": notes, "pedal": pedal}
