// ---------- app: stage, clock, playback, HUD ----------
SR.fitStage = function (W, H) {
  let w = W, h = W * 9 / 16;
  if (h > H) { h = H; w = H * 16 / 9; }
  return { w, h, x: (W - w) / 2, y: (H - h) / 2 };
};

// Audio position estimate that never runs backwards during playback, even
// when the media clock only updates every ~250 ms. Large jumps are seeks.
SR.smoothClock = function () {
  let base = 0, at = 0, lastAudio = -1, out = 0, playing = false;
  return {
    sync(audioT, nowMs, isPlaying) {
      const est = base + (playing ? (nowMs - at) / 1000 : 0);
      if (!isPlaying || !playing || Math.abs(audioT - est) > 0.35) {
        base = audioT; at = nowMs; out = audioT;
      } else if (audioT !== lastAudio) {
        base = est + (audioT - est) * 0.2; at = nowMs; // audio clock is freshest right when it changes
      }
      lastAudio = audioT; playing = isPlaying;
    },
    now(nowMs) {
      const est = base + (playing ? (nowMs - at) / 1000 : 0);
      out = playing ? Math.max(out, est) : est;
      return out;
    },
  };
};

// Taps/clicks on the picture, the same for mouse, touch and pen (phones have no arrow keys). Centre third: play/pause at
// once. Left/right thirds while playing: a double tap seeks 5 s back/forward and every further tap on that side within
// the streak seeks 5 s more, as on video sites; a single side tap pauses after a short wait. While paused every tap
// resumes at once (browsers only start audio straight from the gesture), except a tap that continues a seek streak:
// a streak that ran into the end (where playback stops) must stay there, not replay from 0:00. Times in seconds;
// tick() runs every frame.
SR.tapControl = function (wait = 0.28, streak = 0.7, step = 5) {
  let pend = null, run = null;   // pend: a side tap waiting for a second one; run: the current seek streak
  return {
    tap(zone, t, playing) {
      const dir = zone === 'L' ? -1 : zone === 'R' ? 1 : 0;
      if (dir && run && run.dir === dir && t - run.t <= streak) { run.t = t; return [{ type: 'seek', dt: dir * step, dir }]; }
      if (!playing || !dir) { pend = null; run = null; return [{ type: 'toggle' }]; }
      if (pend && pend.dir === dir && t - pend.t <= wait) { pend = null; run = { dir, t }; return [{ type: 'seek', dt: dir * step, dir }]; }
      run = null; pend = { dir, t };
      return [];
    },
    tick(t) {
      if (run && t - run.t > streak) run = null;
      if (pend && t - pend.t > wait) { pend = null; return [{ type: 'toggle' }]; }
      return [];
    },
  };
};
// Where a seek of dt seconds from cur lands: never before the start or past the last frame, and never the wrong way
// (after playback ended the audio clock can sit just past the last frame).
SR.seekTarget = (cur, dt, dur) => {
  const t = SR.clamp(cur + dt, 0, dur - 0.05);
  return dt > 0 ? Math.max(t, cur) : Math.min(t, cur);
};
// The seconds shown for a run of seeks the same way ('<< 10 s'): only the time actually moved, so it stops growing
// at the start and the end. A new direction or a pause of more than `streak` seconds starts a new count.
SR.seekRun = function (streak = 0.7) {
  let run = null;
  return {
    add(dir, moved, t) {
      if (run && run.dir === dir && t - run.t <= streak) run.total += Math.abs(moved);
      else run = { dir, total: Math.abs(moved) };
      run.t = t;
      return run.total;
    },
  };
};
// CSS cubic-bezier timing function (x in 0..1 -> eased progress), solved for x by Newton steps with a bisection fallback
SR.cubicBezier = function (x1, y1, x2, y2) {
  const B = (a, b, u) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  const dB = (a, b, u) => 3 * a * (1 - u) * (1 - u) + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let k = 0; k < 8; k++) { const e = B(x1, x2, u) - x, d = dB(x1, x2, u); if (Math.abs(e) < 1e-12) break; if (Math.abs(d) < 1e-9) break; u -= e / d; }
    if (!(u >= 0 && u <= 1) || Math.abs(B(x1, x2, u) - x) > 1e-9) {
      let lo = 0, hi = 1; u = x;
      for (let k = 0; k < 60; k++) { if (B(x1, x2, u) < x) lo = u; else hi = u; u = (lo + hi) / 2; }
    }
    return B(y1, y2, u);
  };
};
// Video end card: when the music ends the page shows its title through the overlay's 0.6 s CSS 'ease' fade-in; the video
// does the same with the credit under the title, holds it at full brightness, fades it out to black and ends on a moment
// of black (user 2026-11-01). The picture is already black by then. VIDEO_TAIL: seconds of silence after the music.
SR.END_CARD = { in: 0.6, hold: 2.5, out: 1.5, black: 0.4 };
SR.VIDEO_TAIL = SR.END_CARD.in + SR.END_CARD.hold + SR.END_CARD.out + SR.END_CARD.black;
const EASE = SR.cubicBezier(0.25, 0.1, 0.25, 1), EASE_IN_OUT = SR.cubicBezier(0.42, 0, 0.58, 1);
SR.endCardOpacity = (t, dur) => {
  const E = SR.END_CARD, u = t - dur;
  if (u <= 0) return 0;
  if (u < E.in) return EASE(u / E.in);
  if (u <= E.in + E.hold) return 1;
  return 1 - EASE_IN_OUT(Math.min(1, (u - E.in - E.hold) / E.out));
};
// Video export (design doc 9.2.0.1): an output frame is the average of n sub-frames. Their times are spread evenly over
// a 180-degree shutter (half a frame) centred on the frame time -> motion blur; each is shifted by a sub-pixel offset
// (Halton 2,3) -> anti-aliasing. Accumulated in the half-float target, tone-mapped once.
// Sub-frames never cross a hard camera cut: they are clamped to the frame's side of it (no double exposure of two shots).
SR.subFrameTimes = (t, n, fps, shutter = 0.5, cuts = []) =>
  Array.from({ length: n }, (_, k) => {
    let ts = Math.max(0, t + ((k + 0.5) / n - 0.5) * shutter / fps);
    for (const c of cuts) { if (t >= c && ts < c) ts = c; else if (t < c && ts >= c) ts = c - 1e-6; }
    return ts;
  });
SR.subPixelJitter = n => {
  if (n <= 1) return [[0, 0]];
  const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); } return r; };
  return Array.from({ length: n }, (_, k) => [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5]);
};
// shifts the projected image by (dx, dy) pixels: NDC offset times w, folded into the projection's x and y rows
SR.jitterProjection = (P, dx, dy, W, H) => {
  const Q = Array.from(P), ox = 2 * dx / W, oy = 2 * dy / H;
  for (let j = 0; j < 4; j++) { Q[4 * j] += ox * P[4 * j + 3]; Q[4 * j + 1] += oy * P[4 * j + 3]; }
  return Q;
};
SR.fmtTime = s => { const m = Math.floor(s / 60), r = Math.floor(s - m * 60); return m + ':' + String(r).padStart(2, '0'); };

// Point sets baked at build time (tools/bake.js, format v3, near-lossless; see that file for the layout).
SR.decodeBaked = async function (k) {
  if (k.v !== 3) throw new Error('unknown baked format v' + k.v);
  const bin = atob(k.b64), z = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i);
  const U = new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const n = k.n;
  let off = 0;
  const u16 = m => { const o = new Uint16Array(m); for (let i = 0; i < m; i++) o[i] = U[off + i] | (U[off + m + i] << 8); off += 2 * m; return o; };
  const P = u16(3 * n), N = u16(2 * n), Bq = u16(n), Aq = u16(n);
  const pos = new Float32Array(3 * n), alt = new Float32Array(3 * n), attr = new Float32Array(4 * n), R = SR.rng(k.rngSeed);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) pos[i * 3 + c] = k.lo[c] + P[c * n + i] / 65535 * (k.hi[c] - k.lo[c]);
    let x = N[i] / 65535 * 2 - 1, y = N[n + i] / 65535 * 2 - 1;
    const zz = 1 - Math.abs(x) - Math.abs(y);
    if (zz < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
    const l = Math.hypot(x, y, zz);
    alt[i * 3] = x / l; alt[i * 3 + 1] = y / l; alt[i * 3 + 2] = zz / l;
  }
  let call = 0, prev = -1;
  for (let i = 0; i < n; i++) {
    let d = 0, shift = 0, byte;
    do { byte = U[off++]; d |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    const idx = prev + 1 + d; prev = idx;
    while (call < idx) { R(); call++; }
    attr[i * 4] = Bq[i] / 65535; attr[i * 4 + 1] = k.type; attr[i * 4 + 2] = R(); attr[i * 4 + 3] = Aq[i] / 65535;
    call++;
  }
  return { pos, alt, attr };
};
// generate = true computes the points for real instead of using the baked copy (page option gen=1)
SR.pointsFor = async function (name, seed = 7, generate = false) {
  const B = typeof SR_BAKED !== 'undefined' ? SR_BAKED : globalThis.SR_BAKED;
  return !generate && B && B[name] ? SR.decodeBaked(B[name]) : SR.gen[name](seed);
};
// gen=1 may be given in the query string (?gen=1) or the hash (#t=98.8&gen=1), like t=
SR.wantsGenerate = (search, hash) => /(?:^|[?&#])gen=1(?:&|$)/.test(search || '') || /(?:^|[?&#])gen=1(?:&|$)/.test(hash || '');

SR.app = async function () {
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const stage = $('stage'), canvas = $('view'), hud1 = $('hud1'), hud2 = $('hud2'), over = $('over'), msg = $('msg'), audio = $('audio');
  const track = $('track'), fill = $('fill'), knob = $('knob'), timeLabel = $('time'), bar = $('bar'), seekfx = $('seekfx');
  const q = new URLSearchParams(location.search);
  const fixedW = +q.get('w') || 0, fixedH = +q.get('h') || 0;
  const stillT = () => { const m = /t=([\d.]+)/.exec(location.hash); return m ? +m[1] : null; };

  SR.music.init(SR_DATA);
  let R;
  try { R = SR.gl.init(canvas); } catch (e) { msg.textContent = 'WebGL2 is not available in this browser: ' + e.message; return; }

  function layout() {
    const W = fixedW || innerWidth, H = fixedH || innerHeight, s = SR.fitStage(W, H);
    Object.assign(stage.style, { left: s.x + 'px', top: s.y + 'px', width: s.w + 'px', height: s.h + 'px' });
    stage.style.setProperty('--u', (s.h / 1080).toFixed(4));
    const dpr = fixedW ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    R.resize(Math.round(s.w * dpr), Math.round(s.h * dpr));
  }
  addEventListener('resize', layout); layout();

  const forceGen = SR.wantsGenerate(location.search, location.hash);   // gen=1: compute instead of using baked data
  const parts = [['terrain', 'terrain'], ['ruins', 'ruins'], ['whale', 'life forms'], ['whaleHead', 'life form detail'], ['heroine', 'researcher'], ['sky', 'stars'], ['ring', 'rings'], ['clouds', 'clouds'], ['planet', 'planet']];
  for (let k = 0; k < parts.length; k++) {
    msg.textContent = `Restoring record… ${parts[k][1]} (${k + 1}/${parts.length})`;
    await new Promise(r => setTimeout(r, 16));
    R.add(parts[k][0], await SR.pointsFor(parts[k][0], 7, forceGen));
  }

  let hudCache = '';
  function frameParams(s, jx = 0, jy = 0) {   // jx, jy: sub-pixel offset of the image (video export)
    const c = s.cam, [w, h] = R.size, near = Math.max(0.02, c.eye[1] * 0.002);
    let proj = SR.mat4.perspective(c.fov * Math.PI / 180, w / h, near, 4e6);
    if (jx || jy) proj = SR.jitterProjection(proj, jx, jy, w, h);
    return {
      view: SR.mat4.lookAt(c.eye, c.target, [0, 1, 0]), proj,
      eye: c.eye, t: s.t, exposure: s.exposure, fog: s.fog, fade: s.fade, maxPx: s.maxPx,
      pulses: s.pulses, pulseSpeed: s.pulseSpeed, pulseLife: s.pulseLife, pulseRing: s.pulseRing, lamp: s.lamp, lampK: s.lampK,
    };
  }
  function overlays(s, t) {   // HUD text and (stills / video) the end card, for the frame time t
    const hs = s.hud.join('\n');
    if (hs !== hudCache) { hudCache = hs; hud1.textContent = s.hud[0]; hud2.textContent = s.hud[1]; }
    stage.style.setProperty('--hud', (Math.min(s.fade * 1.4, 1) * (s.scene === 8 ? 1 : 0.85)).toFixed(3));
    if (exporting) endCard(t);
  }
  function draw(t, only) {   // only: draw just the named object (checks/tests)
    const s = SR.stateAt(t);
    R.frame(frameParams(s), only ? s.draws.filter(d => d.name === only) : s.draws);
    overlays(s, t);
    return s;
  }
  // one video frame: n sub-frames over a 180-degree shutter at the given frame rate, each with a sub-pixel offset,
  // averaged in the HDR target and tone-mapped once (the overall fade and the overlays follow the frame time)
  function renderFrame(t, n = 16, fps = 60) {
    const ts = SR.subFrameTimes(t, n, fps, 0.5, SR.CUTS || []), jit = SR.subPixelJitter(n);
    for (let k = 0; k < n; k++) {
      const s = SR.stateAt(ts[k]);
      R.splat(frameParams(s, jit[k][0], jit[k][1]), s.draws, k === 0, 1 / n);
    }
    const s = SR.stateAt(t);
    R.present(frameParams(s));
    overlays(s, t);
    return n;
  }
  // still / video frames (#t=): past the music, the end card (the picture holds the last frame, already faded to black)
  let exporting = false;
  function endCard(t) {
    const a = SR.endCardOpacity(t, SR.music.dur);
    over.classList.toggle('endcard', a > 0);
    over.classList.toggle('hide', a <= 0);
    over.style.opacity = a > 0 ? a.toFixed(4) : '';
    if (a > 0) msg.textContent = 'Echolocation';
  }
  window.renderAt = draw;
  window.renderFrame = renderFrame;
  window.SR_READY = true;

  const clock = SR.smoothClock();
  let playing = false;
  function setPlaying(p) {
    playing = p; document.body.classList.toggle('playing', p);
    over.classList.toggle('hide', p);
    if (!p) msg.textContent = pos() > 0.1 && !audio.ended ? 'Paused' : 'Echolocation';
  }
  function toggle() { if (audio.paused) audio.play().then(() => setPlaying(true)).catch(e => { msg.textContent = 'Unable to play audio: ' + e.message; }); else { audio.pause(); setPlaying(false); } }
  // a position chosen before the audio can take it (some phones load no metadata before the first play)
  let want = null;
  const pos = () => (want != null && audio.readyState < 1 ? want : audio.currentTime);
  function setTime(t) {
    want = SR.clamp(t, 0, SR.music.dur - 0.05);
    try { audio.currentTime = want; } catch (e) { /* taken on loadedmetadata */ }
    if (audio.paused) msg.textContent = 'Paused';   // 'Echolocation' only on the untouched first screen and at the very end
  }
  audio.addEventListener('loadedmetadata', () => { if (want != null) audio.currentTime = want; });
  audio.addEventListener('seeked', () => { want = null; });
  function seek(dt) { const cur = pos(), to = SR.seekTarget(cur, dt, SR.music.dur); if (to !== cur) setTime(to); return to - cur; }
  audio.addEventListener('ended', () => setPlaying(false));

  // seek feedback: '<< 10 s' on the left, '10 s >>' on the right; consecutive seeks add up (time actually moved)
  let fxTimer = 0;
  const runs = SR.seekRun();
  function seekBy(dir) {
    const moved = seek(dir * 5), total = Math.round(runs.add(dir, moved, performance.now() / 1000));
    seekfx.textContent = dir < 0 ? '\u00ab ' + total + ' s' : total + ' s \u00bb';
    seekfx.className = 'on ' + (dir < 0 ? 'L' : 'R');
    clearTimeout(fxTimer); fxTimer = setTimeout(() => { seekfx.className = dir < 0 ? 'L' : 'R'; }, 700);
  }
  const taps = SR.tapControl();
  const act = list => list.forEach(a => { if (a.type === 'toggle') toggle(); else seekBy(a.dir); });
  // when the finger/button came up (a heavy frame can delay the click itself, which would spoil double-tap timing)
  let lastUp = -1e9;
  addEventListener('pointerup', e => { lastUp = e.timeStamp; }, true);
  function onTap(e) {
    const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, nowMs = performance.now();
    const at = nowMs - lastUp < 1000 ? lastUp : nowMs;
    act(taps.tap(x < 1 / 3 ? 'L' : x > 2 / 3 ? 'R' : 'C', at / 1000, !audio.paused));
    setTimeout(() => act(taps.tick(performance.now() / 1000)), 320);   // a lone side tap pauses even when no frames are drawn
  }

  // timeline on the pause screen: drag (or tap) to jump; the picture follows while dragging
  const fracAt = e => { const r = track.getBoundingClientRect(); return SR.clamp((e.clientX - r.left) / r.width, 0, 1); };
  let dragging = false;
  bar.addEventListener('pointerdown', e => {
    dragging = true; setTime(fracAt(e) * SR.music.dur); e.stopPropagation();
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* keep dragging without capture */ }
  });
  bar.addEventListener('pointermove', e => { if (dragging) setTime(fracAt(e) * SR.music.dur); });
  bar.addEventListener('pointerup', e => { dragging = false; e.stopPropagation(); });
  bar.addEventListener('pointercancel', () => { dragging = false; });
  bar.addEventListener('click', e => e.stopPropagation());   // a tap on the bar must not start playback
  function showTime(t) {
    const f = (100 * SR.clamp(t / SR.music.dur, 0, 1)).toFixed(3) + '%';
    fill.style.width = f; knob.style.left = f;
    timeLabel.textContent = SR.fmtTime(t) + ' / ' + SR.fmtTime(SR.music.dur);
  }

  const st = stillT();
  if (st != null) { exporting = true; over.style.transition = 'none'; over.classList.add('hide'); draw(st); }   // stills and video frames: no fade of the overlay
  else {
    msg.textContent = 'Echolocation'; over.classList.add('ready');
    over.addEventListener('click', onTap); canvas.addEventListener('click', onTap);
    addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); seekBy(1); } else if (e.code === 'ArrowLeft') { e.preventDefault(); seekBy(-1); }
    });
    const loop = now => {
      act(taps.tick(now / 1000));
      clock.sync(pos(), now, !audio.paused);
      const t = clock.now(now);
      draw(t);
      if (audio.paused) showTime(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  addEventListener('hashchange', () => { const s = stillT(); if (s != null && exporting) draw(s); });
};
if (typeof document !== 'undefined') addEventListener('DOMContentLoaded', () => SR.app());
