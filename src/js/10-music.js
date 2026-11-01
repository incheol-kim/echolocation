// ---------- music: pre-analysed MIDI notes + WAV envelopes ----------
SR.music = (function () {
  let D = null;
  function init(json) { D = json; }
  function frameVal(arr, t) {
    const f = SR.clamp(t, 0, D.dur) * D.fps, i = Math.floor(f), last = arr.length - 1;
    const a = arr[Math.min(i, last)], b = arr[Math.min(i + 1, last)];
    return (a + (b - a) * (f - i)) / 1000;
  }
  // index of the last note with t0 <= t (or -1)
  function lastIndex(t) {
    const N = D.notes;
    let lo = 0, hi = N.length - 1, r = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (N[mid][0] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return r;
  }
  // notes whose onset lies in (t - life, t], most recent first
  function pulsesAt(t, life = 4.0, max = 24) {
    const out = [], N = D.notes;
    for (let i = lastIndex(t); i >= 0 && out.length < max; i--) {
      if (N[i][0] <= t - life) break;
      out.push({ t0: N[i][0], pitch: N[i][1], vel: N[i][2], dur: N[i][3] });
    }
    return out;
  }
  // notes with onset in [a, b)
  function notesIn(a, b) {
    const out = [], N = D.notes;
    for (let i = lastIndex(b - 1e-9); i >= 0 && N[i][0] >= a; i--) out.push(N[i]);
    return out.reverse();
  }
  return {
    init, pulsesAt, notesIn,
    get dur() { return D.dur; },
    envAt: t => frameVal(D.env, t),
    lowAt: t => frameVal(D.low, t),
    highAt: t => frameVal(D.high, t),
  };
})();
