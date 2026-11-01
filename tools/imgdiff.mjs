// Pixel difference between two PNG screenshots, computed in headless Edge (no image libraries needed).
// Usage: node tools/imgdiff.mjs a.png b.png   -> prints mean / max abs difference (0..255) and share of pixels off by > 8
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [a, b] = process.argv.slice(2).map(p => path.resolve(p));
const toUrl = p => 'file:///' + p.replace(/\\/g, '/');
const page = path.join(os.tmpdir(), 'imgdiff-' + process.pid + '.html');
fs.writeFileSync(page, `<!doctype html><script>
const load = s => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = s; });
Promise.all([load(${JSON.stringify(toUrl(a))}), load(${JSON.stringify(toUrl(b))})]).then(([A, B]) => {
  const W = A.width, H = A.height, px = img => { const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, W, H).data; };
  const p = px(A), q = px(B); let sum = 0, max = 0, off = 0;
  for (let i = 0; i < p.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(p[i + k] - q[i + k]));
    sum += m; max = Math.max(max, m); if (m > 8) off++; }
  window.__diff = { mean: sum / (W * H), max, offShare: off / (W * H), size: [W, H, B.width, B.height] };
});
</script>`);
const port = 9800 + Math.floor(Math.random() * 150);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`, '--user-data-dir=' + path.join(os.tmpdir(), 'edge-diff-' + port), 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
await send('Page.navigate', { url: toUrl(page) });
let d = null;
for (let i = 0; i < 100 && !(d = await ev('window.__diff')); i++) await sleep(100);
ws.close(); edge.kill(); fs.unlinkSync(page);
console.log(`${path.basename(a)} vs ${path.basename(b)}: mean ${d.mean.toFixed(3)}  max ${d.max}  pixels off by >8: ${(d.offShare * 100).toFixed(3)}%`);
