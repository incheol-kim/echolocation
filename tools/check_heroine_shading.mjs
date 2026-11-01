// End-to-end shading check in headless Edge: renders the heroine alone from the front and compares the
// mean luminance of the chest centre with the waist centre (both face the camera). Uneven point density on the
// surface (or obliquity) shows up as a dark patch on the chest; it should be at least ~85% as bright as the waist.
// Usage: node tools/check_heroine_shading.mjs   (exit code 0 = pass)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eye = [0.35, 1.05, 1.55], tg = [0, 0.9, 0];
const url = 'file:///' + root.replace(/\\/g, '/') + `/test/gl-smoke.html?t=50&reveal=1&only=heroine&eye=${eye}&tg=${tg}`;
const port = 9400 + Math.floor(Math.random() * 400);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--use-angle=d3d11', '--enable-gpu',
  '--ignore-gpu-blocklist', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, '--window-size=1280,720',
  '--user-data-dir=' + process.env.TEMP + '/edge-shade-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
await send('Page.navigate', { url });
for (let i = 0; i < 600 && (await ev('document.title')) !== 'OK'; i++) await sleep(200);
const res = await ev(`(() => {
  const cv = document.querySelector('canvas'), gl = cv.getContext('webgl2'), W = cv.width, H = cv.height;
  const V = SR.mat4.lookAt(${JSON.stringify(eye)}, ${JSON.stringify(tg)}, [0, 1, 0]), P = SR.mat4.perspective(1.0, 16 / 9, 0.05, 200000);
  const proj = p => { const v = [0, 1, 2, 3].map(r => V[r] * p[0] + V[4 + r] * p[1] + V[8 + r] * p[2] + V[12 + r]);
    const c = [0, 1, 2, 3].map(r => P[r] * v[0] + P[4 + r] * v[1] + P[8 + r] * v[2] + P[12 + r] * v[3]);
    return [(c[0] / c[3] * 0.5 + 0.5) * W, (c[1] / c[3] * 0.5 + 0.5) * H]; };
  const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const mean = (p, r) => { const [cx, cy] = proj(p); let s = 0, n = 0;
    for (let y = Math.round(cy - r); y <= cy + r; y++) for (let x = Math.round(cx - r); x <= cx + r; x++) { const i = (y * W + x) * 4; s += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11; n++; }
    return s / n; };
  return { centre: mean([0, 1.25, 0.12], 10), side: mean([0, 1.1, 0.1], 10) };
})()`);
ws.close(); edge.kill();
const ratio = res.centre / res.side;
console.log(`chest centre ${res.centre.toFixed(1)}  waist centre ${res.side.toFixed(1)}  chest/waist ${ratio.toFixed(2)}  -> ${ratio >= 0.85 ? 'PASS' : 'FAIL'}`);
process.exit(ratio >= 0.85 ? 0 : 1);
