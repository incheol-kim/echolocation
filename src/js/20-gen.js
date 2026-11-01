// ---------- point generators ----------
// Every generator returns { pos, alt, attr }:
//   pos  Float32Array(n*3)  ruined / resting position
//   alt  Float32Array(n*3)  intact-civilisation position (ruins) — equals pos elsewhere
//   attr Float32Array(n*4)  [brightness 0..1, type, rand 0..1, aux]
// type: 0 inanimate, 1 glyph, 2 creature, 3 heroine, 4 star, 5 cloud, 6 creature eye, 7 ring
// aux:  whale -> head(0)..tail(1); heroine -> 1 on the right arm; star -> twinkle phase
SR.gen = (function () {
  const TAU = SR.TAU, v3 = SR.v3, clamp = SR.clamp, smooth = SR.smooth;
  const SUN = v3.norm([0.35, 0.8, -0.5]);

  function Builder(cap) {
    cap = cap || 65536;
    let n = 0, pos = new Float32Array(cap * 3), alt = new Float32Array(cap * 3), attr = new Float32Array(cap * 4);
    function grow() {
      cap *= 2;
      const p = new Float32Array(cap * 3); p.set(pos); pos = p;
      const a = new Float32Array(cap * 3); a.set(alt); alt = a;
      const t = new Float32Array(cap * 4); t.set(attr); attr = t;
    }
    return {
      push(x, y, z, ax, ay, az, b, type, r, aux) {
        if (n >= cap) grow();
        const i3 = n * 3, i4 = n * 4;
        pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
        alt[i3] = ax; alt[i3 + 1] = ay; alt[i3 + 2] = az;
        attr[i4] = b; attr[i4 + 1] = type; attr[i4 + 2] = r; attr[i4 + 3] = aux;
        n++;
      },
      get n() { return n; },
      done() { return { pos: pos.slice(0, n * 3), alt: alt.slice(0, n * 3), attr: attr.slice(0, n * 4) }; },
    };
  }

  // ---------- noise ----------
  function hash2(ix, iz, s) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul((s | 0) + 1013, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // lattice value noise backed by precomputed tables (seed shifts the domain)
  const NT = 512, NM = NT - 1, TAB = new Float32Array(NT * NT);
  { const r = SR.rng(424242); for (let i = 0; i < TAB.length; i++) TAB[i] = r(); }
  function vnoise(x, z, s) {
    x += s * 17.131; z += s * 31.717;
    const fx0 = Math.floor(x), fz0 = Math.floor(z), fx = x - fx0, fz = z - fz0;
    const ix = fx0 & NM, iz = fz0 & NM, ix1 = (ix + 1) & NM, iz1 = (iz + 1) & NM;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = TAB[iz * NT + ix], b = TAB[iz * NT + ix1], c = TAB[iz1 * NT + ix], d = TAB[iz1 * NT + ix1];
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  const FBN = [0, 1 / 0.5, 1 / 0.75, 1 / 0.875, 1 / 0.9375, 1 / 0.96875, 1 / 0.984375];
  function fbm(x, z, s, oct) {
    oct = oct || 4;
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += a * vnoise(x * f, z * f, s + o * 17); f *= 2.03; a *= 0.5; }
    return v * FBN[oct];
  }
  const N3 = 64, N3M = N3 - 1, TAB3 = new Float32Array(N3 * N3 * N3);
  { const r = SR.rng(737373); for (let i = 0; i < TAB3.length; i++) TAB3[i] = r(); }
  function vnoise3(x, y, z, s) {
    x += s * 5.31; y += s * 7.77; z += s * 3.19;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const x0 = X & N3M, y0 = Y & N3M, z0 = Z & N3M, x1 = (x0 + 1) & N3M, y1 = (y0 + 1) & N3M, z1 = (z0 + 1) & N3M;
    const g = (i, j, k) => TAB3[(k * N3 + j) * N3 + i];
    const a = g(x0, y0, z0) + (g(x1, y0, z0) - g(x0, y0, z0)) * ux, b = g(x0, y1, z0) + (g(x1, y1, z0) - g(x0, y1, z0)) * ux;
    const c = g(x0, y0, z1) + (g(x1, y0, z1) - g(x0, y0, z1)) * ux, d = g(x0, y1, z1) + (g(x1, y1, z1) - g(x0, y1, z1)) * ux;
    const e = a + (b - a) * uy, f = c + (d - c) * uy;
    return e + (f - e) * uz;
  }
  function fbm3(x, y, z, s, oct) {
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += a * vnoise3(x * f, y * f, z * f, s + o * 13); f *= 2.07; a *= 0.5; }
    return v * FBN[oct];
  }

  // ---------- world layout ----------
  const ZIG = { x: 0, z: 470, half: 130, tiers: 6, th: 20, base: -6 };
  // point type for the part of a structure that lies under the sand: an inanimate point (type-0 group in the shader)
  // that is hidden in the ruins and appears as the intact city assembles (README to-do 5: the buried stair was a white plate)
  const BURIED = 0.25;
  // point type for the sonar's x-ray of the buried ziggurat (README to-do 3, scale reversal): fixed at its true place under
  // the mound, shown only while the director's xray is on (the 1:18-1:34 rise), tinted like the scan
  const XRAY = 0.375;
  const RIDGE_Z = 860;
  // her reaching arm (her right = -x, she faces +z) and the stele it touches
  // heroine joints (her right = -x, she faces +z); the reach animation pivots at RS
  const HJ = {
    RS: [-0.19, 1.36, 0.0], RE: [-0.252, 1.115, 0.0], RW: [-0.268, 0.895, 0.06], RF: [-0.274, 0.76, 0.09],
    LS: [0.19, 1.36, 0.0], LE: [0.255, 1.115, 0.01], LW: [0.275, 0.895, 0.07], LF: [0.282, 0.76, 0.1],
    LH: [0.09, 0.9, 0.0], LK: [0.095, 0.49, 0.01], LA: [0.1, 0.1, -0.01],
    RH: [-0.09, 0.885, 0.005], RK: [-0.1, 0.48, 0.06], RA: [-0.11, 0.1, 0.03],
    HEAD: [0, 1.57, 0.015],
  };
  const SHOULDER = HJ.RS, ARM_LEN = v3.len(v3.sub(HJ.RF, HJ.RS)), ARM_REST = v3.norm(v3.sub(HJ.RF, HJ.RS));
  const REACH = v3.norm([-0.45, -0.55, 0.75]);
  const STELE = (function () {
    const touch = v3.add(SHOULDER, v3.scale(REACH, ARM_LEN));
    const n = v3.norm([REACH[0], 0, REACH[2]]);          // from her toward the face
    const u = v3.norm(v3.cross(n, [0, 1, 0]));           // along the face, + = outward to her right
    const hRuin = 1.2;
    const topAt = w => hRuin + 0.2 * (vnoise(w * 2.3, 4, 91) - 0.5) - 0.18 * Math.max(0, w - 0.6); // broken top line
    return { touch, n, u, w0: -0.75, w1: 1.3, hRuin, hIntact: 3.2, thick: 0.5, topAt };
  })();

  // large-scale relief (dunes, ridge, mound) — evaluated exactly at every point (no grid cache: quality first)
  function reliefRaw(x, z) {
    let h = Math.sin(x * 0.018 + 1.7 * Math.sin(z * 0.007)) * 2.2 + (fbm(x * 0.006, z * 0.006, 11, 4) - 0.5) * 26;
    const rz = (z - RIDGE_Z - 70 * Math.sin(x * 0.004)) / 130;
    h += Math.exp(-rz * rz) * (85 + 40 * vnoise(x * 0.005, 3.1, 31));
    return h + 72 * (1 - smooth(70, 240, zigDist(x, z)));
  }
  function zigDist(x, z) { return Math.hypot(x - ZIG.x, z - ZIG.z) * 0.5 + Math.max(Math.abs(x - ZIG.x), Math.abs(z - ZIG.z)) * 0.5; }
  function height(x, z) {
    const r = Math.hypot(x, z);
    if (r < 4) return 0;
    const h = reliefRaw(x, z) + (vnoise(x * 0.04, z * 0.04, 23) - 0.5) * 2.4 + 0.06 * Math.sin(x * 2.6 + z * 1.1 + 3 * vnoise(x * 0.2, z * 0.2, 5));
    return h * smooth(4, 45, r);
  }
  // The ground of the intact city, before the sand came (user 2026-11-01: as the epoch drifts back the mound must go too):
  // today's ground minus the sand mound over the ziggurat, flattened to a plaza at the ziggurat's foot. y = height(x, z).
  const PLAZA_Y = ZIG.base + 0.5;
  function mound(x, z) { return 72 * (1 - smooth(70, 240, zigDist(x, z))) * smooth(4, 45, Math.hypot(x, z)); }
  function pastOf(x, z, y) { return SR.lerp(y - mound(x, z), PLAZA_Y, 1 - smooth(175, 240, zigDist(x, z))); }   // flat to ~12 m past the corners
  function heightPast(x, z) { return pastOf(x, z, height(x, z)); }
  function lit(n, rnd) { return clamp((0.32 + 0.68 * Math.max(0, v3.dot(n, SUN))) * (0.82 + 0.18 * rnd), 0, 1); }

  // ---------- terrain ----------
  function terrain(seed) {
    const R = SR.rng(seed * 101 + 1), B = Builder(1 << 19);
    // Points per m2 around her: the levels of the old bands (0-30, 30-140, 140-520, 520-1700 m), but joined smoothly in
    // log space and fading out past 1700 m. With hard band edges the land read as stacked discs from above (README to-do 6).
    // Each point's spacing (aux) follows the local density, so its splat energy matches.
    const LV = [70000 / (Math.PI * 30 * 30), 110000 / (Math.PI * (140 * 140 - 30 * 30)), 120000 / (Math.PI * (520 * 520 - 140 * 140)), 120000 / (Math.PI * (1700 * 1700 - 520 * 520))];
    const JOIN = [[30, 18], [140, 60], [520, 200]];   // band edge radius, half-width of the join
    const level = r => Math.exp(JOIN.reduce((L, [b, w], k) => L + (Math.log(LV[k + 1]) - Math.log(LV[k])) * smooth(b - w, b + w, r), Math.log(LV[0])));
    const far = r => 1 - smooth(1300, 2100, r);
    const shells = [0, 12, 48, 80, 200, 320, 720, 1300, 2100];   // density falls with r, so each shell's peak is at its inner radius
    for (let sh = 0; sh + 1 < shells.length; sh++) {
      const r0 = shells[sh], r1 = shells[sh + 1], top = level(r0) * far(r0), nC = Math.round(top * Math.PI * (r1 * r1 - r0 * r0));
      for (let i = 0; i < nC; i++) {
        const a = R() * TAU, rr = Math.sqrt(r0 * r0 + R() * (r1 * r1 - r0 * r0)), lv = level(rr);
        if (R() * top >= lv * far(rr)) continue;
        const spc = 1 / Math.sqrt(lv);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr, y = height(x, z);
        const e = Math.max(0.5, rr * 0.01);
        const nn = v3.norm([-(height(x + e, z) - y) / e, 1, -(height(x, z + e) - y) / e]);
        const b = lit(nn, R()) * 0.85, rnd = R(), py = pastOf(x, z, y);
        B.push(x, y, z, x, py, z, b, 0, py === y ? rnd : 0.45 + 0.1 * rnd, spc);   // sand over the city: one timing, so the mound sinks as a whole
      }
    }
    // corridor where the camera flies: avenue -> ziggurat. Same density inside as before (230k points over 340 x 700 m),
    // but it fades out over ~120 m at its sides and ends: with hard straight edges it read as a map sheet (README to-do 3)
    const CX = 230, CZ0 = -60, CZ1 = 820, cN = Math.round(230000 / (340 * 700) * (2 * CX) * (CZ1 - CZ0));
    for (let i = 0; i < cN; i++) {
      const x = (R() - 0.5) * 2 * CX, z = CZ0 + R() * (CZ1 - CZ0);
      if (R() >= (1 - smooth(110, CX, Math.abs(x))) * smooth(CZ0, 20, z) * (1 - smooth(700, CZ1, z))) continue;
      const y = height(x, z);
      const nn = v3.norm([-(height(x + 1, z) - y), 1, -(height(x, z + 1) - y)]);
      const b = lit(nn, R()) * 0.85, rnd = R(), py = pastOf(x, z, y);
      B.push(x, y, z, x, py, z, b, 0, py === y ? rnd : 0.45 + 0.1 * rnd, 0.92);
    }
    return B.done();
  }

  // ---------- ruins helpers ----------
  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, l = dx * dx + dy * dy;
    const t = l ? clamp(((px - x0) * dx + (py - y0) * dy) / l, 0, 1) : 0;
    return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
  }
  // alien script: cells with 2-4 strokes (snapped segments, rings, dots)
  function glyphAt(u, v, s, cw, ch) {
    cw = cw || 0.8; ch = ch || 1.0;
    const cu = Math.floor(u / cw), cv = Math.floor(v / ch), lu = u - cu * cw, lv = v - cv * ch;
    const mu = cw * 0.15, mv = ch * 0.15;
    if (lu < mu || lu > cw - mu || lv < mv || lv > ch - mv) return false;
    if (hash2(cu, cv, s) < 0.12) return false;
    const x = (lu - mu) / (cw - 2 * mu), y = (lv - mv) / (ch - 2 * mv);
    const ns = 2 + Math.floor(hash2(cu, cv, s + 1) * 3);
    for (let k = 0; k < ns; k++) {
      const a = hash2(cu * 7 + k, cv, s + 2), b = hash2(cu, cv * 7 + k, s + 3);
      const c = hash2(cu + k, cv + k, s + 4), d = hash2(cu - k, cv + 3 * k, s + 5);
      const kind = hash2(cu + k * 13, cv - k, s + 6);
      if (kind < 0.62) {
        if (segDist(x, y, Math.round(a * 2) / 2, Math.round(b * 2) / 2, Math.round(c * 2) / 2, Math.round(d * 2) / 2) < 0.075) return true;
      } else if (kind < 0.86) {
        const r = 0.14 + 0.2 * a;
        if (Math.abs(Math.hypot(x - 0.5, y - (0.3 + 0.4 * b)) - r) < 0.065) return true;
      } else if (Math.hypot(x - (0.2 + 0.6 * a), y - (0.2 + 0.6 * b)) < 0.1) return true;
    }
    return false;
  }
  // random point on a chunk of a rubble heap around (cx, cz): blocky debris, not a disc
  function heap(R, cx, cz, rad, hgt) {
    const key = Math.floor(cx * 3.1) * 7 + Math.floor(cz * 1.7), k = Math.floor(R() * 26);
    const a = hash2(key, k, 1) * TAU, r = rad * Math.sqrt(hash2(key, k, 2));
    const x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r, sz = (1.2 + 3.5 * hash2(key, k, 3)) * Math.min(1, rad / 8);
    const y0 = height(x0, z0) + hgt * Math.pow(1 - r / rad, 1.2) * hash2(key, k, 4);
    const f = Math.floor(R() * 3), u = R() - 0.5, v = R() - 0.5, side = R() < 0.5 ? -0.5 : 0.5;
    const d = f === 0 ? [side, u, v] : f === 1 ? [u, side, v] : [u, v, side];
    return [x0 + d[0] * sz, Math.max(y0 + d[1] * sz * 0.7, height(x0, z0)) + 0.2, z0 + d[2] * sz];
  }
  function ruins(seed) {
    const R = SR.rng(seed * 7919 + 3), B = Builder(1 << 19);
    let SPC = 0.5;
    const P = (p, a, n, type) => B.push(p[0], p[1], p[2], a[0], a[1], a[2], lit(n, R()) * (p === a ? 1 : 0.6), type || 0, R(), SPC);

    // 1) broken stele at her front-right; she touches its inscription in scene 3
    {
      const S = STELE, U = S.u, N = S.n, base = [S.touch[0], 0, S.touch[2]];
      const at = (u, v, d) => [base[0] + U[0] * u + N[0] * d, v, base[2] + U[2] * u + N[2] * d]; // d > 0: away from her
      const topRuin = S.topAt;
      const rubble = () => heap(R, base[0] + N[0] * (S.thick + 1.9) + U[0] * 0.6, base[2] + N[2] * (S.thick + 1.9) + U[2] * 0.6, 1.6, 0.45);
      SPC = 0.007;
      for (let i = 0; i < 130000; i++) { // inscribed front face, very dense for the close-up
        const u = S.w0 + R() * (S.w1 - S.w0), v = R() * S.hIntact;
        const g = v > 0.18 && v < topRuin(u) - 0.07 && Math.hypot(u, v - S.touch[1]) > 0.13 && u > S.w0 + 0.12 && u < S.w1 - 0.12 && glyphAt(u - S.w0, v, 903, 0.26, 0.34);
        if (v > topRuin(u) && R() > 0.25) continue; // the lost upper part: fewer points, rubble stays sparse
        const alt = at(u, v, g ? 0.012 : 0);
        const pos = v <= topRuin(u) ? alt : rubble();
        B.push(pos[0], pos[1], pos[2], alt[0], alt[1], alt[2], g ? 0.7 : lit([-N[0], 0, -N[2]], R()) * 0.4, g ? 1 : 0, R(), SPC);
      }
      // the mark she is meant to touch: an old, worn handprint hollow (chipped, cracked, uneven)
      {
        SPC = 0.003;
        const fingers = [[-0.031, 0.062, -0.1], [-0.011, 0.078, -0.03], [0.009, 0.074, 0.04], [0.028, 0.056, 0.13]]; // base x, length, tilt
        const hand = (x, y) => {
          const jx = x + 0.007 * (vnoise(x * 90 + 3, y * 90, 121) - 0.5), jy = y + 0.007 * (vnoise(x * 90, y * 90 + 7, 122) - 0.5);
          if ((jx / 0.044) ** 2 + ((jy + 0.022) / 0.05) ** 2 < 1) return true;
          for (const [fx, len, tilt] of fingers) {
            if (segDist(jx, jy, fx, 0, fx + Math.sin(tilt) * len, Math.cos(tilt) * len) < 0.0085 + 0.002 * Math.sin(jy * 300)) return true;
          }
          return segDist(jx, jy, -0.036, -0.045, -0.068, 0.002) < 0.0095;
        };
        const put = (x, y, depth, b) => {
          const yy = S.touch[1] + y - 0.01;
          if (yy > S.topAt(x) - 0.03) return;
          const p = at(x, yy, depth);
          B.push(p[0], p[1], p[2], p[0], p[1], p[2], b, 8, R(), SPC);
        };
        for (let i = 0; i < 14000; i++) {
          const x = (R() - 0.5) * 0.17, y = (R() - 0.5) * 0.2 + 0.015;
          if (!hand(x, y)) continue;
          const wear = fbm(x * 45 + 11, y * 45, 131, 3);
          if (wear < 0.36) continue;                                                     // chipped away
          if (Math.abs(x * 0.8 + y - 0.012 + 0.01 * Math.sin(x * 160)) < 0.0035) continue; // a crack across it
          put(x, y, 0.004 + 0.008 * wear, 0.3 + 0.45 * wear);
        }
        for (let i = 0; i < 700; i++) { // loose weathered specks around the print
          const a = R() * TAU, r = 0.05 + 0.065 * Math.sqrt(R()), x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (hand(x, y) || R() < 0.5) continue;
          put(x, y, 0.003, 0.25);
        }
      }
      SPC = 0.03;
      for (let i = 0; i < 40000; i++) { // sides, back, broken top
        const f = R(), v = R() * S.hIntact;
        let u, d, n;
        if (f < 0.2) { u = S.w0; d = R() * S.thick; n = [-U[0], 0, -U[2]]; }
        else if (f < 0.4) { u = S.w1; d = R() * S.thick; n = [U[0], 0, U[2]]; }
        else { u = S.w0 + R() * (S.w1 - S.w0); d = S.thick; n = [N[0], 0, N[2]]; }
        if (v > topRuin(u) && R() > 0.25) continue;
        const alt = at(u, v, d);
        P(v <= topRuin(u) ? alt : rubble(), alt, n);
      }
      for (let i = 0; i < 12000; i++) { // broken upper surface
        const u = S.w0 + R() * (S.w1 - S.w0), d = R() * S.thick, v = topRuin(u) + (R() - 0.5) * 0.06;
        const p = at(u, v, d);
        P(p, p, [0, 1, 0]);
      }
    }

    // 2) avenue of colossal columns leading to the ziggurat
    const cols = [];
    for (let k = 0; k < 10; k++) for (const sx of [-1, 1]) cols.push({ x: sx * 34 + (hash2(k, sx, 3) - 0.5) * 3, z: 46 + k * 34, k, sx });
    SPC = 0.5;
    cols.forEach((c, ci) => {
      // the column stood on the old ground; where the sand mound covers it today, its lower part (and anything that fell
      // there) is hidden in the ruins and shows as the sand goes
      const rad = 4.2, H = 66, base = heightPast(c.x, c.z) - 1.5, h = hash2(ci, 5, seed), sandy = heightPast(c.x, c.z) < height(c.x, c.z) - 0.01;
      const mode = h < 0.38 ? 'broken' : h < 0.62 ? 'fallen' : 'standing';
      const hb = mode === 'broken' ? 16 + 30 * hash2(ci, 6, seed) : mode === 'fallen' ? 3 + 4 * hash2(ci, 8, seed) : H - 2 - 12 * hash2(ci, 9, seed);
      const phi = (hash2(ci, 7, seed) - 0.5) * 2.4 + (c.sx > 0 ? 0 : Math.PI);
      const d = [Math.cos(phi), 0, Math.sin(phi)], pp = [-d[2], 0, d[0]];
      const n = 7600;
      for (let i = 0; i < n; i++) {
        const isCap = R() < 0.1, ang = R() * TAU;
        let ly, rr, g = false;
        if (isCap) { ly = H; rr = rad * Math.sqrt(R()) * 1.25; }
        else {
          ly = R() * H;
          rr = rad * (1 + 0.04 * Math.cos(ang * 16)) * (ly > H - 4 ? 1.22 : 1) * (ly < 3 ? 1.18 : 1);
          if (ly > 3 && ly < 9) g = glyphAt(((ang / TAU) * TAU * rad) % (TAU * rad), ly - 3, 300 + ci, 0.7, 0.9);
        }
        const ox = Math.cos(ang) * rr, oz = Math.sin(ang) * rr;
        const alt = [c.x + ox, base + ly, c.z + oz];
        let pos = alt;
        if (ly > hb) {
          const along = ly - hb + rad * 1.4;
          const gy = heightPast(c.x + d[0] * along, c.z + d[2] * along);
          pos = [c.x + d[0] * along + pp[0] * ox, gy + rad * 0.7 + oz, c.z + d[2] * along + pp[2] * ox];
        }
        const under = sandy && pos[1] < height(pos[0], pos[2]) - 0.5;
        P(pos, alt, isCap ? [0, 1, 0] : [Math.cos(ang), 0, Math.sin(ang)], under ? BURIED : g ? 1 : 0);
      }
    });
    // intact-only architrave beams along each row (rubble at the foot of the columns)
    for (const sx of [-1, 1]) for (let k = 0; k < 9; k++) {
      const a = cols.find(c => c.k === k && c.sx === sx), b = cols.find(c => c.k === k + 1 && c.sx === sx);
      for (let i = 0; i < 1800; i++) {
        const t = R(), x = SR.lerp(a.x, b.x, t) + (R() - 0.5) * 7, z = SR.lerp(a.z, b.z, t), y = heightPast(a.x, a.z) - 1.5 + 66 + R() * 5;
        P(heap(R, x, z, 9, 4), [x, y, z], [0, 1, 0]);
      }
    }

    // 3) ziggurat, mostly buried in the mound — top tiers break through
    {
      SPC = 1.4;
      const Z = ZIG;
      for (let k = 0; k < Z.tiers; k++) {
        const s = Z.half - k * 20, y0 = Z.base + k * Z.th, y1 = y0 + Z.th;
        const nSide = Math.round(4 * 2 * s * Z.th * 0.42), nTop = Math.round((s * s * 4 - (s - 20) * (s - 20) * 4) * 0.06);
        for (let i = 0; i < nSide + nTop; i++) {
          let p, n;
          if (i < nSide) {
            const side = Math.floor(R() * 4), u = (R() * 2 - 1) * s, y = y0 + R() * Z.th;
            n = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][side];
            p = [Z.x + (n[0] ? n[0] * s : u), y, Z.z + (n[2] ? n[2] * s : u)];
            // horizontal course lines every 2 m
            if (Math.abs(((y - y0) % 2.5) - 1.25) > 1.05 && R() < 0.5) continue;
          } else {
            const u = (R() * 2 - 1) * s, w = (s - 20) + R() * 20, side = Math.floor(R() * 4);
            p = side < 2 ? [Z.x + u, y1, Z.z + (side ? w : -w)] : [Z.x + (side === 2 ? w : -w), y1, Z.z + u];
            n = [0, 1, 0];
          }
          const gh = height(p[0], p[2]);
          let pos = p;
          if (p[1] < gh - 1) pos = [p[0] + (R() - 0.5) * 3, gh + R() * 0.6, p[2] + (R() - 0.5) * 3];
          else if (k >= 3 && R() < 0.35 * (k - 2) / 3) {
            const drop = R() * 22;
            pos = [p[0] + n[0] * drop * 1.2, Math.max(gh + 0.3, p[1] - drop), p[2] + n[2] * drop * 1.2];
          }
          const g = i < nSide && k < 5 && glyphAt((p[0] + p[2]) % 400 + 400, p[1] - y0, 500 + k, 2.4, 3.2) && R() < 0.8;
          P(pos, p, n, g ? 1 : 0);
        }
      }
      // grand stair on the face toward her
      const z0 = Z.z - Z.half, z1 = Z.z - (Z.half - 100), yA = Z.base, yB = Z.base + 120;
      for (let i = 0; i < 20000; i++) {
        const step = Math.floor(R() * 60), u = (R() * 2 - 1) * 12, tread = R() < 0.55;
        const zs = SR.lerp(z0, z1, step / 60), ys = SR.lerp(yA, yB, step / 60);
        const p = tread ? [u, ys + 2, zs + R() * (100 / 60)] : [u, ys + R() * 2, zs];
        const gh = height(p[0], p[2]), under = p[1] < gh - 1;
        const pos = under ? [p[0], gh + R() * 0.5, p[2]] : p;   // buried steps rise out of the mound as the city assembles
        B.push(pos[0], pos[1], pos[2], p[0], p[1], p[2], (tread ? 0.55 : 0.4) * (0.8 + 0.2 * R()), under ? BURIED : 0, R(), 0.9);
      }
      // x-ray of everything the mound hides: tier edges (bright), tier faces and treads (faint), the stair's step edges.
      // Own random stream, so no other structure changes.
      {
        const RX = SR.rng(seed * 7919 + 77);
        const X = (x, y, z, b) => { if (y < height(x, z) - 0.5) B.push(x, y, z, x, y, z, b * (0.85 + 0.15 * RX()), XRAY, RX(), 1.0); };
        const onSide = (s, u) => { const side = Math.floor(RX() * 4); return side === 0 ? [u, -s] : side === 1 ? [s, u] : side === 2 ? [u, s] : [-s, u]; };
        for (let k = 0; k < Z.tiers; k++) {
          const s = Z.half - k * 20, y0 = Z.base + k * Z.th, y1 = y0 + Z.th;
          for (let i = 0, n = Math.round(8 * s * Z.th * 0.25); i < n; i++) {            // faces
            const [x, z] = onSide(s, (RX() * 2 - 1) * s); X(Z.x + x, y0 + RX() * Z.th, Z.z + z, 0.35);
          }
          for (let i = 0, n = Math.round(8 * s * 4); i < n; i++) {                       // top and bottom outer edges
            const [x, z] = onSide(s, (RX() * 2 - 1) * s); X(Z.x + x, RX() < 0.5 ? y1 : y0, Z.z + z, 0.9);
          }
          for (let i = 0, n = Math.round(8 * (s - 10) * 20 * 0.15); i < n; i++) {      // tread (top ring) of the tier
            const [x, z] = onSide(s - 20 + RX() * 20, (RX() * 2 - 1) * (s - 20 + RX() * 20)); X(Z.x + x, y1, Z.z + z, 0.3);
          }
          for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])                   // corners
            for (let i = 0; i < 80; i++) X(Z.x + cx * s, y0 + RX() * Z.th, Z.z + cz * s, 0.9);
        }
        for (let st = 0; st < 60; st++) {                                                // stair: each step's edge
          const zs = SR.lerp(z0, z1, st / 60), ys = SR.lerp(yA, yB, st / 60) + 2;
          for (let i = 0; i < 70; i++) X((RX() * 2 - 1) * 12, ys, zs, 0.8);
        }
      }
      // crowning tower — exists only in the intact city
      for (let i = 0; i < 16000; i++) {
        const ang = R() * TAU, y = Z.base + 120 + R() * 95, rr = 15 * (1 - 0.35 * (y - Z.base - 120) / 95);
        const alt = [Z.x + Math.cos(ang) * rr, y, Z.z + Math.sin(ang) * rr];
        P(heap(R, Z.x + (R() - 0.5) * 50, Z.z + (R() - 0.5) * 50, 40, 14), alt, [Math.cos(ang), 0, Math.sin(ang)]);
      }
    }

    // 4) broken arches
    SPC = 0.9;
    [[-175, 235, 0.3], [205, 300, -0.4], [265, 110, 1.1]].forEach(([cx, cz, yaw], ai) => {
      const span = 64, ph = 46, pw = 11, depth = 10, ca = Math.cos(yaw), sa = Math.sin(yaw);
      const W2 = (lx, y, lz) => [cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca];
      const base = height(cx, cz) - 2, brokenSide = ai % 2 ? 1 : -1;
      for (let i = 0; i < 11000; i++) {
        let lx, ly, lz, n;
        if (R() < 0.45) { // piers
          const side = R() < 0.5 ? -1 : 1;
          lx = side * (span / 2 + pw / 2) + (R() - 0.5) * pw; ly = R() * ph; lz = (R() - 0.5) * depth;
          const f = Math.floor(R() * 3);
          if (f === 0) { lx = side * (span / 2 + (R() < 0.5 ? 0 : pw)); n = [side, 0, 0]; } else if (f === 1) { lz = (R() < 0.5 ? -1 : 1) * depth / 2; n = [0, 0, Math.sign(lz)]; } else n = [0, 0, -1];
        } else { // vault
          const th = R() * Math.PI, rr = span / 2 + R() * pw;
          lx = Math.cos(th) * rr; ly = ph + Math.sin(th) * rr * 0.9; lz = (R() - 0.5) * depth;
          n = [Math.cos(th), Math.sin(th), 0];
        }
        const alt = W2(lx, base + ly, lz);
        const broken = lx * brokenSide > -6 && ly > 12 + 10 * hash2(Math.floor(lx), ai, 4);
        const pos = broken ? heap(R, ...(() => { const q = W2(brokenSide * (span / 2 + 10), 0, 0); return [q[0], q[2]]; })(), 30, 12) : alt;
        P(pos, alt, [n[0] * ca, n[1], n[0] * sa]);
      }
    });

    // 5) tall monoliths with vertical script; ruined ones lean
    SPC = 0.75;
    [[-430, 640, 140], [390, 720, 160], [-660, 310, 110], [610, 400, 125], [-260, 1080, 175], [160, 1180, 150]].forEach(([cx, cz, H], mi) => {
      const W = 13, T = 4.5, lean = (0.14 + 0.2 * hash2(mi, 1, seed)) * (mi % 2 ? 1 : -1), yaw = hash2(mi, 2, seed) * 0.8;
      const base = height(cx, cz) - 3, ca = Math.cos(yaw), sa = Math.sin(yaw), cl = Math.cos(lean), sl = Math.sin(lean);
      for (let i = 0; i < 7000; i++) {
        const f = R();
        let lx, ly = R() * H, lz, n;
        if (f < 0.7) { lx = (R() - 0.5) * W; lz = (R() < 0.5 ? -1 : 1) * T / 2; n = [0, 0, Math.sign(lz)]; }
        else if (f < 0.95) { lx = (R() < 0.5 ? -1 : 1) * W / 2; lz = (R() - 0.5) * T; n = [Math.sign(lx), 0, 0]; }
        else { lx = (R() - 0.5) * W; lz = (R() - 0.5) * T; ly = H; n = [0, 1, 0]; }
        const g = f < 0.7 && Math.abs(lx) < W * 0.32 && glyphAt(lx + W, ly, 700 + mi, 3.2, 4.0);
        const toW = (x, y, z) => [cx + x * ca - z * sa, base + y, cz + x * sa + z * ca];
        const alt = toW(lx, ly, lz);
        const pos = toW(lx * cl - ly * sl, lx * sl + ly * cl, lz);
        P(pos, alt, [n[0] * ca - n[2] * sa, n[1], n[0] * sa + n[2] * ca], g ? 1 : 0);
      }
    });

    // 6) towers and sky-bridges of the intact city (rubble fields today)
    SPC = 1.1;
    const towers = [[-125, 610, 190, 11], [150, 570, 230, 13], [-215, 390, 150, 9], [240, 460, 170, 10]];
    towers.forEach(([tx, tz, H, rad]) => {
      const base = heightPast(tx, tz) - 2;
      for (let i = 0; i < 11000; i++) {
        const ang = R() * TAU, y = R() * H, rr = rad * (1 - 0.3 * y / H) * (Math.abs(((y / 9) % 1) - 0.5) < 0.04 ? 1.15 : 1);
        P(heap(R, tx, tz, rad * 4, rad * 1.6), [tx + Math.cos(ang) * rr, base + y, tz + Math.sin(ang) * rr], [Math.cos(ang), 0, Math.sin(ang)]);
      }
    });
    const zt = [ZIG.x, ZIG.base + 200, ZIG.z];
    towers.forEach(([tx, tz, H]) => {
      const a = [tx, heightPast(tx, tz) + H * 0.82, tz];
      for (let i = 0; i < 3200; i++) {
        const t = R(), p = v3.lerp(a, zt, t);
        p[1] -= Math.sin(t * Math.PI) * 14;
        p[0] += (R() - 0.5) * 4; p[1] += (R() - 0.5) * 2.5;
        P(heap(R, p[0], p[2], 14, 3), p, [0, 1, 0]);
      }
    });
    return B.done();
  }

  // ---------- whale-like colossus ----------
  const WHALE = { L: 300, Rm: 54 };
  // body radius along the length (s: head 0 .. tail 1)
  function prof(s) {
    s = clamp(s, 0, 1);
    // blunt, massive head: a squarish (superelliptic) cap over the first 10% instead of a tapering snout
    const cap = s < 0.1 ? Math.pow(1 - Math.pow((0.1 - s) / 0.1, 2.6), 1 / 2.6) : 1;
    // one smooth curve (no joints): bulk peaks behind the flippers, then a C1 smoothstep taper to a slim tail stock
    const bulk = 0.84 + 0.16 * Math.exp(-Math.pow((s - 0.3) / 0.22, 2));
    const u = clamp((s - 0.42) / 0.58, 0, 1);
    const shape = bulk * (1 - 0.94 * u * u * (3 - 2 * u));
    return WHALE.Rm * cap * shape;
  }
  function whaleBody(s, th, k) {
    const L = WHALE.L, c = Math.cos(th), sn = Math.sin(th);
    let m = 1 + 0.012 * Math.sin(s * L / 6.5 * TAU) * smooth(0.15, 0.4, s);           // shallow skin folds (smooth outline)
    if (sn < -0.25) m -= 0.022 * Math.abs(Math.sin(th * 26)) * (1 - smooth(0.42, 0.62, s)); // ventral pleats fade out (no seam)
    if (sn > 0.9 && s > 0.45) m += 0.018 * Math.max(0, Math.sin(s * 40)); // dorsal knuckles
    const yy = prof(s) * sn * (sn < 0 ? 0.86 : 1) * m * k, zz = prof(s) * 1.18 * c * m * k;
    return [L * (0.5 - s), yy, zz];
  }
  function whale(seed) {
    const R = SR.rng(seed * 31 + 5), B = Builder(1 << 18), L = WHALE.L;
    const LW = v3.norm([0.2, 1, 0.3]);
    const body = whaleBody, ry = s => prof(s), rz = s => prof(s) * 1.18;
    // surface
    let made = 0;
    while (made < 165000) {
      const s = R(), th = R() * TAU;
      if (R() * WHALE.Rm * 1.2 > prof(s) * 1.1 + 2) continue;
      if (s < 0.25 && Math.abs(th - (TAU * 0.5 + 0.55 + s * 0.6)) < 0.02) continue; // mouth line gap
      if (s < 0.25 && Math.abs(th - (TAU - 0.55 - s * 0.6)) < 0.02) continue;
      const p = body(s, th, 1);
      const n = v3.norm([0, Math.sin(th) / (ry(s) + 1), Math.cos(th) / (rz(s) + 1)]);
      const tex = 0.78 + 0.44 * fbm(s * 22, th * 2.2, 61, 3);
      const b = clamp((0.24 + 0.76 * Math.pow(Math.max(0, v3.dot(n, LW)), 0.85)) * tex, 0.05, 1);
      B.push(p[0], p[1], p[2], p[0], p[1], p[2], b, 2, R(), s);
      made++;
    }
    // interior volume (gives mass when seen through)
    for (let i = 0; i < 26000; i++) {
      const s = R(); if (R() * WHALE.Rm * WHALE.Rm > prof(s) * prof(s) + 4) { i--; continue; }
      const p = body(s, R() * TAU, Math.sqrt(R()) * 0.94);
      B.push(p[0], p[1], p[2], p[0], p[1], p[2], 0.16, 2, R(), s);
    }
    // pectoral fins (humpback-like, long, scalloped leading edge)
    for (const side of [-1, 1]) {
      const sA = 0.3, at = body(sA, side > 0 ? -0.55 : Math.PI + 0.55, 0.92);
      const dir = v3.norm([-0.5, -0.38, side * 1]), Lf = 92;
      for (let i = 0; i < 12000; i++) {
        const u = Math.pow(R(), 0.8), chord = 24 * Math.pow(1 - u, 0.7) + 3 + 1.6 * Math.sin(u * 34) * (1 - u);
        const v = R() - 0.5, thk = (R() - 0.5) * 2.4 * (1 - u);
        const p = v3.add(v3.add(at, v3.scale(dir, u * Lf)), [-v * chord, thk, 0]);
        B.push(p[0], p[1], p[2], p[0], p[1], p[2], 0.5 + 0.35 * R() * (v > 0 ? 1 : 0.6), 2, R(), sA + u * 0.08);
      }
    }
    // flukes
    for (let i = 0; i < 16000; i++) {
      const side = R() < 0.5 ? -1 : 1, u = Math.sqrt(R()), span = 54;
      const chord = 26 * (1 - Math.pow(u, 1.6)) + 2, v = R();
      const notch = 6 * Math.exp(-u * 8);
      const p = [-L * 0.47 - v * chord + notch * (1 - v) * 0 - u * 14, (R() - 0.5) * 2.2 * (1 - u), side * u * span];
      B.push(p[0], p[1], p[2], p[0], p[1], p[2], 0.45 + 0.4 * R(), 2, R(), 0.97 + 0.03 * u);
    }
    // small dorsal fin
    for (let i = 0; i < 2500; i++) {
      const u = R(), w = (1 - u) * 14, x = L * (0.5 - 0.7) - (R() - 0.5) * w, y = ry(0.7) * 0.98 + u * 9;
      B.push(x, y, (R() - 0.5) * 1.6, x, y, 0, 0.6, 2, R(), 0.7);
    }
    // eyes: dense iris ring, dark pupil, heavy lid ridge
    for (const side of [-1, 1]) {
      const s = 0.135, th = side > 0 ? -0.22 : Math.PI + 0.22;
      const c = body(s, th, 1.0), n = v3.norm([0.15, Math.sin(th) * 0.3, Math.cos(th)]);
      const t1 = v3.norm(v3.cross(n, [0, 1, 0])), t2 = v3.cross(t1, n);
      for (let i = 0; i < 300; i++) {   // body-like density: a dense eye saturates into a white dot from afar
        const a = R() * TAU, k = R();
        let r, b, bulge;
        if (k < 0.62) { r = 1.1 + R() * 1.6; b = 0.22 + 0.08 * Math.cos(a * 18); bulge = 0.9; }   // far-view eye: dark, not a glowing dot
        else if (k < 0.72) { r = R() * 1.0; b = 0.05; bulge = 1.0; }
        else { r = 3.0 + R() * 0.9; b = 0.3; bulge = 0.5 + 0.4 * Math.sin(a); }
        const p = v3.add(v3.add(c, v3.scale(n, bulge)), v3.add(v3.scale(t1, Math.cos(a) * r), v3.scale(t2, Math.sin(a) * r * 0.82)));
        B.push(p[0], p[1], p[2], p[0], p[1], p[2], b, 6, R(), s);
      }
    }
    return B.done();
  }


  // dense skin patch around the eye (+z side) for the close encounter (same frame as whale())
  function whaleHead(seed) {
    const R = SR.rng(seed * 53 + 11), B = Builder(1 << 19), LW = v3.norm([0.2, 1, 0.3]);
    const se = 0.135, te = -0.22;
    for (let i = 0; i < 320000; i++) {
      const s = 0.03 + R() * 0.3, th = te + (R() - 0.5) * 2.0;
      const p = whaleBody(s, th, 1);
      const e = whaleBody(se, te, 1), de = Math.hypot(p[0] - e[0], p[1] - e[1]);
      if (de > 46 && R() < 0.7) continue;
      // concentric wrinkles around the eye + fine skin grain
      const wr = 0.5 + 0.5 * Math.cos(de * 1.9) * Math.exp(-de / 18);
      const n = v3.norm([0, Math.sin(th), Math.cos(th)]);
      const tex = 0.7 + 0.5 * fbm(s * 90, th * 9, 67, 3);
      const b = clamp((0.22 + 0.78 * Math.pow(Math.max(0, v3.dot(n, LW)), 0.85)) * tex * (0.75 + 0.45 * wr), 0.05, 1);
      const bump = 0.35 * wr;
      B.push(p[0], p[1] + n[1] * bump, p[2] + n[2] * bump, p[0], p[1], p[2], b, 2, R(), s);
    }
    // eye: much denser iris / pupil / lid than whale()
    const c = whaleBody(se, te, 1), n = v3.norm([0.15, Math.sin(te) * 0.3, Math.cos(te)]);
    const t1 = v3.norm(v3.cross(n, [0, 1, 0])), t2 = v3.cross(t1, n);
    for (let i = 0; i < 24000; i++) {
      const a = R() * TAU, k = R();
      let r, b, bulge;
      if (k < 0.6) { r = 1.1 + R() * 1.6; b = 0.32 + 0.22 * Math.cos(a * 22) * Math.cos(r * 9); bulge = 0.9 + 0.1 * (2.7 - r); }
      else if (k < 0.7) { r = R() * 1.05; b = 0.06; bulge = 1.05; }
      else { r = 2.9 + R() * 1.6; b = 0.3 + 0.12 * Math.sin(a * 3); bulge = 0.6 + 0.5 * Math.sin(a) * Math.exp(-(r - 3.4) * 1.2); }
      const p = v3.add(v3.add(c, v3.scale(n, bulge)), v3.add(v3.scale(t1, Math.cos(a) * r), v3.scale(t2, Math.sin(a) * r * 0.82)));
      B.push(p[0], p[1], p[2], p[0], p[1], p[2], b, 6, R(), se);
    }
    return B.done();
  }

  // ---------- heroine: one continuous suited body (SDF smooth union), facing +z ----------
  // Her right side is -x. Joints are shared with the reach animation (SHOULDER / ARM_REST / ARM_LEN).
  function sdRoundCone(p, a, b, r1, r2) {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
    const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (r1 + (r2 - r1) * h);
  }
  function sdEll(p, c, r) {
    const qx = (p[0] - c[0]) / r[0], qy = (p[1] - c[1]) / r[1], qz = (p[2] - c[2]) / r[2];
    const k0 = Math.hypot(qx, qy, qz), k1 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
    return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
  }
  function sdRBox(p, c, h, rad) {
    const qx = Math.abs(p[0] - c[0]) - h[0], qy = Math.abs(p[1] - c[1]) - h[1], qz = Math.abs(p[2] - c[2]) - h[2];
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
  }
  function sdTorusY(p, c, R, r) { return Math.hypot(Math.hypot(p[0] - c[0], p[2] - c[2]) - R, p[1] - c[1]) - r; }
  function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
  // parts: [label, sdf(p), blend k]
  const HPARTS = (function () {
    const J = HJ, P = [];
    const add = (label, f, k) => P.push([label, f, k]);
    add('hips', p => sdEll(p, [0, 0.91, 0], [0.165, 0.13, 0.118]), 0.09);
    add('torso', p => sdEll(p, [0, 1.0, 0.01], [0.13, 0.075, 0.1]), 0.07);                 // lower abdomen: waist flares into hips
    add('torso', p => sdEll(p, [0, 1.06, 0.005], [0.106, 0.1, 0.095]), 0.05);
    add('torso', p => sdEll(p, [0, 1.24, 0.01], [0.145, 0.14, 0.115]), 0.07);
    add('torso', p => sdEll(p, [0, 1.255, 0.055], [0.112, 0.065, 0.07]), 0.05);
    for (const S of [J.RS, J.LS]) add('torso', p => sdRoundCone(p, [0, 1.415, -0.005], S, 0.06, 0.05), 0.05); // sloping trapezius
    add('shoulderR', p => sdEll(p, J.RS, [0.058, 0.05, 0.06]), 0.085);
    add('shoulderL', p => sdEll(p, J.LS, [0.058, 0.05, 0.06]), 0.085);
    add('neckring', p => sdTorusY(p, [0, 1.43, 0], 0.074, 0.022), 0.03);
    add('helmet', p => sdEll(p, J.HEAD, [0.135, 0.145, 0.15]), 0.025);
    add('pack', p => sdRBox(p, [0, 1.2, -0.175], [0.085, 0.2, 0.045], 0.035), 0.015);
    for (const sx of [-1, 1]) {
      const h0 = [sx * 0.085, 1.25, 0.112], h1 = [sx * 0.15, 1.2, 0.02], h2 = [sx * 0.11, 1.24, -0.135];
      add('hose', p => Math.min(sdRoundCone(p, h0, h1, 0.011, 0.011), sdRoundCone(p, h1, h2, 0.011, 0.011)), 0.012);
    }
    for (const side of ['R', 'L']) {
      const S = J[side + 'S'], E = J[side + 'E'], W = J[side + 'W'], F = J[side + 'F'];
      const hd = v3.norm(v3.sub(F, W)), fd = v3.norm(v3.sub(W, E)), sx = side === 'R' ? -1 : 1;
      add('upper' + side, p => sdRoundCone(p, S, E, 0.049, 0.044), 0.02);
      add('fore' + side, p => sdRoundCone(p, E, W, 0.044, 0.037), 0.02);
      const c0 = v3.add(W, v3.scale(fd, -0.03)), c1 = v3.add(W, v3.scale(fd, 0.005));
      add('cuff' + side, p => sdRoundCone(p, c0, c1, 0.044, 0.042), 0.006);
      const hc = v3.add(W, v3.scale(hd, 0.055));
      add('glove' + side, p => sdEll(p, hc, [0.026, 0.048, 0.037]), 0.018);
      for (let f = 0; f < 4; f++) {
        const k0 = v3.add(hc, [sx * 0.004, -0.03, -0.024 + f * 0.016]);
        const k1 = v3.add(k0, v3.add(v3.scale(hd, 0.05 - Math.abs(f - 1.5) * 0.006), [sx * 0.008, 0, 0.006]));
        add('finger' + side, p => sdRoundCone(p, k0, k1, 0.0095, 0.008), 0.008);
      }
      const t0 = v3.add(hc, [sx * 0.008, 0.005, 0.03]), t1 = v3.add(t0, [sx * 0.004, -0.035, 0.022]);
      add('finger' + side, p => sdRoundCone(p, t0, t1, 0.011, 0.009), 0.008);
    }
    for (const side of ['R', 'L']) {
      const H = J[side + 'H'], K = J[side + 'K'], A = J[side + 'A'], sx = side === 'R' ? -1 : 1;
      const calf = v3.add(v3.lerp(A, K, 0.55), [0, 0, -0.02]), kp = v3.add(K, [0, 0.005, 0.035]);
      add('thigh' + side, p => sdRoundCone(p, K, H, 0.066, 0.09), 0.05);
      add('shin' + side, p => sdRoundCone(p, A, K, 0.048, 0.06), 0.035);
      add('shin' + side, p => sdEll(p, calf, [0.054, 0.1, 0.056]), 0.04);
      add('knee' + side, p => sdEll(p, kp, [0.05, 0.05, 0.035]), 0.02);
      const heel = [A[0], 0.05, A[2] - 0.03], toe = [A[0] + sx * 0.012, 0.042, A[2] + 0.135], soleC = [A[0] + sx * 0.005, 0.012, A[2] + 0.05];
      add('boot' + side, p => sdRoundCone(p, heel, toe, 0.05, 0.042), 0.03);
      add('boot' + side, p => sdRBox(p, soleC, [0.04, 0.007, 0.112], 0.006), 0.02);
    }
    return P;
  })();
  function heroineSDFL(p, labels) {
    let d = 1e9, best = 1e9, label = '', first = true;
    for (let i = 0; i < HPARTS.length; i++) {
      if (labels && !labels.includes(HPARTS[i][0])) continue;
      const di = HPARTS[i][1](p);
      d = first ? di : smin(d, di, HPARTS[i][2]);
      first = false;
      if (di < best) { best = di; label = HPARTS[i][0]; }
    }
    return { d, label };
  }
  const heroineSDF = (p, labels) => heroineSDFL(p, labels).d;   // labels: optional part filter (testing hook)

  function heroine(seed) {
    const R0 = SR.rng(seed * 13 + 9); let calls = 0; const R = () => { calls++; return R0(); };   // counted: rnd is re-derived from its index when baked
    const B = Builder(1 << 17), J = HJ, rndIndex = [];
    const LK = v3.norm([0.45, 0.7, 0.55]), LF = v3.norm([-0.3, 0.5, -0.8]), e = 0.0008, N = 110000; // key light front-left-above, fill from behind
    const grad = p => v3.norm([
      heroineSDF([p[0] + e, p[1], p[2]]) - heroineSDF([p[0] - e, p[1], p[2]]),
      heroineSDF([p[0], p[1] + e, p[2]]) - heroineSDF([p[0], p[1] - e, p[2]]),
      heroineSDF([p[0], p[1], p[2] + e]) - heroineSDF([p[0], p[1], p[2] - e])]);
    const armDir = v3.norm(v3.sub(J.RE, J.RS));
    let made = 0;
    while (made < N) {
      let p = [-0.34 + R() * 0.68, R() * 1.74, -0.27 + R() * 0.52];
      const d0 = heroineSDF(p);
      if (Math.abs(d0) > 0.05) continue;
      // shell of constant *true* thickness: the blended ellipsoid distances are not Euclidean, so divide by |grad|
      const gm = Math.hypot(
        heroineSDF([p[0] + e, p[1], p[2]]) - heroineSDF([p[0] - e, p[1], p[2]]),
        heroineSDF([p[0], p[1] + e, p[2]]) - heroineSDF([p[0], p[1] - e, p[2]]),
        heroineSDF([p[0], p[1], p[2] + e]) - heroineSDF([p[0], p[1], p[2] - e])) / (2 * e);
      if (Math.abs(d0) / Math.max(gm, 1e-6) > 0.012) continue;  // uniform thin shell => uniform surface density
      let n;
      for (let it = 0; it < 4; it++) { n = grad(p); p = v3.sub(p, v3.scale(n, heroineSDF(p))); }
      const hit = heroineSDFL(p), label = hit.label;
      if (Math.abs(hit.d) > 0.0012) continue;
      n = grad(p);
      let b = 0.2 + 0.55 * Math.max(0, v3.dot(n, LK)) + 0.3 * Math.max(0, v3.dot(n, LF)) + 0.1 * Math.max(0, n[1]);
      const rnd = R(), rndAt = calls - 1;
      b *= 0.9 + 0.1 * vnoise(p[0] * 300 + p[2] * 170, p[1] * 300, 211);
      // ---- suit details ----
      if (label === 'helmet') {
        const v = v3.norm(v3.sub(p, J.HEAD));
        const inVisor = v[2] > 0.42 && v[1] > -0.4 && v[1] < 0.48 && Math.abs(v[0]) < 0.78;
        const nearVisor = v[2] > 0.31 && v[1] > -0.5 && v[1] < 0.6 && Math.abs(v[0]) < 0.88;
        if (inVisor) {
          if (rnd > 0.35) continue;                                                       // sparse glass reads as a dark opening
          p = v3.sub(p, v3.scale(n, 0.005));
          b = Math.abs(v[1] - 0.22 + 0.35 * v[0]) < 0.012 ? 0.6 : 0.02 + 0.03 * R();     // near-black, one thin reflection
        } else if (nearVisor) { p = v3.add(p, v3.scale(n, 0.003)); b = 1.0; }             // raised bright rim
      } else if (label === 'neckring' || label === 'cuffR' || label === 'cuffL') b = 0.85 + 0.1 * rnd;
      else if (label === 'pack') {
        b *= ((p[1] - 1.0) * 22) % 1 < 0.5 ? 1 : 0.65;
        if (Math.abs(Math.abs(p[0]) - 0.15) < 0.012) b = Math.max(b, 0.8);
      } else if (label === 'hose') b *= 0.75 + 0.25 * Math.sin((p[1] + p[2]) * 420);
      else if (label === 'torso' || label === 'hips') {
        if (Math.abs(p[1] - 0.995) < 0.012) b = 0.9;                                        // waist seam
        if (n[2] > 0.55) {                                                                  // flush chest panel with three lights
          const qx = Math.abs(p[0]) - 0.055, qy = Math.abs(p[1] - 1.19) - 0.03;
          const rr = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.012;
          if (Math.abs(rr) < 0.003) b = Math.max(b, 0.7); else if (rr < 0) b *= 0.85;
          if ([-0.025, 0, 0.025].some(x => Math.hypot(p[0] - x, p[1] - 1.205) < 0.0055)) b = 1;
        }
      } else if (label === 'upperL' && n[0] > 0.55 && p[1] > 1.22 && p[1] < 1.3) b = 0.95;  // shoulder patch
      else if (label.startsWith('thigh') && Math.abs(n[0]) > 0.6 && p[1] > 0.6 && p[1] < 0.76) {
        const edge = Math.min(Math.abs(p[1] - 0.6), Math.abs(p[1] - 0.76), Math.abs(Math.abs(p[2] - 0.0) - 0.05));
        if (Math.abs(p[2]) < 0.055 && edge < 0.006) b = 0.85;                             // thigh pocket
      }
      else if (label.startsWith('boot') && p[1] < 0.028) b = 0.9;                            // sole
      else if (label.startsWith('knee') && n[2] > 0.4) b = Math.max(b, 0.8);                 // knee pads
      // fabric folds at elbows and knees
      for (const jt of [J.RE, J.LE, J.RK, J.LK]) {
        const w = Math.exp(-Math.pow(v3.len(v3.sub(p, jt)) / 0.07, 2));
        if (w > 0.05) b *= 1 - 0.28 * w * (0.5 + 0.5 * Math.sin(p[1] * 170 + 3 * vnoise(p[0] * 60, p[2] * 60, 7)));
      }
      // skin weight for the reaching right arm (smooth at the shoulder)
      let aux = 0;
      if (/R$/.test(label) && /^(upper|fore|cuff|glove|finger|shoulder)/.test(label)) aux = smooth(-0.02, 0.07, v3.dot(v3.sub(p, J.RS), armDir));
      B.push(p[0], p[1], p[2], n[0], n[1], n[2], clamp(b, 0.03, 1), 3, rnd, aux);           // alt = surface normal
      rndIndex.push(rndAt);
      made++;
    }
    const out = B.done();
    out.rndIndex = Int32Array.from(rndIndex); out.rngSeed = seed * 13 + 9;
    return out;
  }

  // ---------- stars (drawn around the camera) ----------
  function sky(seed) {
    const R = SR.rng(seed * 17 + 2), B = Builder(1 << 16);
    const gal = v3.norm([0.3, 0.55, 0.78]);
    for (let i = 0; i < 52000; i++) {
      const u = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - u * u);
      let d = [s * Math.cos(a), u, s * Math.sin(a)];
      if (i % 5 < 2) { // milky band
        const k = v3.dot(d, gal); d = v3.norm(v3.sub(d, v3.scale(gal, k * (0.85 + 0.15 * R()))));
      }
      const b = 0.15 + 0.85 * Math.pow(R(), 7);
      B.push(d[0] * 20000, d[1] * 20000, d[2] * 20000, d[0], d[1], d[2], b, 4, R(), R() * TAU);
    }
    return B.done();
  }

  // ---------- cloud deck (600–1000 m) ----------
  function clouds(seed) {
    const R = SR.rng(seed * 23 + 4), B = Builder(1 << 18);
    let made = 0;
    while (made < 240000) {
      const x = (R() - 0.5) * 6000, z = (R() - 0.5) * 6000 + 400;
      const cov = fbm(x * 0.0016, z * 0.0016, 41, 4);
      if (cov < 0.5 || R() > (cov - 0.5) * 4) continue;
      const th = (cov - 0.5) * 900 * (0.55 + 0.45 * fbm(x * 0.008, z * 0.008, 43, 3));
      const yy = Math.pow(R(), 0.65);
      const y = 640 + yy * th;
      B.push(x, y, z, x, y, z, 0.28 + 0.62 * yy, 5, R(), 7);
      made++;
    }
    return B.done();
  }

  // ---------- planet seen from orbit (centre at (0,-PR,0) so her spot is the north pole) ----------
  const PR = 30000;
  function planet(seed) {
    const R = SR.rng(seed * 29 + 6), B = Builder(1 << 18);
    for (let i = 0; i < 260000; i++) {
      const u = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - u * u), d = [s * Math.cos(a), u, s * Math.sin(a)];
      const land = fbm3(d[0] * 3 + 9, d[1] * 3, d[2] * 3, 81, 5);
      const atm = i % 7 === 0, r = atm ? PR * 1.012 : PR * (1 + (land - 0.5) * 0.004);
      const b = atm ? 0.18 : clamp(0.2 + (land > 0.52 ? 0.55 : 0.18) * (0.6 + 0.4 * R()), 0, 1);
      B.push(d[0] * r, d[1] * r - PR, d[2] * r, d[0], d[1], d[2], b, 0, R(), 230);
    }
    return B.done();
  }
  // planetary ring, tilted, visible as an arc in the sky from the ground
  function ring(seed) {
    const R = SR.rng(seed * 37 + 8), B = Builder(1 << 18), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
    let made = 0;
    while (made < 180000) {
      const rr = PR * (1.7 + R() * 1.0), band = 0.5 + 0.5 * Math.sin(rr / PR * 38) * Math.sin(rr / PR * 7.3);
      if (R() > band * 0.9 + 0.1 || Math.abs(rr / PR - 2.18) < 0.03) continue;
      const a = R() * TAU, x = Math.cos(a) * rr, z = Math.sin(a) * rr, y = (R() - 0.5) * 120;
      const P2 = [x, y * ct - z * st - PR, y * st + z * ct];
      B.push(P2[0], P2[1], P2[2], P2[0], P2[1], P2[2], 0.25 + 0.6 * band, 7, R(), 260);
      made++;
    }
    return B.done();
  }

  return { terrain, ruins, whale, whaleHead, heroine, sky, clouds, planet, ring, height, prof, whaleBody, glyphAt, ZIG, BURIED, XRAY, heightPast, STELE, SHOULDER, ARM_REST, ARM_LEN, REACH, heroineSDF, HJ, WHALE, PR, SUN, fbm };
})();
