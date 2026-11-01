const test = require('node:test'), assert = require('node:assert');
const { load } = require('./load');
const SR = load(['00', '20', '30']);

const count = g => g.pos.length / 3;
function bbox(g) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], g.pos[i + k]); hi[k] = Math.max(hi[k], g.pos[i + k]);
  }
  return { lo, hi };
}
const G = {};
test('generators build within time budget', () => {
  const t0 = Date.now();
  for (const k of ['terrain', 'ruins', 'whale', 'heroine', 'sky', 'clouds', 'planet']) G[k] = SR.gen[k](7);
  const ms = Date.now() - t0;
  console.log('gen ms', ms, Object.fromEntries(Object.entries(G).map(([k, g]) => [k, count(g)])));
  assert.ok(ms < 15000, 'took ' + ms); // generous on purpose: point quality beats load time (user, 2026-10-31)
});

test('every generator has matching pos/alt/attr sizes', () => {
  for (const [k, g] of Object.entries(G)) {
    assert.strictEqual(g.alt.length, g.pos.length, k);
    assert.strictEqual(g.attr.length, count(g) * 4, k);
  }
});

test('same seed gives same points', () => {
  for (const k of ['terrain', 'ruins', 'whale', 'heroine']) {
    const b = SR.gen[k](7);
    for (let i = 0; i < 100; i++) assert.strictEqual(b.pos[i], G[k].pos[i], k);
  }
});

test('point budgets', () => {
  assert.ok(count(G.terrain) >= 300000);
  assert.ok(count(G.ruins) >= 200000);
  assert.ok(count(G.whale) >= 120000);
  assert.ok(count(G.heroine) >= 2000);
});

test('whale is ~300 m long and heroine ~1.7 m tall', () => {
  const w = bbox(G.whale), h = bbox(G.heroine);
  const wl = w.hi[0] - w.lo[0], hh = h.hi[1] - h.lo[1];
  assert.ok(wl >= 280 && wl <= 320, 'whale ' + wl);
  assert.ok(hh >= 1.6 && hh <= 1.8, 'heroine ' + hh);
});

test('ruins have distinct intact (alt) positions and glyph points', () => {
  let moved = 0, glyph = 0;
  for (let i = 0; i < G.ruins.pos.length; i += 3) if (Math.abs(G.ruins.pos[i + 1] - G.ruins.alt[i + 1]) > 1) moved++;
  for (let i = 0; i < G.ruins.attr.length; i += 4) if (G.ruins.attr[i + 1] === 1) glyph++;
  assert.ok(moved > 20000, 'moved ' + moved);
  assert.ok(glyph > 2000, 'glyph ' + glyph);
});

test('terrain is flat near the heroine', () => {
  for (const [x, z] of [[0, 0], [1, 1], [-2, 0.5]]) assert.ok(Math.abs(SR.gen.height(x, z)) < 0.05);
});

test('stele stands front-right of her and leaves the view ahead open', () => {
  const st = SR.gen.STELE;
  assert.ok(st.touch[0] < -0.3 && st.touch[2] > 0.3, 'touch ' + st.touch);
  let glyphNear = 0, blocking = 0;
  const R = G.ruins;
  for (let i = 0; i < R.pos.length; i += 3) {
    const x = R.pos[i], y = R.pos[i + 1], z = R.pos[i + 2], j = (i / 3) * 4;
    if (R.attr[j + 1] === 1 && Math.hypot(x - st.touch[0], y - st.touch[1], z - st.touch[2]) < 0.5) glyphNear++;
    if (z > 0.3 && z < 3 && Math.abs(x) < 0.25 && y > 2.2 && y < 6) blocking++; // straight ahead above head height
  }
  assert.ok(glyphNear > 300, 'glyphs near touch ' + glyphNear);
  assert.strictEqual(blocking, 0, 'points blocking the view ahead');
});

test('stele stays below her head (about 70% of the first 1.72 m version)', () => {
  const st = SR.gen.STELE, R = G.ruins;
  let tall = 0;
  for (let i = 0; i < R.pos.length; i += 3) {
    const x = R.pos[i], y = R.pos[i + 1], z = R.pos[i + 2];
    if (Math.hypot(x - st.touch[0], z - st.touch[2]) < 3 && y > 1.38) tall++;
  }
  assert.strictEqual(tall, 0, 'points above 1.38 m around the stele: ' + tall);
  assert.ok(st.hRuin <= 1.25 && st.hRuin >= 1.1, 'hRuin ' + st.hRuin);
  assert.ok(st.touch[1] < st.hRuin - 0.1, 'touch must be below the broken top: ' + st.touch[1]);
});

test('stele body and its rubble lie beyond the inscribed face, not around her', () => {
  const st = SR.gen.STELE, R = G.ruins;
  let nearSide = 0;
  for (let i = 0; i < R.pos.length; i += 3) {
    const x = R.pos[i], y = R.pos[i + 1], z = R.pos[i + 2];
    if (Math.hypot(x, z) > 3.5) continue;
    // signed distance from the inscribed face plane, positive = away from her
    const d = (x - st.touch[0]) * st.n[0] + (z - st.touch[2]) * st.n[2];
    if (d < -0.05) nearSide++;
  }
  assert.strictEqual(nearSide, 0, 'ruin points on her side of the stele face: ' + nearSide);
});

test('a worn handprint (no rings) marks the touch point, inside the stele and blending with the script', () => {
  const st = SR.gen.STELE, R = G.ruins;
  let sigil = 0, outside = 0, aboveTop = 0, glyphTooClose = 0, glyphNearby = 0;
  for (let i = 0; i < R.pos.length; i += 3) {
    const j = (i / 3) * 4, type = R.attr[j + 1];
    const dx = R.pos[i] - st.touch[0], dy = R.pos[i + 1] - st.touch[1], dz = R.pos[i + 2] - st.touch[2];
    const d = Math.hypot(dx, dy, dz), u = dx * st.u[0] + dz * st.u[2];
    if (type === 8) {
      sigil++;
      if (d > 0.13) outside++;                                  // nothing beyond the palm-sized mark
      if (R.pos[i + 1] > st.topAt(u) - 0.02) aboveTop++;        // never above the broken top
    }
    if (type === 1 && d < 0.12) glyphTooClose++;
    if (type === 1 && d >= 0.12 && d < 0.3) glyphNearby++;
  }
  assert.ok(sigil > 1500, 'handprint points ' + sigil);
  assert.strictEqual(outside, 0, 'sigil points outside the handprint (rings?) ' + outside);
  assert.strictEqual(aboveTop, 0, 'sigil points above the stele top ' + aboveTop);
  assert.strictEqual(glyphTooClose, 0, 'glyphs on top of the handprint ' + glyphTooClose);
  assert.ok(glyphNearby > 100, 'worn script should come close around it ' + glyphNearby);
});

// --- README to-do 1: heroine is one continuous suited body, not stacked ellipsoids ---
test('heroine: every point lies on one continuous body surface (no inner seams)', () => {
  const H = G.heroine, sdf = SR.gen.heroineSDF;
  assert.ok(typeof sdf === 'function', 'heroineSDF exported');
  let off = 0;
  for (let i = 0; i < H.pos.length; i += 3) {
    if (H.attr[(i / 3) * 4 + 3] > 0) continue;            // reaching-arm points are checked at rest pose too, below
    if (Math.abs(sdf([H.pos[i], H.pos[i + 1], H.pos[i + 2]])) > 0.006) off++;
  }
  assert.ok(off < H.pos.length / 3 * 0.002, 'points off the surface: ' + off);
  assert.ok(H.pos.length / 3 >= 90000, 'dense enough for close-ups: ' + H.pos.length / 3);
});

test('heroine: suit details exist (dark visor under a bright rim) and the reaching arm is skinned smoothly', () => {
  const H = G.heroine;
  let visorDark = 0, partial = 0, full = 0, leftArmWeighted = 0;
  for (let i = 0, n = H.pos.length / 3; i < n; i++) {
    const x = H.pos[i * 3], y = H.pos[i * 3 + 1], z = H.pos[i * 3 + 2], b = H.attr[i * 4], w = H.attr[i * 4 + 3];
    if (y > 1.5 && y < 1.64 && z > 0.1 && b < 0.2) visorDark++;
    if (w > 0.02 && w < 0.98) partial++;
    if (w >= 0.98) full++;
    if (x > 0.15 && w > 0) leftArmWeighted++;
  }
  assert.ok(visorDark > 300, 'visor points ' + visorDark);
  assert.ok(full > 3000 && partial > 100, `arm weights full=${full} partial=${partial}`);
  assert.strictEqual(leftArmWeighted, 0, 'only her right arm (-x) reaches');
});

test('heroine: each point carries its outward surface normal (in alt) for back-face dimming', () => {
  const H = G.heroine, sdf = SR.gen.heroineSDF, e = 0.001;
  let bad = 0, checked = 0;
  for (let i = 0; i < H.pos.length; i += 3 * 37) {
    if (H.attr[(i / 3) * 4 + 3] > 0) continue;
    const p = [H.pos[i], H.pos[i + 1], H.pos[i + 2]], n = [H.alt[i], H.alt[i + 1], H.alt[i + 2]];
    const g = [0, 1, 2].map(k => { const a = p.slice(), b = p.slice(); a[k] += e; b[k] -= e; return sdf(a) - sdf(b); });
    const gl = Math.hypot(...g), nl = Math.hypot(...n);
    checked++;
    if (Math.abs(nl - 1) > 0.02 || (g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / gl < 0.9) bad++;
  }
  assert.ok(checked > 1000);
  assert.ok(bad < checked * 0.01, `bad normals ${bad}/${checked}`);
});

// --- front full body and visor (user request 2026-11-01) ---
test('heroineSDF can be limited to named parts (testing hook)', () => {
  const elbow = SR.gen.HJ.LE;
  assert.ok(SR.gen.heroineSDF(elbow) < 0, 'elbow is inside the full body');
  assert.ok(SR.gen.heroineSDF(elbow, ['hips', 'torso']) > 0.03, 'elbow is outside torso-only');
});
const halfWidth = (labels, y, z) => {           // scan +x from the centre until we leave the selected parts
  let x = 0; while (x < 0.4 && SR.gen.heroineSDF([x, y, z], labels) < 0) x += 0.001; return x;
};
test('heroine front: hourglass torso silhouette, not a straight box', () => {
  const T = ['hips', 'torso'];
  const chest = halfWidth(T, 1.24, 0), waist = halfWidth(T, 1.07, 0), hips = halfWidth(T, 0.93, 0);
  assert.ok(waist / chest <= 0.82, `waist/chest ${(waist / chest).toFixed(2)} (${waist.toFixed(3)}/${chest.toFixed(3)})`);
  assert.ok(hips / waist >= 1.2, `hips/waist ${(hips / waist).toFixed(2)}`);
});
test('heroine front: backpack hides behind the torso and the chest unit is a flush panel', () => {
  const chest = halfWidth(['hips', 'torso'], 1.24, 0);
  let packMax = 0;
  for (let y = 1.0; y <= 1.42; y += 0.02) packMax = Math.max(packMax, halfWidth(['pack'], y, -0.175));
  assert.ok(packMax <= chest - 0.02, `pack ${packMax.toFixed(3)} vs chest ${chest.toFixed(3)}`);
  const front = labels => { let z = 0.3; while (z > 0 && SR.gen.heroineSDF([0, 1.2, z], labels) > 0) z -= 0.0005; return z; };
  assert.ok(front(null) - front(['hips', 'torso']) <= 0.005, 'protrusion ' + (front(null) - front(['hips', 'torso'])).toFixed(4));
});
test('heroine visor: a dark, sparse glass framed by a bright rim; back faces nearly vanish', () => {
  const H = G.heroine, c = SR.gen.HJ.HEAD;
  let visor = 0, visorB = 0, rim = 0, shell = 0;
  for (let i = 0, n = H.pos.length / 3; i < n; i++) {
    const v = SR.v3.norm([H.pos[i * 3] - c[0], H.pos[i * 3 + 1] - c[1], H.pos[i * 3 + 2] - c[2]]);
    if (SR.v3.len([H.pos[i * 3] - c[0], H.pos[i * 3 + 1] - c[1], H.pos[i * 3 + 2] - c[2]]) > 0.2) continue;
    const b = H.attr[i * 4];
    if (v[2] > 0.5 && Math.abs(v[0]) < 0.6 && v[1] > -0.3 && v[1] < 0.4) { visor++; visorB += b; }
    else if (v[2] < 0.2 && v[1] > -0.3) shell++;
    if (b >= 0.9 && v[2] > 0.3) rim++;
  }
  assert.ok(visorB / visor <= 0.08, 'visor mean brightness ' + (visorB / visor).toFixed(3));
  assert.ok(rim > 400, 'rim points ' + rim);
  assert.ok(SR.HERO_BACK <= 0.06, 'back-face floor ' + SR.HERO_BACK);
});
test('heroine front: arms hang free of the torso below the armpit (visible gap)', () => {
  for (const y of [1.22, 1.15]) {
    const torso = halfWidth(['hips', 'torso'], y, 0), body = halfWidth(null, y, 0);
    assert.ok(body <= torso + 0.012, `y=${y}: body exits at ${body.toFixed(3)}, torso edge ${torso.toFixed(3)} (arm fused to torso)`);
  }
});
test('heroine: point density is even over the body (no sparse patch on the chest)', () => {
  const H = G.heroine;
  const count = (x0, x1, y0, y1) => { let n = 0; for (let i = 0; i < H.pos.length / 3; i++) {
    const x = H.pos[i * 3], y = H.pos[i * 3 + 1], z = H.pos[i * 3 + 2];
    if (z > 0.03 && H.alt[i * 3 + 2] > 0.5 && x >= x0 && x < x1 && y >= y0 && y < y1) n++; } return n; };
  const chest = count(-0.06, 0.06, 1.2, 1.29), waist = count(-0.06, 0.06, 1.03, 1.12);
  assert.ok(chest / waist >= 0.85, `chest/waist density ${(chest / waist).toFixed(2)} (${chest}/${waist})`);
});
test('whale head is blunt and massive (not a fish-like point); the tail stays slender', () => {
  let mx = 0; for (let s = 0; s <= 1; s += 0.001) mx = Math.max(mx, SR.gen.prof(s));
  const r = s => SR.gen.prof(s) / mx;
  assert.ok(r(0.02) >= 0.55, 'r(0.02) ' + r(0.02).toFixed(2));
  assert.ok(r(0.06) >= 0.8, 'r(0.06) ' + r(0.06).toFixed(2));
  assert.ok(r(0.95) <= 0.15, 'r(0.95) ' + r(0.95).toFixed(2));
  assert.strictEqual(SR.gen.prof(0), 0);
});
test('whale body has no seams: profile is continuous and smooth, belly pleats fade out', () => {
  const Rm = SR.gen.WHALE.Rm, d = 0.0005;
  let jump = 0, jumpAt = 0, kink = 0, kinkAt = 0;
  for (let s = d; s < 1 - d; s += d) {
    const a = SR.gen.prof(s - d) / Rm, b = SR.gen.prof(s) / Rm, c = SR.gen.prof(s + d) / Rm;
    if (s > 0.04 && Math.abs(c - b) > jump) { jump = Math.abs(c - b); jumpAt = s; }   // the blunt head's steep rounded front (s < 4%) is intended
    if (s > 0.12 && Math.abs((c - b) / d - (b - a) / d) > kink) { kink = Math.abs((c - b) / d - (b - a) / d); kinkAt = s; }
  }
  assert.ok(jump < 0.004, `step of ${(jump * 100).toFixed(1)}% radius at s=${jumpAt.toFixed(3)}`);
  assert.ok(kink < 0.05, `slope breaks by ${kink.toFixed(2)} at s=${kinkAt.toFixed(3)}`);
  let pleat = 0;
  for (let th = -Math.PI / 2 - 0.5; th <= -Math.PI / 2 + 0.5; th += 0.01) {
    const r = s => Math.hypot(...SR.gen.whaleBody(s, th, 1).slice(1));
    for (let s = 0.3; s < 0.8; s += 0.002) pleat = Math.max(pleat, Math.abs(r(s + 0.001) - 2 * r(s) + r(s - 0.001)) / Rm);   // a step/kink, not the taper
  }
  assert.ok(pleat < 0.005, 'belly pleats stop abruptly: ' + (pleat * 100).toFixed(2) + '%');
});


// --- README to-do 5: in the ruins the buried part of the ziggurat stair lay on the mound as a flat white plate ---
test('ziggurat stair: buried steps are hidden in the ruins (no bright plate on the mound) and rise with the city', () => {
  const R = G.ruins, BURIED = SR.gen.BURIED;
  assert.ok(BURIED > 0 && BURIED < 0.5, 'buried points are a kind of inanimate point (type 0 group in the shader)');
  let strip = 0, side = 0, buried = 0, exposed = 0;
  for (let i = 0; i < R.pos.length / 3; i++) {
    const x = R.pos[i * 3], z = R.pos[i * 3 + 2], ax = R.alt[i * 3], ay = R.alt[i * 3 + 1], az = R.alt[i * 3 + 2];
    if (R.attr[i * 4 + 1] === BURIED) {
      buried++;
      if (Math.abs(ax) <= 12 && az >= 340 && az <= 442 && ay > SR.gen.height(ax, az)) exposed++;   // stair: only what lies under the sand is hidden
      continue;
    }
    if (R.attr[i * 4 + 1] === SR.gen.XRAY) continue;              // the sonar x-ray is off in the ruins (only the 1:18-1:34 rise)
    if (z < 350 || z > 400) continue;                            // the mound face the stair runs up
    if (Math.abs(x) < 12) strip++; else if (Math.abs(x) > 12 && Math.abs(x) < 28) side++;   // beside it, short of the avenue columns (|x| ~34)
  }
  const dStrip = strip / 24, dSide = side / 32;                  // shown points per metre of width
  console.log('stair strip', dStrip.toFixed(0), 'beside', dSide.toFixed(0), 'buried', buried);
  assert.ok(buried > 5000, 'buried stair points: ' + buried);
  assert.strictEqual(exposed, 0, 'steps above the sand stay visible');
  assert.ok(dStrip <= 1.3 * dSide, `bright plate: stair strip ${dStrip.toFixed(0)}/m vs beside ${dSide.toFixed(0)}/m`);
  assert.ok(dStrip >= 0.7 * dSide, `dark gap: stair strip ${dStrip.toFixed(0)}/m vs beside ${dSide.toFixed(0)}/m`);
});

// --- README to-do 3: the dense flight corridor ended in hard straight edges and read as a map sheet laid on the land ---
test('terrain: the flight corridor has no hard edge (its density fades out over tens of metres at its sides and ends)', () => {
  const T = G.terrain, across = new Array(30).fill(0), along = new Array(100).fill(0), CORRIDOR = Math.fround(0.92);
  for (let i = 0; i < T.pos.length / 3; i++) {
    if (T.attr[i * 4 + 3] !== CORRIDOR) continue;                 // corridor points (the radial bands use other spacings)
    const x = T.pos[i * 3], z = T.pos[i * 3 + 2];
    if (z > 200 && z < 500 && Math.abs(x) < 300) across[Math.floor(Math.abs(x) / 10)]++;   // 10 m strips, both sides folded
    if (Math.abs(x) < 100 && z >= -100 && z < 900) along[Math.floor((z + 100) / 10)]++;   // 10 m strips along its axis
  }
  // width of the edge: from 10 % to 90 % of the full density, walking in from the outside
  const edge = a => {
    const sm = a.map((v, k) => (a[Math.max(0, k - 1)] + v + a[Math.min(a.length - 1, k + 1)]) / 3), peak = Math.max(...sm);
    const i10 = a.findIndex(v => v >= 0.1 * peak), i90 = a.findIndex(v => v >= 0.9 * peak);
    return (i90 - i10) * 10;
  };
  const side = edge(across.slice().reverse()), near = edge(along), far = edge(along.slice().reverse());
  console.log('corridor edge widths (m): side', side, 'near end', near, 'far end', far);
  for (const [name, w] of [['side', side], ['near end', near], ['far end', far]]) assert.ok(w >= 40, `${name}: density rises from 10% to 90% within ${w} m (hard edge)`);
});

// --- README to-do 3 (scale reversal): in the 1:18-1:34 rise the sonar sees the buried ziggurat through the mound ---
test('x-ray: the buried ziggurat (tiers and stair) is traced at its true place under the mound, nowhere else', () => {
  const R = G.ruins, XRAY = SR.gen.XRAY, Z = SR.gen.ZIG;
  assert.ok(XRAY > 0.3 && XRAY < 0.45 && XRAY !== SR.gen.BURIED, 'its own kind of inanimate point');
  let n = 0, above = 0, moved = 0, outside = 0, stairEdges = 0;
  const tiers = new Set();
  for (let i = 0; i < R.pos.length / 3; i++) {
    if (R.attr[i * 4 + 1] !== XRAY) continue;
    n++;
    const x = R.pos[i * 3], y = R.pos[i * 3 + 1], z = R.pos[i * 3 + 2];
    if (y >= SR.gen.height(x, z)) above++;                                       // only what the sand hides
    if (x !== R.alt[i * 3] || y !== R.alt[i * 3 + 1] || z !== R.alt[i * 3 + 2]) moved++;   // never flies about
    if (Math.max(Math.abs(x - Z.x), Math.abs(z - Z.z)) > Z.half + 0.5) outside++;
    if (Math.abs(x - Z.x) < 12.5 && z < Z.z - Z.half + 100) stairEdges++;
    tiers.add(Math.floor((y - Z.base) / Z.th));
  }
  console.log('x-ray points', n, 'tiers', [...tiers].sort().join(','), 'stair', stairEdges);
  assert.ok(n > 10000, 'x-ray points: ' + n);
  assert.strictEqual(above, 0, 'points above the sand');
  assert.strictEqual(moved, 0, 'points that move between ruin and city');
  assert.strictEqual(outside, 0, 'points outside the ziggurat footprint');
  assert.ok(tiers.has(0) && tiers.has(1) && tiers.has(2), 'the lower tiers are traced');
  assert.ok(stairEdges > 1000, 'the buried stair is traced: ' + stairEdges);
});

// --- user 2026-11-01: as the epoch drifts back and the city stands again, the sand mound over it must go too ---
test('past epoch: the sand mound is gone (flat plaza at the ziggurat foot); the rest of the land is unchanged', () => {
  const T = G.terrain, Z = SR.gen.ZIG, past = SR.gen.heightPast;
  const md = (x, z) => Math.hypot(x - Z.x, z - Z.z) * 0.5 + Math.max(Math.abs(x - Z.x), Math.abs(z - Z.z)) * 0.5;
  let sank = 0, wrong = 0, farMoved = 0, plaza = 0, plazaOff = 0;
  for (let i = 0; i < T.pos.length / 3; i++) {
    const x = T.pos[i * 3], y = T.pos[i * 3 + 1], z = T.pos[i * 3 + 2], ax = T.alt[i * 3], ay = T.alt[i * 3 + 1], az = T.alt[i * 3 + 2];
    if (ax !== x || az !== z) wrong++;                                   // the sand only sinks, never slides
    if (Math.abs(ay - past(x, z)) > 1e-3) wrong++;
    if (y - ay > 1) sank++;
    if (md(x, z) > 245 && ay !== y) farMoved++;
    if (Math.max(Math.abs(x - Z.x), Math.abs(z - Z.z)) < Z.half + 12) { plaza++; if (Math.abs(ay - (Z.base + 0.5)) > 0.01) plazaOff++; }
  }
  console.log('past epoch: sinking sand points', sank, 'plaza points', plaza);
  assert.ok(sank > 20000, 'sand points that sink: ' + sank);
  assert.strictEqual(wrong, 0, 'points not on the old ground');
  assert.strictEqual(farMoved, 0, 'land away from the mound must not move');
  assert.strictEqual(plazaOff, 0, 'the ziggurat stands on a flat plaza at its foot');
  assert.ok(SR.gen.height(Z.x, Z.z) > 60 && Math.abs(past(Z.x, Z.z) - (Z.base + 0.5)) < 1e-6, 'mound today, plaza then');
});

test('past epoch: the avenue columns by the mound stood on the old ground; today their lower part is under the sand', () => {
  const R = G.ruins, past = SR.gen.heightPast, BURIED = SR.gen.BURIED;
  for (const k of [8, 9]) for (const sx of [-1, 1]) {
    const cx = sx * 34, cz = 46 + k * 34;
    let shown = 0, shownUnder = 0, hidden = 0, low = 1e9;
    for (let i = 0; i < R.pos.length / 3; i++) {
      const ax = R.alt[i * 3], ay = R.alt[i * 3 + 1], az = R.alt[i * 3 + 2];
      if (Math.hypot(ax - cx, az - cz) > 7 || ay > 80) continue;          // this column in the intact city
      low = Math.min(low, ay);
      const x = R.pos[i * 3], y = R.pos[i * 3 + 1], z = R.pos[i * 3 + 2];
      if (R.attr[i * 4 + 1] === BURIED) { hidden++; continue; }
      if (R.attr[i * 4 + 1] === SR.gen.XRAY) continue;                  // the sonar x-ray is off in the ruins (1:18-1:34 only)
      shown++;
      if (y < SR.gen.height(x, z) - 2.5) shownUnder++;
    }
    const where = `column k${k} x${sx * 34}`;
    assert.ok(low < past(cx, cz) + 1, `${where}: stands on the old ground (${low.toFixed(1)} vs ${past(cx, cz).toFixed(1)})`);
    assert.ok(hidden > 1000, `${where}: its buried part is hidden today (${hidden})`);
    assert.strictEqual(shownUnder, 0, `${where}: visible points under today's sand`);
  }
});

// --- README to-do 6: the terrain's density bands (24.8 / 1.9 / 0.15 / 0.015 per m2) ended in hard circles, so from
// above (5:12-5:28 retreat) the land read as stacked discs; the density must change smoothly with the distance from her
test('terrain: no density step around her (no discs from above); the land fades out at its far edge', () => {
  const T = G.terrain, CORRIDOR = Math.fround(0.92);
  const edges = [0]; while (edges[edges.length - 1] < 2400) { const r = edges[edges.length - 1]; edges.push(r + Math.max(5, 0.12 * r)); }
  const n = new Array(edges.length - 1).fill(0);
  for (let i = 0; i < T.pos.length / 3; i++) {
    if (T.attr[i * 4 + 3] === CORRIDOR) continue;                    // the corridor has its own (already soft) edges
    const r = Math.hypot(T.pos[i * 3], T.pos[i * 3 + 2]);
    let k = 0; while (k < n.length - 1 && r >= edges[k + 1]) k++;
    if (r < edges[edges.length - 1]) n[k]++;
  }
  const dens = n.map((c, k) => c / (Math.PI * (edges[k + 1] ** 2 - edges[k] ** 2)));
  let worst = 1, at = 0, farEdge = -1;
  for (let k = 1; k < dens.length; k++) {
    if (edges[k] < 1250) { const q = Math.max(dens[k] / dens[k - 1], dens[k - 1] / dens[k]); if (q > worst) { worst = q; at = edges[k]; } }
  }
  const d1000 = dens[edges.findIndex(e => e > 1000) - 1];
  for (let k = 0; k < dens.length; k++) if (edges[k] > 1000 && dens[k] < 0.1 * d1000 && farEdge < 0) farEdge = edges[k];
  const half = dens.findIndex((d, k) => edges[k] > 1000 && d < 0.5 * d1000);
  console.log('terrain radial density: worst step x' + worst.toFixed(2) + ' at r=' + at.toFixed(0) + ' m; far edge 50%..10% at', edges[half].toFixed(0), '..', farEdge.toFixed(0), 'm');
  assert.ok(worst <= 2, `density jumps x${worst.toFixed(1)} at r=${at.toFixed(0)} m (a disc edge)`);
  assert.ok(farEdge - edges[half] >= 200, 'the far edge fades over at least 200 m');
  assert.ok(dens[0] > 15 && d1000 < 0.05, 'dense at her feet, sparse far away (the bands keep their levels)');
});
