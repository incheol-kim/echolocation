const test = require('node:test'), assert = require('node:assert');
const { load, music } = require('./load');
const SR = load(['00', '10']);

test('rng is deterministic per seed', () => {
  const a = SR.rng(1), b = SR.rng(1);
  for (let i = 0; i < 3; i++) assert.strictEqual(a(), b());
  const c = SR.rng(2); assert.notStrictEqual(SR.rng(1)(), c());
});

test('lookAt rotation part is orthonormal', () => {
  const m = SR.mat4.lookAt([3, 4, -5], [10, 2, 7], [0, 1, 0]);
  const col = k => [m[k], m[k + 4], m[k + 8]]; // rows of rotation stored column-major
  const rows = [0, 1, 2].map(r => [m[r], m[4 + r], m[8 + r]]);
  for (const r of rows) assert.ok(Math.abs(Math.hypot(...r) - 1) < 1e-5);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(rows[0], rows[1])) < 1e-5);
  assert.ok(Math.abs(dot(rows[1], rows[2])) < 1e-5);
  void col;
});

test('catmull passes through keys and clamps outside', () => {
  const P = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 5]], T = [0, 1, 3, 4];
  T.forEach((t, i) => SR.catmull(P, T, t).forEach((v, k) => assert.ok(Math.abs(v - P[i][k]) < 1e-9)));
  assert.deepStrictEqual([...SR.catmull(P, T, -1)], P[0]);
  assert.deepStrictEqual([...SR.catmull(P, T, 9)], P[3]);
});

test('music pulses reflect first note at 1.267s', () => {
  SR.music.init(music());
  assert.ok(SR.music.pulsesAt(1.3).some(p => p.pitch === 81 && p.vel === 94));
  assert.strictEqual(SR.music.pulsesAt(1.2).length, 0);
  const ps = SR.music.pulsesAt(200);
  assert.ok(ps.length <= 24 && ps.length > 0);
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i - 1].t0 >= ps[i].t0);
});

test('music envelopes clamp and stay in 0..1', () => {
  SR.music.init(music());
  assert.strictEqual(SR.music.envAt(-5), SR.music.envAt(0));
  assert.strictEqual(SR.music.envAt(999), SR.music.envAt(355));
  for (const t of [0, 10.01, 210.5, 354.99]) for (const f of ['envAt', 'lowAt', 'highAt']) {
    const v = SR.music[f](t); assert.ok(v >= 0 && v <= 1, f + t);
  }
});
