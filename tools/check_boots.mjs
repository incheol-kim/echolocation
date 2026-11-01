// End-to-end check in headless Edge: are her boots visible, or washed out by bright ground showing through them?
// For each time: render the full scene, then render only the heroine. On pixels her boots cover (orange in the
// heroine-only render) the full render must not add much light from the world behind (blue channel rise).
// Usage: node tools/check_boots.mjs [t ...]   (exit code 0 = pass)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const times = process.argv.slice(2).map(Number);
if (!times.length) times.push(45, 115, 130);
const port = 9450 + Math.floor(Math.random() * 300);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--use-angle=d3d11', '--enable-gpu',
  '--ignore-gpu-blocklist', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, '--window-size=1280,720',
  '--user-data-dir=' + process.env.TEMP + '/edge-boots-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
await send('Page.navigate', { url: 'file:///' + root.replace(/\\/g, '/') + '/dist/echolocation.html?w=1280&h=720#t=1' });
for (let i = 0; i < 300 && !(await ev('!!window.SR_READY')); i++) await sleep(100);
let ok = true;
for (const t of times) {
  const r = await ev(`(() => {
    const cv = document.getElementById('view'), gl = cv.getContext('webgl2'), W = cv.width, H = cv.height;
    const grab = only => { renderAt(${t}, only); const p = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    const full = grab(), hero = grab('heroine');
    const s = SR.stateAt(${t}), c = s.cam;
    const V = SR.mat4.lookAt(c.eye, c.target, [0, 1, 0]), P = SR.mat4.perspective(c.fov * Math.PI / 180, W / H, Math.max(0.02, c.eye[1] * 0.002), 4e6);
    const proj = p => { const v = [0, 1, 2, 3].map(k => V[k] * p[0] + V[4 + k] * p[1] + V[8 + k] * p[2] + V[12 + k]);
      const q = [0, 1, 2, 3].map(k => P[k] * v[0] + P[4 + k] * v[1] + P[8 + k] * v[2] + P[12 + k] * v[3]);
      return [(q[0] / q[3] * 0.5 + 0.5) * W, (q[1] / q[3] * 0.5 + 0.5) * H]; };
    const J = SR.gen.HJ, a = proj([J.LA[0], 0.0, J.LA[2] + 0.05]), b = proj([J.RA[0], 0.0, J.RA[2] + 0.06]), k = proj([0, 0.12, 0.03]);
    const x0 = Math.floor(Math.min(a[0], b[0]) - 6), x1 = Math.ceil(Math.max(a[0], b[0]) + 6);
    const y0 = Math.floor(Math.min(a[1], b[1]) - 3), y1 = Math.ceil(k[1] + 2);
    let n = 0, rise = 0;
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = (y * W + x) * 4;
      if (hero[i] > hero[i + 2] + 25) { n++; rise += full[i + 2] - hero[i + 2]; }   // a boot pixel (orange), how much blue the world added
    }
    // the rest of her must stay see-through: the world still adds light behind her legs and body (reported, not judged)
    const u = proj([-0.25, 0.3, 0]), v = proj([0.25, 1.3, 0]);
    let m = 0, riseB = 0;
    for (let y = Math.max(0, Math.floor(Math.min(u[1], v[1]))); y <= Math.min(H - 1, Math.ceil(Math.max(u[1], v[1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(u[0], v[0]))); x <= Math.min(W - 1, Math.ceil(Math.max(u[0], v[0]))); x++) {
        const i = (y * W + x) * 4;
        if (hero[i] > hero[i + 2] + 25) { m++; riseB += full[i + 2] - hero[i + 2]; }
      }
    return { n, rise: n ? rise / n : -1, m, riseB: m ? riseB / m : -1 };
  })()`);
  const pass = r.n >= 6 && r.rise <= 25;
  ok = ok && pass;
  console.log(`t=${t}: boot pixels ${r.n}, light added from behind ${r.rise.toFixed(1)} -> ${pass ? 'PASS' : 'FAIL'}   (legs/body: ${r.m} px, light from behind ${r.riseB.toFixed(1)})`);
}
ws.close(); edge.kill();
process.exit(ok ? 0 : 1);
