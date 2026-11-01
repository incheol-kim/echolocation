const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { load } = require('./load');
const SR = load(['00', '20', '50']);
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const same = (x, y) => ['pos', 'alt', 'attr'].every(k => x[k].length === y[k].length && bytes(x[k]).equals(bytes(y[k])));

// v3 is near-lossless: positions/normals/brightness are quantised far below what a pixel can show
// (user-approved 2026-11-01 after pixel comparison); rnd and type stay exact.
function close(d, g) {
  const n = g.pos.length / 3;
  assert.strictEqual(d.pos.length, g.pos.length);
  let pe = 0, ne = 0, be = 0;
  for (let i = 0; i < n; i++) {
    pe = Math.max(pe, Math.hypot(d.pos[i * 3] - g.pos[i * 3], d.pos[i * 3 + 1] - g.pos[i * 3 + 1], d.pos[i * 3 + 2] - g.pos[i * 3 + 2]));
    const dot = d.alt[i * 3] * g.alt[i * 3] + d.alt[i * 3 + 1] * g.alt[i * 3 + 1] + d.alt[i * 3 + 2] * g.alt[i * 3 + 2];
    ne = Math.max(ne, Math.acos(Math.min(1, dot)) * 180 / Math.PI);
    be = Math.max(be, Math.abs(d.attr[i * 4] - g.attr[i * 4]), Math.abs(d.attr[i * 4 + 3] - g.attr[i * 4 + 3]));
    assert.strictEqual(d.attr[i * 4 + 1], g.attr[i * 4 + 1], 'type exact');
    assert.strictEqual(d.attr[i * 4 + 2], g.attr[i * 4 + 2], 'rnd exact');
  }
  assert.ok(pe <= 0.00002, 'position error ' + (pe * 1000).toFixed(4) + ' mm');
  assert.ok(ne <= 0.05, 'normal error ' + ne.toFixed(4) + ' deg');
  assert.ok(be <= 1e-5, 'brightness/aux error ' + be);
}

let baked, gen;
test('baked heroine (v3) decodes within the approved tolerances', async () => {
  const { bake } = require('../tools/bake.js');
  baked = bake('heroine');
  gen = SR.gen.heroine(7);
  assert.strictEqual(baked.v, 3);
  close(await SR.decodeBaked(baked), gen);
});

test('baked heroine is packed to at most 40% of the plain base64 size', () => {
  const plain = Math.ceil(baked.n * 40 / 3) * 4;
  assert.ok(baked.b64.length <= plain * 0.4, `${baked.b64.length} vs plain ${plain} (${(100 * baked.b64.length / plain).toFixed(0)}%)`);
});

test('pointsFor uses baked data, falls back to generating, and gen=1 forces real computation', async () => {
  globalThis.SR_BAKED = { heroine: baked };
  close(await SR.pointsFor('heroine'), gen);
  assert.ok(same(await SR.pointsFor('heroine', 7, true), gen), 'forced generation must be the exact generator output');
  delete globalThis.SR_BAKED;
  assert.ok(same(await SR.pointsFor('sky'), SR.gen.sky(7)));
});

test('gen=1 is recognised in the query string or the hash (like #t=)', () => {
  assert.strictEqual(SR.wantsGenerate('?gen=1', ''), true);
  assert.strictEqual(SR.wantsGenerate('?w=1920&h=1080&gen=1', ''), true);
  assert.strictEqual(SR.wantsGenerate('', '#t=98.8&gen=1'), true);
  assert.strictEqual(SR.wantsGenerate('', '#gen=1&t=98.8'), true);
  assert.strictEqual(SR.wantsGenerate('?w=1920&h=1080', '#t=98.8'), false);
  assert.strictEqual(SR.wantsGenerate('?gen=0', ''), false);
});

test('the built page embeds a baked heroine that matches the current generator', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'echolocation.html'), 'utf8');
  const m = /const SR_BAKED = (\{.*?\});\r?\n/s.exec(html);   // build.py writes CRLF on Windows
  assert.ok(m, 'SR_BAKED missing from dist/echolocation.html');
  close(await SR.decodeBaked(JSON.parse(m[1]).heroine), gen);
});
