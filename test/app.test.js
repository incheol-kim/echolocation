const test = require('node:test'), assert = require('node:assert');
const { load } = require('./load');
const SR = load(['00', '50']);

test('fitStage letterboxes to 16:9', () => {
  const a = SR.fitStage(1920, 1200);
  assert.deepStrictEqual([a.w, a.h, a.x, a.y], [1920, 1080, 0, 60]);
  const b = SR.fitStage(1000, 1000);
  assert.strictEqual(b.h, 562.5); assert.strictEqual(b.w, 1000);
  const c = SR.fitStage(3000, 1000);
  assert.strictEqual(c.h, 1000); assert.ok(Math.abs(c.w - 1777.777) < 0.01);
});

test('smoothClock is monotonic when audio time updates coarsely', () => {
  const clk = SR.smoothClock();
  let prev = -1, maxErr = 0;
  for (let ms = 0; ms < 20000; ms += 16.7) {
    const truth = ms / 1000, audio = Math.floor(truth / 0.25) * 0.25;
    clk.sync(audio, ms, true);
    const v = clk.now(ms);
    assert.ok(v >= prev, `went back at ${ms}: ${v} < ${prev}`);
    prev = v; maxErr = Math.max(maxErr, Math.abs(v - truth));
  }
  assert.ok(maxErr < 0.3, 'err ' + maxErr);
});

test('smoothClock follows a seek immediately', () => {
  const clk = SR.smoothClock();
  for (let ms = 0; ms < 2000; ms += 16.7) clk.sync(ms / 1000, ms, true);
  clk.sync(120, 2000, true);
  assert.ok(Math.abs(clk.now(2000) - 120) < 0.05);
  clk.sync(10, 2100, true);
  assert.ok(Math.abs(clk.now(2100) - 10) < 0.05);
});

test('on-page text is English (no Hangul in the template or page scripts)', () => {
  const fs = require('fs'), path = require('path');
  const files = ['src/template.html', ...fs.readdirSync('src/js').map(f => 'src/js/' + f)];
  const hits = [];
  for (const f of files) {
    fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\n').forEach((line, i) => {
      if (/[가-힣]/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 60)}`);
    });
  }
  assert.deepStrictEqual(hits, []);
});

// --- playback controls that work without a keyboard (phones), the same for mouse, touch and pen ---
test('taps: the centre third plays/pauses at once; while paused any tap resumes at once (audio needs the gesture)', () => {
  const c = SR.tapControl();
  assert.deepStrictEqual(c.tap('C', 0, true), [{ type: 'toggle' }]);
  assert.deepStrictEqual(c.tap('C', 1, false), [{ type: 'toggle' }]);
  assert.deepStrictEqual(c.tap('R', 2, false), [{ type: 'toggle' }]);
  assert.deepStrictEqual(c.tap('L', 3, false), [{ type: 'toggle' }]);
});

test('taps: a single side tap while playing pauses after a short wait; a double tap seeks 5 s instead', () => {
  const c = SR.tapControl();
  assert.deepStrictEqual(c.tap('R', 10, true), []);
  assert.deepStrictEqual(c.tick(10.2), [], 'still waiting for a second tap');
  assert.deepStrictEqual(c.tick(10.35), [{ type: 'toggle' }]);
  assert.deepStrictEqual(c.tap('R', 20, true), []);
  assert.deepStrictEqual(c.tap('R', 20.2, true), [{ type: 'seek', dt: 5, dir: 1 }]);
  assert.deepStrictEqual(c.tick(20.6), [], 'a double tap never pauses');
  assert.deepStrictEqual(c.tap('L', 30, true), []);
  assert.deepStrictEqual(c.tap('L', 30.15, true), [{ type: 'seek', dt: -5, dir: -1 }]);
});

test('taps: further taps on the same side keep seeking until the streak lapses', () => {
  const c = SR.tapControl();
  c.tap('R', 0, true); c.tap('R', 0.2, true);
  assert.deepStrictEqual(c.tap('R', 0.7, true), [{ type: 'seek', dt: 5, dir: 1 }]);
  assert.deepStrictEqual(c.tap('R', 1.3, true), [{ type: 'seek', dt: 5, dir: 1 }]);
  c.tick(2.5);
  assert.deepStrictEqual(c.tap('R', 2.6, true), [], 'after the streak a side tap waits again');
});

test('taps: a streak that reaches the end (playback stops there) keeps seeking: it never restarts from the beginning', () => {
  const c = SR.tapControl();
  c.tap('R', 0, true); c.tap('R', 0.2, true);                      // seek streak; the audio reaches the end and stops
  assert.deepStrictEqual(c.tap('R', 0.6, false), [{ type: 'seek', dt: 5, dir: 1 }], 'not a toggle (which would replay from 0:00)');
  assert.deepStrictEqual(c.tap('R', 1.0, false), [{ type: 'seek', dt: 5, dir: 1 }]);
  assert.deepStrictEqual(c.tap('C', 1.2, false), [{ type: 'toggle' }], 'the centre still plays');
  c.tap('R', 2, true); c.tap('R', 2.2, true);
  c.tick(3.5);
  assert.deepStrictEqual(c.tap('R', 3.6, false), [{ type: 'toggle' }], 'after the streak, a tap while paused plays again');
});

test('seek feedback counts only the time actually moved: it stops growing at the start and the end', () => {
  const r = SR.seekRun();
  assert.strictEqual(r.add(-1, -3, 0), 3, 'from 0:03 a 5 s step back moves 3 s');
  assert.strictEqual(r.add(-1, 0, 0.3), 3, 'at the start');
  assert.strictEqual(r.add(-1, 0, 0.6), 3);
  assert.strictEqual(r.add(1, 5, 1.0), 5, 'the other way starts a new count');
  assert.strictEqual(r.add(1, 2.5, 1.4), 7.5, 'up to the end');
  assert.strictEqual(r.add(1, 0, 1.8), 7.5, 'at the end');
  assert.strictEqual(r.add(1, 5, 3.0), 5, 'a new streak after a pause in tapping');
});

test('a seek never goes past the start or the end, and never moves the wrong way', () => {
  const dur = 355.92;
  assert.strictEqual(SR.seekTarget(3, -5, dur), 0);
  assert.strictEqual(SR.seekTarget(0, -5, dur), 0);
  assert.ok(Math.abs(SR.seekTarget(353, 5, dur) - (dur - 0.05)) < 1e-9);
  assert.strictEqual(SR.seekTarget(355.95, 5, dur), 355.95, 'already past the last frame (ended): stays, never steps back');
  assert.strictEqual(SR.seekTarget(100, 5, dur), 105);
});

test('time label: m:ss', () => {
  assert.strictEqual(SR.fmtTime(0), '0:00');
  assert.strictEqual(SR.fmtTime(161.4), '2:41');
  assert.strictEqual(SR.fmtTime(355.9), '5:55');
});

// --- video end card: after the music the title appears as on the HTML page when playback ends (the overlay's 0.6 s
// CSS 'ease' fade-in), with the credit under it; it holds at full brightness for 2.5 s, fades out to black, and the
// video ends on a moment of black (user 2026-11-01)
test('end card: eases in over 0.6 s like the page overlay, holds 2.5 s, fades out to black, then a moment of black', () => {
  const D = 355, E = SR.END_CARD;
  assert.deepStrictEqual([E.in, E.hold], [0.6, 2.5]);
  assert.ok(E.out >= 1 && E.out <= 2 && E.black > 0 && E.black <= 0.6);
  assert.ok(Math.abs(SR.VIDEO_TAIL - (E.in + E.hold + E.out + E.black)) < 1e-9);
  assert.strictEqual(SR.endCardOpacity(300, D), 0);
  assert.strictEqual(SR.endCardOpacity(D, D), 0);
  const ease = x => SR.cubicBezier(0.25, 0.1, 0.25, 1)(x);   // CSS 'ease'
  for (const dt of [0.1, 0.3, 0.45]) assert.ok(Math.abs(SR.endCardOpacity(D + dt, D) - ease(dt / 0.6)) < 1e-9);
  for (const dt of [0.6, 1.5, 3.0, 3.1]) assert.strictEqual(SR.endCardOpacity(D + dt, D), 1, 'full brightness for 2.5 s after it has fully appeared');
  let prev = 1;
  for (let dt = 3.1; dt <= 3.1 + E.out + 1e-9; dt += 0.05) { const a = SR.endCardOpacity(D + dt, D); assert.ok(a <= prev + 1e-12, 'fades out monotonically'); prev = a; }
  assert.ok(SR.endCardOpacity(D + 3.1 + E.out / 2, D) > 0.3 && SR.endCardOpacity(D + 3.1 + E.out / 2, D) < 0.7);
  for (const dt of [3.1 + E.out, SR.VIDEO_TAIL]) assert.strictEqual(SR.endCardOpacity(D + dt, D), 0, 'black at the end');
});

test('cubic-bezier matches the CSS ease curve at known points', () => {
  const e = SR.cubicBezier(0.25, 0.1, 0.25, 1);
  assert.strictEqual(e(0), 0); assert.strictEqual(e(1), 1);
  assert.ok(Math.abs(e(0.5) - 0.8024) < 2e-3, 'ease(0.5) ~ 0.802: ' + e(0.5));
  assert.ok(Math.abs(e(0.25) - 0.4085) < 2e-3, 'ease(0.25) ~ 0.409: ' + e(0.25));
});

test('the end card names the piece and the pianist (English, in the page template)', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'template.html'), 'utf8');
  assert.ok(/id="credit"[^>]*>Incheol Kim</.test(html));
});

// --- video export: each output frame is the average of sub-frames spread over a 180-degree shutter (motion blur),
// each shifted by a sub-pixel offset (anti-aliasing); design doc 9.2.0.1
test('sub-frame times: centred on the frame time, spread evenly over half a frame (180-degree shutter)', () => {
  const ts = SR.subFrameTimes(10, 16, 60);
  assert.strictEqual(ts.length, 16);
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  assert.ok(Math.abs(mean - 10) < 1e-12, 'centred on the frame');
  assert.ok(Math.abs((ts[15] - ts[0]) - (15 / 16) * (0.5 / 60)) < 1e-12, 'spread over 1/120 s');
  for (let k = 1; k < ts.length; k++) assert.ok(ts[k] > ts[k - 1]);
  assert.deepStrictEqual(SR.subFrameTimes(10, 1, 60), [10], 'one sub-frame = the frame itself');
  assert.ok(SR.subFrameTimes(0, 16, 60).every(t => t >= 0), 'never before the start');
});

test('sub-pixel jitter: offsets inside one pixel, centred, evenly spread (Halton 2,3)', () => {
  const j = SR.subPixelJitter(16);
  assert.strictEqual(j.length, 16);
  const mx = j.reduce((a, p) => a + p[0], 0) / 16, my = j.reduce((a, p) => a + p[1], 0) / 16;
  assert.ok(j.every(([x, y]) => x > -0.5 && x < 0.5 && y > -0.5 && y < 0.5));
  assert.ok(Math.abs(mx) < 0.06 && Math.abs(my) < 0.06, `mean ${mx.toFixed(3)}, ${my.toFixed(3)}`);
  assert.deepStrictEqual(SR.subPixelJitter(1), [[0, 0]]);
});

test('jittered projection shifts every projected point by exactly the given pixels', () => {
  const W = 3840, H = 2160, P = SR.mat4.perspective(0.9, W / H, 0.1, 1e5), Pj = SR.jitterProjection(P, 0.25, -0.4, W, H);
  for (const p of [[1, 2, -10], [-30, 5, -300], [0.1, -0.2, -2]]) {
    const pr = M => { const c = [0, 1, 2, 3].map(k => M[k] * p[0] + M[4 + k] * p[1] + M[8 + k] * p[2] + M[12 + k]); return [(c[0] / c[3] * 0.5 + 0.5) * W, (c[1] / c[3] * 0.5 + 0.5) * H]; };
    const a = pr(P), b = pr(Pj);
    assert.ok(Math.abs(b[0] - a[0] - 0.25) < 1e-6 && Math.abs(b[1] - a[1] + 0.4) < 1e-6, `${b[0] - a[0]}, ${b[1] - a[1]}`);
  }
});

test('sub-frame times never cross a hard camera cut (no double exposure of two shots)', () => {
  const after = SR.subFrameTimes(270, 16, 60, 0.5, [270]), before = SR.subFrameTimes(270 - 1 / 60, 16, 60, 0.5, [270]);
  assert.ok(after.every(t => t >= 270), 'the frame at the cut shows only the new shot');
  assert.ok(before.every(t => t < 270), 'the frame before shows only the old shot');
  assert.deepStrictEqual(SR.subFrameTimes(100, 16, 60, 0.5, [270]), SR.subFrameTimes(100, 16, 60), 'far from a cut: unchanged');
});

test('the page plays echolocation.mp3, and the build puts exactly that file next to it', () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'template.html'), 'utf8'), build = fs.readFileSync(path.join(root, 'tools', 'build.py'), 'utf8');
  const src = /<audio id="audio" src="([^"]+)"/.exec(html)[1];
  assert.strictEqual(src, 'echolocation.mp3');
  assert.ok(build.includes(`"dist", "${src}"`), 'build.py copies the mp3 to dist/' + src);
});
