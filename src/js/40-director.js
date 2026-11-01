// ---------- director: everything on screen is a function of song time t ----------
(function () {
  const v3 = SR.v3, sm = SR.smooth, clamp = SR.clamp, lerp = SR.lerp, M = SR.mat4;
  const DUR = 355;
  const ORIGIN = [0, 0.3, 0];
  const GEN = SR.gen, ST = GEN.STELE, HAND = ST.touch;
  // reaching arm: rotate the resting arm direction onto the reach direction
  const ARM_K = v3.norm(v3.cross(GEN.ARM_REST, GEN.REACH));
  const ARM_ANG = Math.acos(clamp(v3.dot(GEN.ARM_REST, GEN.REACH), -1, 1));
  const armFrac = t => sm(95.5, 99, t) * (1 - sm(104, 108, t));
  // contact with the sigil at 1:39: flash, then light runs through every inscription
  const CONTACT = 99.0;
  function sigilAt(t) {
    if (t < CONTACT) return [1, 0, 0, 1];
    const k = t - CONTACT, R = 1.5 * k + 30 * Math.pow(Math.max(0, k - 1.5), 1.7);
    return [lerp(1, 0.6, sm(CONTACT, CONTACT + 6, t)), Math.exp(-k * 0.9), R, 0.15 + R * 0.04];
  }
  function rotate(q, k, a) {
    const c = Math.cos(a), s = Math.sin(a), d = v3.dot(k, q), x = v3.cross(k, q);
    return [0, 1, 2].map(i => q[i] * c + x[i] * s + k[i] * d * (1 - c));
  }
  function handAt(t) { return v3.add(GEN.SHOULDER, rotate(v3.scale(GEN.ARM_REST, GEN.ARM_LEN), ARM_K, ARM_ANG * armFrac(t))); }

  SR.SCENES = [
    { a: 0, b: 40, name: 'first scan' },
    { a: 40, b: 95, name: 'traces of civilisation' },
    { a: 95, b: 105, name: 'breath' },
    { a: 105, b: 150, name: 'first encounter' },
    { a: 150, b: 200, name: 'time' },
    { a: 200, b: 270, name: 'ascent' },
    { a: 270, b: 295, name: 'stillness' },
    { a: 295, b: 345, name: 'afterglow' },
    { a: 345, b: 355, name: 'end of record' },
  ];
  SR.sceneIndexAt = function (t) {
    t = clamp(t, 0, DUR);
    for (let i = SR.SCENES.length - 1; i >= 0; i--) if (t >= SR.SCENES[i].a) return i;
    return 0;
  };
  const CUTS = SR.CUTS = [270];   // hard camera cuts (the video export keeps motion blur from crossing them)

  // ---------- creatures ----------
  // keyed path helper: keys [[t, x, y, z], ...]
  function keyed(keys) {
    const P = keys.map(k => [k[1], k[2], k[3]]), T = keys.map(k => k[0]);
    return t => SR.catmull(P, T, t);
  }
  const W0keys = keyed([[105, 40, -80, 1010], [118, 38, 150, 820], [130, 52, 168, 415], [140, 62, 141, 75], [150, 29, 160, -315], [160, -100, 197, -535]]);
  const CITY = [0, 0, 470];
  function podPos(i, t) {
    const R = 400 + 95 * i + 40 * Math.sin(t * 0.05 + i);
    const w = 0.05 * (i % 2 ? 1 : 0.82);
    const th = i * 1.2566 + 2.4 + w * (t - 150);
    const rise = sm(203 + i * 2.5, 262 + i * 2, t);
    const y = 240 + 48 * i + 28 * Math.sin(t * 0.11 + i * 2) + rise * (1080 + 120 * i);
    const Rr = R * (1 - 0.4 * rise);
    return [CITY[0] + Math.cos(th) * Rr, y, CITY[2] + Math.sin(th) * Rr];
  }
  // Whale 0 after the overhead pass: a deterministic steering run that curves it into the pod's
  // orbit with a capped turn rate and turn acceleration (no snap turns), then follows the pod.
  const W0SIM = (function () {
    const T0 = 146, T1 = 275, DT = 1 / 60, N = Math.ceil((T1 - T0) / DT) + 2;
    const P = new Float64Array(N * 3);
    const v0 = v3.scale(v3.sub(W0keys(T0 + 0.05), W0keys(T0 - 0.05)), 10);
    let p = W0keys(T0).slice(), yaw = Math.atan2(v0[2], v0[0]), yawRate = 0, speed = Math.hypot(v0[0], v0[2]), vy = v0[1];
    for (let k = 0; k < N; k++) {
      const t = T0 + k * DT;
      P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2];
      const tg = podPos(0, t + 3);
      const dx = tg[0] - p[0], dz = tg[2] - p[2], dist = Math.hypot(dx, dz);
      const err = Math.atan2(Math.sin(Math.atan2(dz, dx) - yaw), Math.cos(Math.atan2(dz, dx) - yaw));
      const wantRate = clamp(err * 0.3, -0.1, 0.1);
      yawRate += clamp(wantRate - yawRate, -0.04 * DT, 0.04 * DT);
      yaw += yawRate * DT;
      const a = podPos(0, t - 0.5), b = podPos(0, t + 0.5), podSpeed = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const wantSpeed = clamp(podSpeed + dist * 0.06 * Math.max(0, Math.cos(err)), 10, 45);
      speed += clamp(wantSpeed - speed, -3 * DT, 3 * DT);
      const wantVy = clamp((tg[1] - p[1]) * 0.35 + (b[1] - a[1]), -45, 45);
      vy += clamp(wantVy - vy, -6 * DT, 6 * DT);
      p = [p[0] + Math.cos(yaw) * speed * DT, p[1] + vy * DT, p[2] + Math.sin(yaw) * speed * DT];
    }
    return t => {
      const f = clamp((t - T0) / DT, 0, N - 2), k = Math.floor(f), u = f - k, i = k * 3;
      return [P[i] + (P[i + 3] - P[i]) * u, P[i + 1] + (P[i + 4] - P[i + 1]) * u, P[i + 2] + (P[i + 5] - P[i + 2]) * u];
    };
  })();
  function whalePos(i, t) {
    if (i <= 4 && t >= 285) return formation(i, t);         // afterglow: the whole pod leaves with the eye whale
    if (i === 0) return t < 146 ? W0keys(t) : W0SIM(t);
    if (i <= 4) return podPos(i, t);
    // i === 5: the one that comes down to her
    return EYEW(t);
  }
  const EYEW_REST = [112, 40, 76];
  const EYEWkeys = keyed([[255, 900, 420, 900], [266, 300, 120, 260], [270, 112, 40, 76], [295, 112, 40, 76],
    [305, 170, 90, 180], [315, 260, 140, 330], [322, 360, 180, 470], [329, 820, 260, 1050], [345, 2600, 600, 3300]]);   // mostly horizontal: reads as motion from the rising camera
  function EYEW(t) { return EYEWkeys(t); }
  // afterglow formation around the eye whale; it loosens as they rise away (kept inside the pull-out's view)
  const FORM = [[-260, 70, -150], [230, -30, -230], [-430, 150, 140], [330, 80, -40], [-90, 220, -400]];
  function formation(i, t) {
    const c = EYEW(t), f = FORM[i], spread = 0.5 + 1.6 * sm(316, 332, t);   // fans out so they don't bunch up at the end
    return [c[0] + f[0] * spread, c[1] + f[1] * spread + 12 * Math.sin(t * 0.3 + i * 1.7), c[2] + f[2] * spread];
  }

  function headingOf(fn, t) {
    const a = fn(t - 0.4), b = fn(t + 0.4), d = v3.sub(b, a), l = v3.len(d);
    if (l < 1e-3) return null;
    return { yaw: Math.atan2(-d[2], d[0]), pitch: clamp(Math.asin(clamp(d[1] / l, -1, 1)), -0.5, 0.5) };
  }
  function whaleDraw(i, t) {
    const fn = tt => whalePos(i, tt), p = fn(t);
    let h = headingOf(fn, t) || { yaw: Math.PI, pitch: 0 };
    let wave = [7, 1.05, 0.75, i * 1.7];
    if (i === 5) {
      // at rest beside her: side (and eye) turned toward her, motion stilled
      const still = sm(268, 272, t) * (1 - sm(293, 300, t));
      const rest = { yaw: Math.PI, pitch: 0.05 };
      h = { yaw: lerp(h.yaw, rest.yaw, still), pitch: lerp(h.pitch, rest.pitch, still) };
      wave = [7 * (1 - still), 1.05, 0.75, 1];
    }
    return { p, h, wave };
  }

  // ---------- camera ----------
  const look = (eye, target, fov) => ({ eye, target, fov });
  function key(keys) { // [[t, eye[3], target[3], fov]]
    const T = keys.map(k => k[0]), E = keys.map(k => k[1]), G = keys.map(k => k[2]), F = keys.map(k => k[3]);
    return t => look(SR.catmull(E, T, t), SR.catmull(G, T, t), SR.catmull1(F, T, t));
  }
  const camS0 = key([[0, [0.42, 0.07, -0.62], [0.08, 0.05, 0.7], 48], [14, [0.95, 0.24, -1.5], [0, 0.65, 1.6], 50], [28, [2.1, 0.85, -3.6], [0, 1.0, 3.2], 52], [40, [3.0, 1.5, -6.2], [0, 1.4, 6], 54]]);
  const camS1 = key([
    [40, [3.0, 1.5, -6.2], [0, 1.4, 6], 54],
    [52, [-4, 3.2, -9], [0, 5, 32], 56],
    [64, [-2, 9, 58], [0, 22, 220], 60],
    [76, [-12, 26, 185], [0, 45, 470], 60],
    [88, [-280, 270, -70], [0, 40, 380], 56],
    [95, [-14, 7, -16], [0, 1.4, 0], 50],
  ]);
  // monotone keys: the swoop in from 14 m must not carry on past its key (README to-do 11: Catmull-Rom overshot and
  // swung the camera through her body at ~1:43)
  function keyMono(keys) {
    const T = keys.map(k => k[0]), E = keys.map(k => k[1]), G = keys.map(k => k[2]), F = keys.map(k => [k[3]]);
    return t => look(SR.pchip(E, T, t), SR.pchip(G, T, t), SR.pchip(F, T, t)[0]);
  }
  const camS2 = (function () {
    const off = (back, out, up) => [HAND[0] - ST.n[0] * back + ST.u[0] * out, HAND[1] + up, HAND[2] - ST.n[2] * back + ST.u[2] * out];
    // the whip round her at contact (1:39-1:40) to her front-left, where her reaching arm crosses to the stele, as before;
    // then a slow push in towards the hand, staying out there (it used to swing back through her body to her shoulder)
    const FL = [0.96, 0.83, 0.46], END = v3.lerp(FL, HAND, 0.3);
    return keyMono([[95, [-14, 7, -16], [0, 1.4, 0], 50], [99, off(1.35, 0.55, 0.32), HAND, 40], [99.5, [0.42, 1.11, -0.42], HAND, 39.6],
      [100, [0.71, 0.95, 0.1], HAND, 39], [101, FL, HAND, 38], [105, END, [HAND[0], HAND[1] + 0.02, HAND[2]], 36]]);
  })();
  function camS3(t) {
    const phi = lerp(-1.25, -2.15, sm(106, 150, t)), R = lerp(3, 9, sm(105, 125, t));
    const eye = [Math.cos(phi) * R, lerp(1.5, 1.1, sm(105, 120, t)), Math.sin(phi) * R];
    let w = [0, 0, 0], ws = 0;
    for (let k = 0; k < 8; k++) { const wt = Math.exp(-k * 0.35); w = v3.add(w, v3.scale(whalePos(0, t - k * 0.11), wt)); ws += wt; }
    w = v3.scale(w, 1 / ws);
    const base = [0, 3, 30];
    const target = v3.lerp(base, w, sm(108, 116, t) * (1 - 0.15 * sm(144, 150, t)));
    return look(eye, target, lerp(55, 72, sm(120, 138, t)));
  }
  function camS4(t) {
    const u = sm(150, 200, t), phi = lerp(-2.15, -0.8, u), R = lerp(9, 150, sm(150, 175, t)), h = lerp(1.1, 48, sm(150, 178, t));
    const eye = [Math.cos(phi) * R, h, Math.sin(phi) * R];
    const target = v3.lerp([0, 40, 120], [0, 140, 470], sm(155, 190, t));
    return look(eye, target, lerp(72, 58, sm(150, 165, t)));
  }
  // climax keys are anchored on the pod so the camera flies with (and through) them
  const camS5 = (function () {
    const P = (i, t, off) => v3.add(podPos(i, t), off);
    return key([
      [200, camS4(200).eye, camS4(200).target, 58],
      [206, P(1, 206, [-120, -60, -160]), podPos(1, 209), 62],
      [216, P(3, 216, [80, 30, -140]), podPos(3, 219), 64],
      [224, P(2, 224, [-40, 10, -60]), podPos(2, 228), 68],
      [228, P(2, 228, [0, 0, 0]), podPos(4, 232), 74],
      [234, P(2, 234, [60, 40, 110]), podPos(0, 238), 66],
      [244, [podPos(0, 244)[0] - 160, 820, podPos(0, 244)[2] - 120], podPos(0, 247), 62],
      [256, P(4, 256, [-200, 180, -260]), podPos(2, 258), 56],
      [270, P(3, 270, [-420, 520, -380]), v3.lerp(podPos(1, 270), podPos(3, 270), 0.5), 54],
    ]);
  })();
  function camS6(t) {
    const eyeW = eyeWorld(t);
    const eye = v3.lerp([-1.6, 1.15, -3.8], [-0.9, 1.35, -1.9], sm(270, 295, t));
    return look(eye, v3.lerp(eyeW, [0, 1.6, 0], 0.08), lerp(48, 34, sm(270, 295, t)));
  }
  function camS7(t) {
    const u = sm(296, 343, t);
    const alt = 3 * Math.exp(u * Math.log(42000));
    const eye = [-alt * 0.32, alt, -alt * 0.55 - 2];
    const target = v3.lerp([0, 1.2, 0], [0, -SR.gen.PR * 0.6, 0], sm(2000, 90000, alt));
    return look(eye, target, lerp(40, 50, sm(296, 310, t)));
  }
  function camS8(t) { return camS7(345); }
  const SCAM = [camS0, camS1, camS2, camS3, camS4, camS5, camS6, camS7, camS8];
  const BLEND = [0, 0, 0, 2.5, 2.5, 0, 0, 4.0, 1.0]; // [4]: the 2:32 whip-pan (user likes it fast)

  function camAt(t) {
    const i = SR.sceneIndexAt(t), a = SR.SCENES[i].a;
    let c = SCAM[i](t);
    if (i > 0 && BLEND[i] > 0 && !CUTS.includes(a) && t < a + BLEND[i]) {
      const prev = SCAM[i - 1](t), w = sm(a, a + BLEND[i], t);
      c = look(v3.lerp(prev.eye, c.eye, w), v3.lerp(prev.target, c.target, w), lerp(prev.fov, c.fov, w));
    }
    return c;
  }

  // world position of the resting whale's eye (for framing scene 7)
  function eyeWorld(t) {
    const d = whaleDraw(5, t), L = SR.gen.WHALE.L, s = 0.135, th = -0.22;
    const pr = SR.gen.prof(s);
    const local = [L * (0.5 - s), pr * Math.sin(th) * 0.86, pr * 1.18 * Math.cos(th) + 1];
    const m = M.trs(d.p, d.h.yaw, d.h.pitch, 0, 1);
    return [m[0] * local[0] + m[4] * local[1] + m[8] * local[2] + m[12], m[1] * local[0] + m[5] * local[1] + m[9] * local[2] + m[13], m[2] * local[0] + m[6] * local[1] + m[10] * local[2] + m[14]];
  }

  // ---------- HUD ----------
  const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
  function hudAt(t, i, cam) {
    const l1 = `SURVEY 04 · SECTOR K-11 · T+${pad(t / 60, 2)}:${pad(t % 60, 2)}`;
    let l2 = '';
    const alt = cam.eye[1];
    if (i === 0) l2 = 'SCAN PULSE · PASSIVE';
    else if (i === 1) l2 = `STRUCTURES · ${Math.floor(3 + sm(42, 92, t) * 211)} RESOLVED`;
    else if (i === 2) l2 = t < CONTACT ? 'SIGIL DETECTED' : 'CONTACT · SIGNAL PROPAGATING';
    else if (i === 3) l2 = t < 107 ? `SIGNAL PROPAGATING · ${(sigilAt(t)[2] / 1000).toFixed(2)} KM` : 'BIO-SIG DETECTED · MASS EST. 4.1E7 KG';
    else if (i === 4) l2 = `CHRONO DRIFT · EPOCH −${(Math.floor(sm(152, 198, t) * 12480)).toLocaleString('en-US')}`;
    else if (i === 5) l2 = `ALTITUDE ${Math.max(0, Math.round(alt))} M`;
    else if (i === 6) l2 = 'BIO-SIG · RANGE 31 M';
    else if (i === 7) l2 = alt < 2000 ? `ALTITUDE ${Math.round(alt)} M` : `ALTITUDE ${(alt / 1000).toFixed(1)} KM`;
    else l2 = 'END OF RECORD';
    return i === 8 ? [l1, 'END OF RECORD'] : [l1, l2];
  }

  // ---------- full state ----------
  SR.stateAt = function (tIn) {
    const t = clamp(tIn, 0, DUR), i = SR.sceneIndexAt(t), cam = camAt(t);
    const alt = cam.eye[1];

    // global look
    const fade = Math.min(sm(0.0, 1.4, t), 1 - sm(347, 354.5, t));
    const exposure = 1.0;
    const fog = Math.max(1600, alt * 6);

    // scan pulses from her
    const pulseSpeed = t < 40 ? lerp(8, 14, sm(0, 40, t)) : t < 95 ? lerp(14, 120, sm(40, 90, t)) : t < 105 ? 40 : t < 270 ? lerp(120, 260, sm(195, 230, t)) : t < 295 ? 30 : lerp(60, 400, sm(295, 345, t));
    const pulseLife = t < 40 ? 4 : t < 95 ? lerp(4, 6, sm(40, 90, t)) : 6;
    const pulseRing = t < 95 ? lerp(0.5, 3, sm(30, 90, t)) : t < 200 ? 3 : t < 270 ? 6 : t < 295 ? 1.5 : 8;
    const pulses = SR.music.pulsesAt(t, pulseLife, SR.gl ? SR.gl.MAXP : 24).map(n => ({ x: ORIGIN[0], y: ORIGIN[1], z: ORIGIN[2], t0: n.t0, k: Math.pow(n.vel / 108, 0.8) }));

    // how much of the world is visible without a pulse
    const revealWorld = t < 40 ? 0 : t < 95 ? 0.55 * sm(44, 92, t) : t < 270 ? lerp(0.55, 0.85, sm(150, 175, t)) : t < 295 ? 0.5 : lerp(0.5, 0.9, sm(295, 315, t));
    const assemble = sm(156, 192, t) * (1 - sm(250, 268, t));
    const low = SR.music.lowAt(t), high = SR.music.highAt(t);

    const draws = [];
    // stars (attached to the camera), time-lapse trails in scene 5
    const starA = 0.25 + 0.75 * sm(10, 60, t);
    const spin = t < 150 ? 0 : (t < 200 ? Math.pow(sm(150, 200, t), 1.5) * 50 * 0.25 : 12.5 + (t - 200) * 0.002);
    const trail = sm(152, 160, t) * (1 - sm(196, 202, t));
    const nTr = trail > 0.01 ? 6 : 1;
    for (let k = 0; k < nTr; k++) {
      const ang = spin - k * 0.012 * trail;
      draws.push({ name: 'sky', model: M.trs(cam.eye, ang, 0, 0, 1), params: { reveal: 1, size: 0, alpha: starA * (k ? 0.55 * (1 - k / nTr) : 1) } });
    }
    draws.push({ name: 'ring', params: { reveal: 1, size: 70, alpha: 0.55 * sm(30, 70, t) * (1 - 0.6 * sm(150, 170, t) * (1 - sm(195, 205, t))) } });

    // planet / terrain hand-over during the pull-out
    const planetA = sm(1500, 9000, alt), terrA = 1 - sm(4000, 16000, alt);
    if (planetA > 0) draws.push({ name: 'planet', params: { reveal: 1, size: 40, alpha: planetA * 0.9, detach: [sm(346, 354, t), (t - 345) * 400] } });
    if (terrA > 0) draws.push({ name: 'terrain', params: { assemble, lift: 0, reveal: revealWorld, size: 0.075, alpha: terrA * (1 - 0.7 * sm(96, 99, t) * (1 - sm(104, 107, t))), shake: i === 3 ? low * 0.25 * sm(105, 112, t) : 0 } });
    if (terrA > 0) draws.push({ name: 'ruins', params: { reveal: revealWorld, size: 0.2, alpha: terrA, assemble, lift: 1, glyph: [HAND[0], HAND[1], HAND[2], t >= CONTACT ? 0.45 * (1 - sm(110, 122, t)) : 0], sigil: sigilAt(t), xray: t > 78 && t < 94 ? sm(78, 83, t) * (1 - sm(90, 94, t)) : 0 } });   // the sonar sees the buried ziggurat as the camera rises over the mound (scale reversal)

    // clouds for the ascent
    const cloudA = sm(205, 232, t) * (1 - sm(266, 270, t));
    if (cloudA > 0) draws.push({ name: 'clouds', params: { reveal: 1, size: 1.6, alpha: cloudA * 0.85 } });

    // whales (afterglow: the pod rejoins the eye whale at 4:58; all fade out together with the bright centre disc, i.e. terrA)
    const afterglow = t >= 295 && t < 347 ? 0.85 * sm(298, 306, t) * terrA : 0;
    const wa = [
      (t >= 104 && t < 272 ? sm(104, 110, t) * (1 - sm(268, 270, t)) : 0) || afterglow,
      ...[1, 2, 3, 4].map(k => (t > 160 && t < 272 ? sm(162 + k * 2.5, 176 + k * 2.5, t) * (1 - sm(268, 270, t)) : 0) || afterglow),
      t >= 255 && t < 347 ? sm(255, 262, t) * (t >= 295 ? terrA : 1) : 0,
    ];
    for (let k = 0; k < 6; k++) {
      if (wa[k] <= 0) continue;
      const d = whaleDraw(k, t);
      const p = d.p;
      const detach = k === 5 ? [0.22 * sm(272, 292, t) * (1 - sm(300, 312, t)), Math.max(0, t - 272)] : [0, 0];
      const sparkle = k === 5 ? clamp(high * 1.6, 0, 1) : 0;
      const dist = v3.len(v3.sub(p, cam.eye));
      const far = clamp(260 / Math.max(dist, 1), 0.22, 1);
      const model = M.trs(p, d.h.yaw, d.h.pitch, 0, 1);
      draws.push({ name: 'whale', model, params: { reveal: 1, size: 0.63, alpha: wa[k] * 0.45 * far, wave: d.wave, detach, sparkle } });
      if (k === 5) {
        const hA = sm(268, 271, t) * (1 - sm(296, 304, t));
        if (hA > 0) draws.push({ name: 'whaleHead', model, params: { reveal: 1, size: 0.13, alpha: hA * 0.5, wave: d.wave, detach: [detach[0] * 1.4, detach[1]], sparkle } });
      }
    }

    // heroine at the origin
    const arm = [ARM_K[0], ARM_K[1], ARM_K[2], ARM_ANG * armFrac(t)];
    draws.push({ name: 'heroine', params: { reveal: 1, size: 0.006, alpha: (t < 40 ? 0.35 + 0.65 * sm(0.5, 30, t) : 1) * terrA, arm, armPivot: GEN.SHOULDER, occlude: 0.02, tint: [1.5, 1.5, 1.5] } });

    return {
      t, scene: i, cam, hud: hudAt(t, i, cam), fade, exposure, fog,
      maxPx: i === 2 || i === 6 ? 7 : 5,
      pulses, pulseSpeed, pulseLife, pulseRing, draws,
      lamp: [0, 0.4, 0, lerp(2.5, 7, sm(0, 40, t))], lampK: i === 8 ? 0 : 0.35,
    };
  };
  SR.director = { whalePos, podPos, eyeWorld, camAt, handAt };
})();
