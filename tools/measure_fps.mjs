// Frame-rate measurement in Edge (README to-do 7). Measurement only: nothing here changes the piece.
//   1. scan: for every 2.5 s of the piece, the time to render one frame including the GPU (renderAt + a 1-pixel
//      readback), averaged over 6 frames -> the frame rate that moment could reach at most
//   2. play: the whole piece played in real time from 0:00 to the end (audio muted), every animation frame logged ->
//      frames per second as actually shown, per second and per scene
// Usage: node tools/measure_fps.mjs [WIDTHxHEIGHT] [--scan-only] [--headed] [--browser-gpu] [--until=SECONDS]
//   (default 1920x1080, headless, whole piece). --until stops the real-time part early (quick checks).
//   Headless Edge on an integrated GPU sometimes stops producing animation frames while the audio runs on; the
//   real-time part reports such stalls instead of counting them as the piece's frame rate (the scan is unaffected).
//   By default Edge is asked for the high-performance GPU (on a laptop: the discrete one). --browser-gpu leaves the
//   choice to the browser, which on a hybrid laptop is the power-saving integrated GPU: what a viewer gets by default
//   (the page's powerPreference: 'high-performance' is not honoured there).
//   Writes dist/fps-<size>-<gpu>-scan.csv / -play.csv and prints a summary.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const [W, H] = (args.find(a => /^\d+x\d+$/.test(a)) || '1920x1080').split('x').map(Number);
const until = +((args.find(a => a.startsWith('--until=')) || '').split('=')[1] || 0);
const scanOnly = args.includes('--scan-only'), headed = args.includes('--headed'), browserGpu = args.includes('--browser-gpu');
const port = 9450 + Math.floor(Math.random() * 300);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [...(headed ? [] : ['--headless=new']), '--use-angle=d3d11', '--enable-gpu',
  '--ignore-gpu-blocklist', ...(browserGpu ? [] : ['--force_high_performance_gpu']), '--allow-file-access-from-files', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, '--user-data-dir=' + process.env.TEMP + '/edge-fps-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; };

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'file:///' + root.replace(/\\/g, '/') + '/dist/echolocation.html' });
for (let i = 0; i < 600 && !(await ev('!!window.SR_READY && document.getElementById("over").classList.contains("ready")')); i++) await sleep(100);
const info = await ev(`(() => { const gl = document.getElementById('view').getContext('webgl2'), x = gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), canvas: gl.canvas.width + 'x' + gl.canvas.height,
    dur: SR.music.dur, scenes: SR.SCENES.map(s => [s.a, s.b, s.name]) }; })()`);
console.log(`GPU: ${info.gpu}\ncanvas: ${info.canvas} (window ${W}x${H}, ${headed ? 'headed' : 'headless'} Edge)\n`);
const sceneOf = t => info.scenes.findIndex(([a, b]) => t >= a && t < b) < 0 ? info.scenes.length - 1 : info.scenes.findIndex(([a, b]) => t >= a && t < b);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const tag = `${W}x${H}-${/NVIDIA|AMD Radeon RX|Radeon\(TM\) RX/i.test(info.gpu) ? 'dgpu' : 'igpu'}`;

// ---- 1. scan
const scan = [];
for (let t0 = 0; t0 < info.dur; t0 += 25) {
  const part = await ev(`(() => { const gl = document.getElementById('view').getContext('webgl2'), px = new Uint8Array(4), out = [];
    for (let t = ${t0}; t < Math.min(${t0 + 25}, SR.music.dur); t += 2.5) {
      renderAt(t); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);          // warm up, wait for the GPU
      const s = performance.now();
      for (let k = 1; k <= 6; k++) renderAt(t + k / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push([t, (performance.now() - s) / 6]);
    }
    return out; })()`);
  scan.push(...part);
  process.stdout.write(`\rscan ${Math.min(t0 + 25, info.dur).toFixed(0)} / ${info.dur} s`);
}
console.log('');
fs.writeFileSync(path.join(root, 'dist', `fps-${tag}-scan.csv`), 't_s,frame_ms,max_fps\n' + scan.map(([t, ms]) => `${t},${ms.toFixed(2)},${(1000 / ms).toFixed(1)}`).join('\n') + '\n');
console.log('\nrender cost per scene (one frame incl. GPU; max fps = 1000 / ms):');
console.log('scene                         ms median  ms worst   max fps (worst)');
info.scenes.forEach(([a, b, name], i) => {
  const ms = scan.filter(([t]) => sceneOf(t) === i).map(r => r[1]);
  if (!ms.length) return;
  const med = pct(ms, 0.5), worst = Math.max(...ms);
  console.log(`${(i + 1 + ' ' + name).padEnd(30)}${med.toFixed(1).padStart(9)}${worst.toFixed(1).padStart(10)}${(1000 / worst).toFixed(0).padStart(12)}`);
});
const worstScan = scan.reduce((m, r) => (r[1] > m[1] ? r : m));
console.log(`heaviest moment: ${worstScan[0]} s, ${worstScan[1].toFixed(1)} ms (${(1000 / worstScan[1]).toFixed(0)} fps at most)`);

// ---- 2. play in real time
if (!scanOnly) {
  await ev(`(() => { const a = document.getElementById('audio'); a.currentTime = 0; window.FR = []; window.FR_DONE = false;
    const f = now => { FR.push([now, a.currentTime]); if (!a.ended) requestAnimationFrame(f); else FR_DONE = true; }; requestAnimationFrame(f);
    return 1; })()`);
  const st = await ev(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: st[0], y: st[1], button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: st[0], y: st[1], button: 'left', buttons: 0, clickCount: 1 });
  const began = Date.now(), stalls = [];
  let lastN = 0, lastT = 0;
  while (!(await ev('FR_DONE'))) {
    await sleep(5000);
    const n = await ev('FR.length'), at = await ev('document.getElementById("audio").currentTime');
    if (n === lastN && at > lastT + 1) stalls.push([lastT, at]);   // the audio ran on, no frames were drawn
    lastN = n; lastT = at;
    process.stdout.write(`\rplaying ${at.toFixed(0)} / ${info.dur} s`);
    if (until && at >= until) break;
    if (Date.now() - began > (info.dur + 120) * 1000) { console.log('\nplayback did not finish in time'); break; }
  }
  console.log('');
  if (stalls.length) console.log(`WARNING: the browser stopped producing frames while the audio played (${stalls.map(([a, b]) => a.toFixed(0) + '-' + b.toFixed(0) + ' s').join(', ')}); seconds without frames are left out below`);
  const fr = await ev('FR');
  const secs = [];
  for (let k = 1; k < fr.length; k++) {
    const t = fr[k][1], s = Math.floor(t);
    if (fr[k][1] < fr[k - 1][1] - 0.5) continue;           // the click restarted the clock
    (secs[s] = secs[s] || []).push(fr[k][0] - fr[k - 1][0]);
  }
  // whole seconds only: the audio ends at the very end of the last one, so a final partial second would read as a drop
  const rows = secs.map((d, s) => d && s + 1 <= info.dur + 1e-6 && [s, d.length, Math.max(...d)]).filter(Boolean);
  fs.writeFileSync(path.join(root, 'dist', `fps-${tag}-play.csv`), 'second,frames,longest_frame_ms\n' + rows.map(r => `${r[0]},${r[1]},${r[2].toFixed(1)}`).join('\n') + '\n');
  console.log('\nreal-time playback per scene (frames shown per second of music):');
  console.log('scene                         fps median  fps lowest  longest frame ms');
  info.scenes.forEach(([a, b, name], i) => {
    const r = rows.filter(([s]) => sceneOf(s + 0.5) === i);
    if (!r.length) return;
    console.log(`${(i + 1 + ' ' + name).padEnd(30)}${String(pct(r.map(x => x[1]), 0.5)).padStart(10)}${String(Math.min(...r.map(x => x[1]))).padStart(12)}${Math.max(...r.map(x => x[2])).toFixed(0).padStart(18)}`);
  });
  const all = rows.map(r => r[1]);
  if (!all.length) console.log('no frames were recorded during playback: no real-time figure from this run (use the scan, or --headed)');
  else console.log(`whole piece: median ${pct(all, 0.5)} fps, lowest second ${Math.min(...all)} fps, ${all.filter(f => f >= 55).length} of ${all.length} seconds at 55 fps or more`);
}
ws.close(); edge.kill();
