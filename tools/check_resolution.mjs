// The picture must look the same at every resolution (design doc 9.2: point sizes scale with the resolution; the 1080p
// video is made from 4K frames). Renders the same moments at 1920x1080 and 3840x2160 in headless Edge and compares the
// mean brightness of the canvas itself (no page overlays, no screenshot timing).
// Usage: node tools/check_resolution.mjs [t ...]   (exit code 0 = within 2 % everywhere)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const times = process.argv.slice(2).map(Number);
if (!times.length) times.push(20, 100, 190, 270, 320);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function means(W, H) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--disable-features=CalculateNativeWinOcclusion',
    `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, '--user-data-dir=' + process.env.TEMP + '/edge-res-' + port, 'about:blank'], { stdio: 'ignore' });
  let tg;
  for (let i = 0; i < 100 && !tg; i++) { try { tg = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(tg.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `file:///${root.replace(/\\/g, '/')}/dist/echolocation.html?w=${W}&h=${H}#t=0` });
  for (let i = 0; i < 600 && !(await ev('!!window.SR_READY')); i++) await sleep(100);
  const out = [];
  for (const t of times) out.push(await ev(`(() => { renderAt(${t}); const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d');
    g.drawImage(document.getElementById('view'), 0, 0, 192, 108); const d = g.getImageData(0, 0, 192, 108).data; let s = 0;
    for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]; return s / (d.length / 4) / 3; })()`));
  ws.close(); edge.kill();
  return out;
}
const a = await means(1920, 1080), b = await means(3840, 2160);
let ok = true;
times.forEach((t, k) => {
  const rel = (b[k] - a[k]) / Math.max(a[k], 1e-6), pass = Math.abs(rel) <= 0.02;
  ok = ok && pass;
  console.log(`t=${t}: mean 1080p ${a[k].toFixed(2)}, 4K ${b[k].toFixed(2)} (${(100 * rel).toFixed(1)} %) -> ${pass ? 'PASS' : 'FAIL'}`);
});
process.exit(ok ? 0 : 1);
