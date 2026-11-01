const test = require('node:test'), assert = require('node:assert');
const { load, music } = require('./load');
const SR = load(['00', '10', '20', '40']);
SR.music.init(music());

test('scene index boundaries and clamping', () => {
  const cases = [[0, 0], [39.99, 0], [40, 1], [94.9, 1], [95, 2], [105, 3], [150, 4], [200, 5], [269.99, 5], [270, 6], [295, 7], [345, 8], [355, 8], [-3, 0], [999, 8]];
  for (const [t, i] of cases) assert.strictEqual(SR.sceneIndexAt(t), i, 't=' + t);
  assert.strictEqual(SR.SCENES.length, 9);
});

test('stateAt is deterministic', () => {
  for (const t of [3.3, 123.4, 226.1, 281.5, 330]) {
    const a = JSON.stringify(SR.stateAt(t)), b = JSON.stringify(SR.stateAt(t));
    assert.strictEqual(a, b, 't=' + t);
  }
});

test('camera moves continuously except at the 270 s cut', () => {
  const dt = 1 / 60, eyes = [];
  for (let t = 0; t <= 355; t += dt) eyes.push([t, SR.stateAt(t).cam.eye]);
  const step = i => Math.hypot(...[0, 1, 2].map(k => eyes[i][1][k] - eyes[i - 1][1][k]));
  const bad = [];
  for (let i = 2; i < eyes.length - 1; i++) {
    const s = step(i), nb = Math.max(step(i - 1), step(i + 1));
    if (s > 0.5 && s > 8 * nb) bad.push(+eyes[i][0].toFixed(2));
  }
  assert.ok(bad.every(t => Math.abs(t - 270) < 0.05), 'jumps at ' + bad.slice(0, 10));
});

test('every state has finite camera and draws', () => {
  for (let t = 0; t <= 355; t += 0.5) {
    const s = SR.stateAt(t);
    for (const v of [...s.cam.eye, ...s.cam.target, s.cam.fov]) assert.ok(Number.isFinite(v), 't=' + t);
    assert.ok(Array.isArray(s.draws) && s.draws.length > 0);
    assert.ok(typeof s.hud[0] === 'string' && s.hud[0].includes('T+'));
  }
});

test('heroine stays at the origin and the final seconds read END OF RECORD', () => {
  const h = SR.stateAt(100).draws.find(d => d.name === 'heroine');
  assert.ok(h && (!h.model || (h.model[12] === 0 && h.model[14] === 0)));
  assert.ok(SR.stateAt(352).hud.join(' ').includes('END OF RECORD'));
});

test('reaching hand meets the stele face at 1:41 and rests at 0:50', () => {
  const st = SR.gen.STELE;
  const d = h => Math.hypot(h[0] - st.touch[0], h[1] - st.touch[1], h[2] - st.touch[2]);
  assert.ok(d(SR.director.handAt(101)) < 0.06, 'hand ' + SR.director.handAt(101));
  assert.ok(d(SR.director.handAt(50)) > 0.4);
});

test('sigil idles before the touch, flashes at 1:39 and sends a wave toward the ziggurat', () => {
  const ruins = t => SR.stateAt(t).draws.find(d => d.name === 'ruins').params;
  const before = ruins(97).sigil, hit = ruins(99.4).sigil, later = ruins(106).sigil;
  assert.ok(before[0] > 0 && before[1] === 0 && before[2] === 0, 'before ' + before);
  assert.ok(hit[1] > 0.5, 'flash ' + hit);
  assert.ok(later[2] > 470, 'wave radius at 1:46 should pass the ziggurat (470 m): ' + later[2]);
  assert.strictEqual(ruins(60).sigil[1], 0);
});

// --- README to-do 8 & 9 ---
const yawOf = (i, t) => { const a = SR.director.whalePos(i, t - 0.4), b = SR.director.whalePos(i, t + 0.4); return Math.atan2(-(b[2] - a[2]), b[0] - a[0]); };
const viewDir = t => { const c = SR.director.camAt(t); return SR.v3.norm(SR.v3.sub(c.target, c.eye)); };
const viewRate = t => Math.acos(Math.min(1, SR.v3.dot(viewDir(t), viewDir(t + 1 / 60)))) * 60 * 180 / Math.PI;

test('to-do 8: first-encounter whale turns gently (no snap around 2:46)', () => {
  let worst = 0, at = 0;
  for (let t = 140; t < 272; t += 0.05) {
    let d = yawOf(0, t + 0.05) - yawOf(0, t); d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) / 0.05 > worst) { worst = Math.abs(d) / 0.05; at = t; }
  }
  assert.ok(worst <= 0.2, `yaw rate ${worst.toFixed(2)} rad/s at ${at.toFixed(2)} s`);
});

test('to-do 9: camera under the passing whale never flips through the zenith and turns a bit slower', () => {
  let maxEl = 0, maxRate = 0;
  for (let t = 135; t < 150; t += 1 / 30) maxEl = Math.max(maxEl, Math.asin(viewDir(t)[1]) * 180 / Math.PI);
  for (let t = 135; t < 147; t += 1 / 30) maxRate = Math.max(maxRate, viewRate(t));
  assert.ok(maxEl < 80, 'max elevation ' + maxEl.toFixed(1));
  assert.ok(maxRate <= 16, 'max turn rate ' + maxRate.toFixed(1) + ' deg/s');
});

test('to-do 9: the fast 2:32 swing the user likes is kept', () => {
  let peak = 0;
  for (let t = 150; t < 155; t += 1 / 60) peak = Math.max(peak, viewRate(t));
  assert.ok(peak >= 120, 'peak ' + peak.toFixed(1) + ' deg/s');
});


// --- afterglow (user 2026-11-01): all whales leave together and fade slowly ---
function whalesOnScreen(t, minAlpha) {
  const s = SR.stateAt(t), c = s.cam, V = SR.mat4.lookAt(c.eye, c.target, [0, 1, 0]), P = SR.mat4.perspective(c.fov * Math.PI / 180, 16 / 9, 0.05, 4e6);
  return s.draws.filter(d => d.name === 'whale' && d.params.alpha >= minAlpha).filter(d => {
    const m = d.model, p = [m[12], m[13], m[14]];
    const v = [0, 1, 2, 3].map(r => V[r] * p[0] + V[4 + r] * p[1] + V[8 + r] * p[2] + V[12 + r]);
    const cl = [0, 1, 2, 3].map(r => P[r] * v[0] + P[4 + r] * v[1] + P[8 + r] * v[2] + P[12 + r] * v[3]);
    return cl[3] > 0 && Math.abs(cl[0] / cl[3]) < 1 && Math.abs(cl[1] / cl[3]) < 1;
  }).length;
}
test('afterglow: all six whales depart together and are on screen at 5:22 and 5:26', () => {
  for (const t of [322, 326]) assert.ok(whalesOnScreen(t, 0.05) >= 6, `t=${t}: ${whalesOnScreen(t, 0.05)} whales on screen`);
});
test('afterglow: whales fade out gradually, never pop out', () => {
  const alphas = t => SR.stateAt(t).draws.filter(d => d.name === 'whale').map(d => d.params.alpha);
  const peak = [];
  for (let t = 318; t <= 346; t += 0.5) alphas(t).forEach((v, k) => { peak[k] = Math.max(peak[k] || 0, v); });
  for (let t = 318; t < 346; t += 0.5) {      // a pop = a large absolute drop within half a second
    const a = alphas(t), b = alphas(t + 0.5);
    // 25%: the centre-disc fade the user asked to match takes ~2.5 s
    for (let k = 0; k < a.length; k++) assert.ok(a[k] - (b[k] || 0) <= 0.25 * peak[k], `t=${t}: whale ${k} alpha ${a[k].toFixed(3)} -> ${(b[k] || 0).toFixed(3)} (peak ${peak[k].toFixed(3)})`);
  }
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'js', '30-gl.js'), 'utf8');
  assert.ok(!/if \(a < 0\.00[1-9]/.test(src), 'shader must not cull faint points (far objects pop out)');
});

// --- afterglow round 2 (user 2026-11-01): fade with the bright centre disc; spread out and keep moving ---
function screenOf(t) {
  const s = SR.stateAt(t), c = s.cam, V = SR.mat4.lookAt(c.eye, c.target, [0, 1, 0]), P = SR.mat4.perspective(c.fov * Math.PI / 180, 16 / 9, 0.05, 4e6);
  const proj = p => { const v = [0, 1, 2, 3].map(r => V[r] * p[0] + V[4 + r] * p[1] + V[8 + r] * p[2] + V[12 + r]);
    const cl = [0, 1, 2, 3].map(r => P[r] * v[0] + P[4 + r] * v[1] + P[8 + r] * v[2] + P[12 + r] * v[3]);
    return { x: cl[0] / cl[3] * 960, y: cl[1] / cl[3] * 540, len: 300 * P[5] * 540 / Math.max(-v[2], 1) }; };
  return { s, whales: s.draws.filter(d => d.name === 'whale').map(d => proj([d.model[12], d.model[13], d.model[14]])), her: proj([0, 0, 0]) };
}
test('afterglow: whales fade out exactly with the bright centre disc (terrain) around 5:25-5:29', () => {
  const terrain = t => (SR.stateAt(t).draws.find(d => d.name === 'terrain') || { params: { alpha: 0 } }).params.alpha;
  const whales = t => SR.stateAt(t).draws.filter(d => d.name === 'whale').map(d => d.params.alpha);
  const base = whales(323);
  for (let t = 323; t <= 331; t += 0.25) {
    const w = whales(t);
    base.forEach((b, k) => assert.ok(Math.abs((w[k] || 0) / b - terrain(t)) < 0.02, `t=${t}: whale ${k} at ${((w[k] || 0) / b).toFixed(3)} vs disc ${terrain(t).toFixed(3)}`));
  }
});
test('afterglow: at the end the whales are spaced apart and visibly moving', () => {
  const a = screenOf(328);
  let minGap = Infinity;
  for (let i = 0; i < a.whales.length; i++) for (let j = i + 1; j < a.whales.length; j++)
    minGap = Math.min(minGap, Math.hypot(a.whales[i].x - a.whales[j].x, a.whales[i].y - a.whales[j].y) / a.whales[i].len);
  assert.ok(minGap >= 1.0, 'closest pair is ' + minGap.toFixed(2) + ' whale lengths apart');
  const b = screenOf(327);
  a.whales.forEach((w, k) => {
    const rel = Math.hypot((w.x - a.her.x) - (b.whales[k].x - b.her.x), (w.y - a.her.y) - (b.whales[k].y - b.her.y));
    assert.ok(rel >= 0.5 * w.len, `whale ${k} moves only ${(rel / w.len).toFixed(2)} lengths per second`);
  });
});

// --- README to-do 3 (scale reversal): the x-ray of the buried ziggurat is a moment of the 1:18-1:34 rise only
test('x-ray: the buried ziggurat shows only during the rise over the mound', () => {
  const xr = t => SR.stateAt(t).draws.find(d => d.name === 'ruins').params.xray || 0;
  for (const t of [40, 60, 76, 77.9, 94.1, 100, 160, 200, 300]) assert.strictEqual(xr(t), 0, 't=' + t);
  for (const t of [84, 86, 88, 89]) assert.ok(xr(t) > 0.9, 't=' + t + ' ' + xr(t));
});

// --- user 2026-11-01: the sand mound recedes with the epoch drift (the land moves in step with the city's assembly)
test('past epoch: the land sinks in step with the city assembling, without the assembly arc', () => {
  const p = (t, n) => SR.stateAt(t).draws.find(d => d.name === n).params;
  for (const t of [100, 160, 175, 190, 230, 260, 280]) {
    assert.strictEqual(p(t, 'terrain').assemble || 0, p(t, 'ruins').assemble || 0, 't=' + t);
    assert.strictEqual(p(t, 'terrain').lift, 0, 't=' + t + ': sand does not fly');
  }
  assert.ok(p(180, 'terrain').assemble > 0.6 && p(100, 'terrain').assemble === 0);
});

// --- README to-do 11: the 1:39 close-up camera overshot (Catmull-Rom after a 14 m swoop), swung to her front-left and
// passed through her body at ~1:43; it must stay behind her right shoulder and never enter her
test('camera never passes through her body', () => {
  let worst = 1e9, at = 0;
  for (let t = 0; t <= 355; t += 0.05) {
    const e = SR.stateAt(t).cam.eye;
    if (e[1] < 0 || e[1] > 1.85) continue;
    const d = Math.hypot(e[0], e[2]);                        // distance from her body axis
    if (d < worst) { worst = d; at = t; }
  }
  assert.ok(worst >= 0.45, `camera ${worst.toFixed(2)} m from her axis at t=${at.toFixed(2)}`);
});

test('1:41-1:45 close-up: the camera stays at her front-left and slowly pushes in towards her hand', () => {
  const hand = SR.director.handAt(103);
  let last = 1e9;
  for (let t = 101; t <= 105.001; t += 0.1) {
    const e = SR.stateAt(t).cam.eye, d = Math.hypot(e[0] - hand[0], e[1] - hand[1], e[2] - hand[2]);
    assert.ok(e[0] > 0.4 && e[2] > 0.2, `t=${t.toFixed(1)}: eye ${e.map(v => v.toFixed(2)).join(',')} is not at her front-left`);
    assert.ok(d <= last + 1e-9, `t=${t.toFixed(1)}: moving away from her hand`);
    last = d;
  }
});

test('the director lists its hard camera cuts for the video export', () => {
  assert.deepStrictEqual(SR.CUTS, [270]);
});
