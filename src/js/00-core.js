// ---------- core: namespace, seeded random, math ----------
const SR = globalThis.SR = globalThis.SR || {};

SR.TAU = Math.PI * 2;

// mulberry32
SR.rng = function (seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

SR.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
SR.lerp = (a, b, t) => a + (b - a) * t;
SR.smooth = (e0, e1, x) => {
  const t = SR.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
SR.ease = t => SR.smooth(0, 1, t);
SR.v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};

// column-major 4x4 (WebGL convention)
SR.mat4 = {
  identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (near - far); m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  },
  lookAt(eye, target, up) {
    const v = SR.v3, f = v.norm(v.sub(target, eye)), s = v.norm(v.cross(f, up)), u = v.cross(s, f);
    const m = new Float32Array(16);
    m[0] = s[0]; m[4] = s[1]; m[8] = s[2];
    m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
    m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
    m[12] = -v.dot(s, eye); m[13] = -v.dot(u, eye); m[14] = v.dot(f, eye); m[15] = 1;
    return m;
  },
  // model matrix: translate * rotY(yaw) * rotZ(pitch) * rotX(roll) * scale
  trs(t, yaw = 0, pitch = 0, roll = 0, s = 1) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rz * Rx
    const r00 = cy * cp, r01 = -cy * sp * cr + sy * sr, r02 = cy * sp * sr + sy * cr;
    const r10 = sp, r11 = cp * cr, r12 = -cp * sr;
    const r20 = -sy * cp, r21 = sy * sp * cr + cy * sr, r22 = -sy * sp * sr + cy * cr;
    const m = new Float32Array(16);
    m[0] = r00 * s; m[1] = r10 * s; m[2] = r20 * s;
    m[4] = r01 * s; m[5] = r11 * s; m[6] = r21 * s;
    m[8] = r02 * s; m[9] = r12 * s; m[10] = r22 * s;
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
  },
};

// Catmull-Rom style Hermite spline over timed keys. Tangents are zero at the
// two ends (camera eases in/out of a shot) and finite differences inside.
SR.catmull = function (P, T, t) {
  const n = P.length;
  if (t <= T[0]) return P[0].slice();
  if (t >= T[n - 1]) return P[n - 1].slice();
  let i = 0;
  while (i < n - 2 && t > T[i + 1]) i++;
  const t0 = T[i], t1 = T[i + 1], dt = t1 - t0, u = (t - t0) / dt;
  const tan = k => {
    if (k <= 0 || k >= n - 1) return [0, 0, 0];
    const d = T[k + 1] - T[k - 1];
    return [0, 1, 2].map(c => (P[k + 1][c] - P[k - 1][c]) / d);
  };
  const m0 = tan(i), m1 = tan(i + 1);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return [0, 1, 2].map(c => h00 * P[i][c] + h10 * dt * m0[c] + h01 * P[i + 1][c] + h11 * dt * m1[c]);
};

// scalar version for fov etc.
// Monotone cubic through keys (Fritsch-Carlson, per component): smooth, but never overshoots between keys. For camera
// paths where a long fast move ends in a slow one (Catmull-Rom would carry the speed past the key and swing round).
SR.pchip = function (P, T, t) {
  const n = P.length;
  if (t <= T[0]) return P[0].slice();
  if (t >= T[n - 1]) return P[n - 1].slice();
  let i = 0;
  while (i < n - 2 && t > T[i + 1]) i++;
  const h = k => T[k + 1] - T[k];
  return P[0].map((_, c) => {
    const d = k => (P[k + 1][c] - P[k][c]) / h(k);
    const m = k => {                                   // tangent at key k; the ends are at rest, as in SR.catmull
      if (k <= 0 || k >= n - 1) return 0;
      const d0 = d(k - 1), d1 = d(k);
      if (d0 * d1 <= 0) return 0;
      const w1 = 2 * h(k) + h(k - 1), w2 = h(k) + 2 * h(k - 1);
      return (w1 + w2) / (w1 / d0 + w2 / d1);
    };
    const dt = h(i), u = (t - T[i]) / dt, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * P[i][c] + (u3 - 2 * u2 + u) * dt * m(i) + (3 * u2 - 2 * u3) * P[i + 1][c] + (u3 - u2) * dt * m(i + 1);
  });
};

SR.catmull1 = function (V, T, t) {
  return SR.catmull(V.map(v => [v, 0, 0]), T, t)[0];
};

// small hash for per-object variation
SR.hash = function (a, b = 0) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
