// Bake slow, deterministic point sets so the page can load them instead of generating them.
// Run by tools/build.py on every build (prints JSON to stdout), so the embedded data never goes stale.
// The page can still compute them for real with gen=1 (?gen=1 or #...&gen=1).
//
// Format v3 (near-lossless, user-approved 2026-11-01 after a pixel comparison showed no visible difference):
//   pos     3n uint16, planar, quantised within the bbox (lo/hi in the header)  -> max error ~0.014 mm
//   normal  2n uint16, octahedral encoding                                        -> max error ~0.023 deg
//   bright   n uint16 (0..1)                                                      -> max error ~7.6e-6
//   aux      n uint16 (0..1)
//   rndIdx   n LEB128 varints: gaps between the RNG-call indices that produced attr[2] (exact)
//   uint16 streams are byte-shuffled; everything is deflate-raw (level 9) + base64. attr[1] (type) is in the header.
const zlib = require('zlib');

function sr() {
  if (globalThis.SR && globalThis.SR.gen) return globalThis.SR;
  return require('../test/load').load(['00', '20']);
}
const BAKED = ['heroine'];   // the only generator slow enough to matter (~85% of load time)

const q16 = v => Math.max(0, Math.min(65535, Math.round(v * 65535)));
function shuffled16(u) {
  const b = Buffer.from(u.buffer, u.byteOffset, u.byteLength), m = u.length, out = Buffer.alloc(b.length);
  for (let k = 0; k < 2; k++) for (let i = 0; i < m; i++) out[k * m + i] = b[i * 2 + k];
  return out;
}
function varints(idx) {
  const out = []; let prev = -1;
  for (const v of idx) { let d = v - prev - 1; prev = v; do { let byte = d & 0x7f; d >>>= 7; if (d) byte |= 0x80; out.push(byte); } while (d); }
  return Buffer.from(out);
}
function octEncode(x, y, z) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z); x /= s; y /= s;
  if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
  return [q16(x * 0.5 + 0.5), q16(y * 0.5 + 0.5)];
}

function bake(name, seed = 7) {
  const g = sr().gen[name](seed), n = g.pos.length / 3;
  const type = g.attr[1];
  for (let i = 0; i < n; i++) if (g.attr[i * 4 + 1] !== type) throw new Error('type is not constant');
  if (!g.rndIndex) throw new Error(name + ': generator must expose rndIndex/rngSeed');
  const lo = [0, 1, 2].map(c => { let m = Infinity; for (let i = 0; i < n; i++) m = Math.min(m, g.pos[i * 3 + c]); return m; });
  const hi = [0, 1, 2].map(c => { let m = -Infinity; for (let i = 0; i < n; i++) m = Math.max(m, g.pos[i * 3 + c]); return m; });
  const P = new Uint16Array(3 * n), N = new Uint16Array(2 * n), Bq = new Uint16Array(n), Aq = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) P[c * n + i] = q16((g.pos[i * 3 + c] - lo[c]) / (hi[c] - lo[c]));
    const [ox, oy] = octEncode(g.alt[i * 3], g.alt[i * 3 + 1], g.alt[i * 3 + 2]);
    N[i] = ox; N[n + i] = oy;
    Bq[i] = q16(g.attr[i * 4]); Aq[i] = q16(g.attr[i * 4 + 3]);
  }
  const parts = [shuffled16(P), shuffled16(N), shuffled16(Bq), shuffled16(Aq), varints(g.rndIndex)];
  const packed = zlib.deflateRawSync(Buffer.concat(parts), { level: 9 });
  return { v: 3, n, type, rngSeed: g.rngSeed, lo, hi, b64: packed.toString('base64') };
}
module.exports = { bake, BAKED };
if (require.main === module) {
  const out = {};
  for (const k of BAKED) out[k] = bake(k);
  process.stdout.write(JSON.stringify(out));
}
