// ---------- WebGL2 point renderer ----------
// Points are splatted additively into a half-float HDR target, then tone-mapped.
SR.gl = (function () {
  const MAXP = 24;
  const HERO_BACK = SR.HERO_BACK = 0.05;   // brightness floor for her back-facing points
  const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aAlt;
layout(location=2) in vec4 aAttr;
uniform mat4 uView, uProj, uModel;
uniform float uT, uFocal, uMinPx, uMaxPx, uExposure, uFog;
uniform float uPxScale;   // output height / 1080: sizes in 1080p pixels times this
uniform float uDepthPass, uDepthBias;
uniform vec4 uPulse[${MAXP}];      // xyz origin, w onset time
uniform float uPulseK[${MAXP}];    // strength 0..1 (velocity)
uniform int uPulseN;
uniform float uPulseSpeed, uPulseLife, uPulseRing;
uniform float uAssemble, uReveal, uDetachFrac, uDetachT, uSparkle, uAlpha, uSize, uLift, uShake;
uniform vec4 uArmRot;   // axis xyz, angle (Rodrigues) for the reaching arm
uniform vec3 uArmPivot;
uniform vec4 uWave;    // amp, wavelengths along body, angular speed, phase
uniform vec4 uGlyph;   // xyz touch point, w residual glow behind the wave
uniform vec4 uSigil;   // idle breathing, contact flash, wave radius (m), wave front width (m)
uniform vec3 uTint;
uniform float uXray;   // 0..1: the sonar's x-ray of the buried ziggurat (gen XRAY points)
uniform vec3 uEye;
uniform vec4 uLamp;   // xyz position, radius (strength via uLampK)
uniform float uLampK;
out vec3 vCol;
out float vSoft;
const float TAU = 6.2831853;

vec3 baseColor(float type, float b) {
  if (type < 0.5) return mix(vec3(0.51, 0.67, 0.76), vec3(0.88, 0.93, 0.96), b);
  if (type < 1.5) return vec3(0.80, 0.95, 1.0);
  if (type < 2.5) return vec3(1.0, 0.745, 0.47);
  if (type < 3.5) return vec3(1.0, 0.478, 0.29);
  if (type < 4.5) return vec3(0.85, 0.92, 1.0);
  if (type < 5.5) return vec3(0.70, 0.80, 0.88);
  if (type < 6.5) return vec3(1.0, 0.80, 0.55);
  if (type < 7.5) return vec3(0.95, 0.88, 0.78);
  return vec3(0.75, 1.0, 0.95);
}
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  float b = aAttr.x, type = aAttr.y, rnd = aAttr.z, aux = aAttr.w;
  // --- assembly (ruins -> intact city), staggered per point with an arc
  bool hero = type > 2.5 && type < 3.5;
  vec3 hn = hero ? aAlt : vec3(0.0, 1.0, 0.0);   // heroine stores her surface normal in alt
  float f = hero ? 0.0 : clamp(uAssemble * 1.7 - rnd * 0.7, 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  vec3 p = mix(aPos, aAlt, f);
  p.y += sin(f * 3.14159) * (6.0 + 30.0 * rnd) * step(0.001, distance(aPos, aAlt)) * uLift;

  // --- creature undulation (aux = head 0 .. tail 1)
  if (type > 1.5 && type < 2.5 || type > 5.5 && type < 6.5) {
    float s = aux;
    float env = 0.18 + pow(s, 1.6);
    p.y += uWave.x * env * sin(TAU * s * uWave.y - uT * uWave.z + uWave.w);
    p.z += uWave.x * 0.25 * env * sin(TAU * s * uWave.y * 0.5 - uT * uWave.z * 0.7 + uWave.w + 1.3);
  }
  // --- heroine reaching arm (aux = 1) rotates about the shoulder
  if (type > 2.5 && type < 3.5 && aux > 0.001 && uArmRot.w != 0.0) {
    vec3 q = p - uArmPivot, k = uArmRot.xyz;
    float ang = uArmRot.w * aux;   // skin weight: the shoulder bends smoothly
    float c = cos(ang), s2 = sin(ang);
    p = uArmPivot + q * c + cross(k, q) * s2 + k * dot(k, q) * (1.0 - c);
    hn = hn * c + cross(k, hn) * s2 + k * dot(k, hn) * (1.0 - c);
  }
  vec3 wp = (uModel * vec4(p, 1.0)).xyz;
  // ground tremor (deterministic in t)
  wp.y += uShake * sin(uT * 37.0 + rnd * 211.0) * (0.3 + 0.7 * h1(rnd * 3.7));

  // --- detaching dust (creature points drift off as glittering motes)
  float dust = 0.0;
  if (uDetachFrac > 0.0 && rnd < uDetachFrac) {
    dust = 1.0;
    vec3 dir = normalize(vec3(h1(rnd * 91.7) - 0.5, h1(rnd * 13.3) * 0.8 + 0.1, h1(rnd * 57.1) - 0.5));
    float sp = 0.6 + 2.4 * h1(rnd * 7.7);
    wp += dir * sp * uDetachT + vec3(sin(uT * 0.7 + rnd * 40.0), 0.0, cos(uT * 0.6 + rnd * 33.0)) * min(uDetachT, 3.0) * 0.4;
  }

  // --- scan pulses: bright ring + fading memory of where the wave has passed
  float ring = 0.0, mem = 0.0;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= uPulseN) break;
    float age = uT - uPulse[i].w;
    if (age < 0.0) continue;
    float k = uPulseK[i];
    float sp = uPulseSpeed * (0.6 + 0.8 * k);
    float R = sp * age;
    float d = distance(wp, uPulse[i].xyz);
    float w = uPulseRing * (1.0 + R * 0.02);
    float life = 1.0 - clamp(age / uPulseLife, 0.0, 1.0);
    ring = max(ring, exp(-pow((d - R) / w, 2.0)) * life * (0.35 + 0.65 * k));
    if (d < R) mem = max(mem, exp(-(age - d / sp) * 0.75) * (0.4 + 0.6 * k) * life);
  }
  float lamp = uLampK * exp(-distance(wp, uLamp.xyz) / max(uLamp.w, 0.001));
  float vis = mix(clamp(mem + ring + lamp, 0.0, 1.0), 1.0, uReveal);

  vec4 vp = uView * vec4(wp, 1.0);
  float depth = max(-vp.z, 0.001);
  // occlusion pre-pass (heroine only): write depth slightly behind the surface so her own front-surface
  // points still pass, while anything clearly behind her front surface (backpack, far side) is hidden
  if (uDepthPass > 0.5) vp.z -= uDepthBias;
  gl_Position = uProj * vp;

  // --- size: per-point spacing (aux on static geometry) projected to pixels.
  // Splats never shrink below uMinPx; when the projected spacing is smaller than
  // that the cloud is oversampled, so each point is dimmed to keep area brightness.
  bool spaced = (type < 1.5 || (type > 4.5 && type < 5.5) || type > 6.5) && aux > 0.0;
  float spacing = spaced ? aux : uSize;
  float px = spacing * uFocal / depth;
  float sz = clamp(px, uMinPx, uMaxPx);
  float energy = px >= uMinPx ? pow(uMinPx / sz, 0.6) : max(pow(px / uMinPx, 1.5), 0.015);
  if (type > 3.5 && type < 4.5) { sz = uMinPx * (1.0 + 1.6 * b); energy = 1.0; }
  gl_PointSize = uDepthPass > 0.5 ? sz * 2.2 : sz;   // fatter splats in the depth pass close the gaps between points
  vSoft = sz / uPxScale;   // in 1080p pixels, so a point looks the same at every resolution (4K was up to 14 % darker)

  vec3 col = baseColor(type, b) * uTint;
  float lum = (type > 0.5 && type < 1.5) ? 0.9 : b;
  if (type > 0.2 && type < 0.3) lum *= f;   // buried under the sand (gen BURIED): hidden in the ruins, shown as the city assembles
  if (type > 0.3 && type < 0.45) {          // x-ray (gen XRAY): only while the sonar looks through the mound; every wave re-lights it
    lum *= uXray * (0.3 + 0.7 * clamp(mem * 1.5, 0.0, 1.0));
    col = mix(col, vec3(0.59, 1.0, 0.94), 0.55);
  }
  if (type > 3.5 && type < 4.5) lum = b * (0.75 + 0.25 * sin(uT * (1.0 + rnd * 2.0) + aux));
  // the sigil she touches, and the light it sends through every inscription
  if ((type > 0.5 && type < 1.5) || type > 7.5) {
    float dist = distance(wp, uGlyph.xyz);
    float g = 0.0;
    if (uSigil.z > 0.0) g = 1.6 * exp(-pow((dist - uSigil.z) / uSigil.w, 2.0)) + uGlyph.w * step(dist, uSigil.z);
    if (type > 7.5) g += uSigil.x * (0.3 + 0.2 * sin(uT * 2.2)) + uSigil.y * 4.0;
    col = mix(col, vec3(0.59, 1.0, 0.94), clamp(g, 0.0, 1.0));
    lum += g * 2.2;
    vis = max(vis, clamp(g, 0.0, 1.0));
  }
  // contact burst: the stone around the sigil lights up for a moment
  if (type < 0.5 && uSigil.y > 0.01) {
    float burst = uSigil.y * exp(-distance(wp, uGlyph.xyz) / 0.35);
    col = mix(col, vec3(0.59, 1.0, 0.94), clamp(burst * 1.5, 0.0, 0.9));
    lum += burst * 4.0;
    vis = max(vis, clamp(burst * 2.0, 0.0, 1.0));
  }
  // her points facing away from the camera are dimmed so the visor and suit details read clearly
  if (hero) {
    float facing = dot(normalize(mat3(uModel) * hn), normalize(uEye - wp));
    lum *= mix(${HERO_BACK.toFixed(3)}, 1.0, smoothstep(-0.05, 0.35, facing));
    // oblique surfaces pack more points into each pixel (bright rims, dark centres); compensate by the view angle
    lum *= mix(0.28, 1.0, clamp(abs(facing), 0.0, 1.0));
  }
  // scan ring tint
  col = mix(col, vec3(0.59, 1.0, 0.94), clamp(ring * 1.2, 0.0, 0.85));
  lum *= 1.0 + ring * 2.2;
  // sparkle on dust
  if (dust > 0.5) lum *= 0.6 + uSparkle * 5.0 * pow(0.5 + 0.5 * sin(uT * (2.0 + 6.0 * rnd) + rnd * 100.0), 10.0);
  float fog = exp(-depth / uFog);
  float a = uAlpha * vis * energy * fog;
  vCol = col * lum * a * uExposure;
}`;
  const FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vSoft;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = vSoft < 2.5 ? 1.0 : exp(-r2 * 2.2);
  o = vec4(vCol * a, 1.0);
}`;
  const TVS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 vUv;
void main() { vUv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;
  const TFS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHdr;
uniform float uScale, uFade;
uniform vec3 uBg;
out vec4 o;
void main() {
  vec3 c = texture(uHdr, vUv).rgb * uScale;
  c = vec3(1.0) - exp(-c * 1.15);              // soft shoulder, never clips
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.35 * dot(q, q) * 2.0;           // gentle vignette
  c = uBg + c * (1.0 - uBg);
  c = pow(c, vec3(1.0 / 1.12));
  o = vec4(c * uFade, 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i), nm = info.name.replace(/\[0\]$/, ''); U[nm] = gl.getUniformLocation(p, info.name); }
    return { p, U };
  }

  function init(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not available');
    const P = program(gl, VS, FS), T = program(gl, TVS, TFS);
    const objs = {};
    let fbo = null, tex = null, depthRb = null, W = 0, H = 0;

    function add(name, g) {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      [[g.pos, 3], [g.alt, 3], [g.attr, 4]].forEach(([arr, size], loc) => {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      });
      gl.bindVertexArray(null);
      return (objs[name] = { vao, count: g.pos.length / 3 });
    }
    function resize(w, h) {
      if (w === W && h === H) return;
      W = w; H = h; canvas.width = w; canvas.height = h;
      if (tex) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); }
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (depthRb) gl.deleteRenderbuffer(depthRb);
      depthRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const DEF = { assemble: 0, reveal: 1, wave: [0, 1, 0, 0], detach: [0, 0], sparkle: 0, arm: [1, 0, 0, 0], armPivot: [-0.2, 1.37, 0], glyph: [0, 0, 0, 0], sigil: [0, 0, 0, 1], alpha: 1, size: 0.1, tint: [1, 1, 1], lift: 1, shake: 0, occlude: 0, xray: 0 };   // occlude: depth bias in metres (0 = no self-occlusion)

    // Render one sub-frame into the HDR target. `weight` scales its contribution
    // so several jittered sub-frames can be accumulated (clear = first sub-frame).
    function splat(G, draws, clear, weight) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H);
      if (clear) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.uniform1f(P.U.uDepthPass, 0);
      gl.useProgram(P.p); const U = P.U;
      gl.uniformMatrix4fv(U.uView, false, G.view); gl.uniformMatrix4fv(U.uProj, false, G.proj);
      gl.uniform1f(U.uT, G.t); gl.uniform1f(U.uFocal, G.proj[5] * H / 2);
      gl.uniform1f(U.uMinPx, 1.5 * H / 1080); gl.uniform1f(U.uMaxPx, (G.maxPx || 5) * H / 1080); gl.uniform1f(U.uPxScale, H / 1080);
      gl.uniform1f(U.uExposure, (G.exposure || 1) * weight); gl.uniform1f(U.uFog, G.fog || 2000);
      gl.uniform3fv(U.uEye, G.eye);
      gl.uniform4fv(U.uLamp, G.lamp || [0, 0, 0, 1]); gl.uniform1f(U.uLampK, G.lampK == null ? 0 : G.lampK);
      const pu = new Float32Array(MAXP * 4), pk = new Float32Array(MAXP), ps = G.pulses || [];
      ps.slice(0, MAXP).forEach((q, i) => { pu.set([q.x, q.y, q.z, q.t0], i * 4); pk[i] = q.k; });
      gl.uniform4fv(U.uPulse, pu); gl.uniform1fv(U.uPulseK, pk); gl.uniform1i(U.uPulseN, Math.min(ps.length, MAXP));
      gl.uniform1f(U.uPulseSpeed, G.pulseSpeed || 30); gl.uniform1f(U.uPulseLife, G.pulseLife || 4); gl.uniform1f(U.uPulseRing, G.pulseRing || 1.2);
      for (const d of draws) {
        const o = objs[d.name]; if (!o) continue;
        const q = Object.assign({}, DEF, d.params || {});
        if (q.alpha <= 0) continue;
        gl.uniformMatrix4fv(U.uModel, false, d.model || SR.mat4.identity());
        gl.uniform1f(U.uAssemble, q.assemble); gl.uniform1f(U.uReveal, q.reveal);
        gl.uniform4fv(U.uWave, q.wave); gl.uniform1f(U.uDetachFrac, q.detach[0]); gl.uniform1f(U.uDetachT, q.detach[1]);
        gl.uniform1f(U.uSparkle, q.sparkle); gl.uniform4fv(U.uArmRot, q.arm); gl.uniform3fv(U.uArmPivot, q.armPivot); gl.uniform4fv(U.uGlyph, q.glyph); gl.uniform4fv(U.uSigil, q.sigil); gl.uniform1f(U.uXray, q.xray);
        gl.uniform1f(U.uAlpha, q.alpha); gl.uniform1f(U.uSize, q.size); gl.uniform3fv(U.uTint, q.tint); gl.uniform1f(U.uLift, q.lift); gl.uniform1f(U.uShake, q.shake);
        gl.bindVertexArray(o.vao);
        if (q.occlude) {
          // pass 1: depth only (fat splats, pushed back by the bias); pass 2: colour where not hidden
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.colorMask(false, false, false, false);
          gl.uniform1f(U.uDepthPass, 1); gl.uniform1f(U.uDepthBias, q.occlude);
          gl.drawArrays(gl.POINTS, 0, o.count);
          gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.colorMask(true, true, true, true);
          gl.uniform1f(U.uDepthPass, 0);
          gl.drawArrays(gl.POINTS, 0, o.count);
          gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
        } else gl.drawArrays(gl.POINTS, 0, o.count);
      }
      gl.bindVertexArray(null);
    }
    function present(G) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND); gl.useProgram(T.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(T.U.uHdr, 0);
      gl.uniform1f(T.U.uScale, 1); gl.uniform1f(T.U.uFade, G.fade == null ? 1 : G.fade);
      gl.uniform3fv(T.U.uBg, [0.012, 0.024, 0.039]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function frame(G, draws) { splat(G, draws, true, 1); present(G); }
    return { gl, add, resize, frame, splat, present, get size() { return [W, H]; } };
  }
  return { init, MAXP };
})();
