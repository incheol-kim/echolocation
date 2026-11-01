// Video export (design doc 9.2): 4K 60 fps rendered directly, 1080p made from the same frames (downscaled), so both
// have the same composition. Every frame is renderFrame(t): SUB sub-frames over a 180-degree shutter with sub-pixel
// jitter, accumulated in half float and tone-mapped once; the HUD and the end card come from the page itself (screenshot).
// Frames are never stored on disk: they stream into ffmpeg, which writes both resolutions per chunk. Chunks make the
// job resumable (finished chunks are kept and skipped) and let several workers (each its own browser + ffmpeg) render
// different chunks at once; the frames are the same whatever the number of workers. At the end the chunks are joined
// and the original WAV is added (AAC 384 kbps, 48 kHz, no resampling or level change), padded with silence for the
// end card.
//
// Usage: node tools/export_video.mjs [--from=S] [--to=S] [--sub=16] [--chunk=30] [--workers=5] [--out=video]
//                                    [--name=Echolocation] [--crf4k=14] [--crf1080=14]
//   default: the whole video, 0 s to the end of the end card. Writes <out>/<name>_4K.mp4 and <out>/<name>_1080p.mp4,
//   chunks in <out>/chunks-<name>/, a log in <out>/<name>.log.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
// ffmpeg and the original WAV are not in the repository: tools/ffmpeg/bin/ffmpeg.exe and media/echolocation.wav by default,
// or ECHO_FFMPEG / ECHO_WAV
const FFMPEG = process.env.ECHO_FFMPEG || path.join(root, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
const WAV = process.env.ECHO_WAV || path.join(root, 'media', 'echolocation.wav');
const W = 3840, H = 2160, FPS = 60, SUB = +arg('sub', 16), CHUNK = +arg('chunk', 30), WORKERS = +arg('workers', 5), NAME = arg('name', 'Echolocation');
const OUT = path.resolve(root, arg('out', 'video')), CH = path.join(OUT, `chunks-${NAME}`);
const CRF4K = arg('crf4k', '14'), CRF1080 = arg('crf1080', '14');
for (const f of [FFMPEG, WAV]) if (!fs.existsSync(f)) throw new Error('missing: ' + f);
fs.mkdirSync(CH, { recursive: true });
const logFile = path.join(OUT, `${NAME}.log`);
const log = s => { const line = `${new Date().toISOString().slice(0, 19)} ${s}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// keep Windows awake and the display on while rendering (released when this process ends): with the display off,
// Windows may treat the hidden browser window as occluded and stop its frames
const awake = spawn('powershell', ['-NoProfile', '-Command', `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; [W.P]::SetThreadExecutionState(2147483651) | Out-Null; while ($true) { Start-Sleep 60 }`], { stdio: 'ignore' });
const children = new Set([awake]);
const cleanup = () => { for (const p of children) try { p.kill(); } catch {} };
const fail = e => { log('FAILED: ' + (e && e.stack || e)); cleanup(); process.exit(1); };
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
process.on('SIGINT', () => fail(new Error('interrupted')));

// A headless Edge session on the high-performance GPU with the piece loaded in still/export mode at 4K.
async function openBrowser() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
    `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, '--user-data-dir=' + process.env.TEMP + '/edge-export-' + port, 'about:blank'], { stdio: 'ignore' });
  children.add(edge);
  let targets;
  for (let i = 0; i < 150 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  if (!targets) throw new Error('browser did not start');
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  // every call has a time limit, so a stalled browser is noticed instead of hanging the job
  const send = (method, params = {}, ms = 120000) => Promise.race([
    new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then(m => { if (m.error) throw new Error(method + ': ' + m.error.message); return m.result; }),
    sleep(ms).then(() => { throw new Error(`${method} took longer than ${ms / 1000} s`); })]);
  const ev = async (expr, ms) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Page.enable').catch(() => {});
  await send('Page.navigate', { url: `file:///${root.replace(/\\/g, '/')}/dist/echolocation.html?w=${W}&h=${H}#t=0` });
  let ready = false;
  for (let i = 0; i < 1200 && !ready; i++) { ready = await ev('!!window.SR_READY && typeof renderFrame === "function"').catch(() => false); if (!ready) await sleep(100); }
  if (!ready) throw new Error('page did not get ready');
  await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }, 60000);   // first frame out of the way
  const close = () => { try { ws.close(); } catch {} try { edge.kill(); } catch {} children.delete(edge); };
  return { edge, send, ev, close };
}

const probe = await openBrowser();
const info = await probe.ev(`(() => { const gl = document.getElementById('view').getContext('webgl2'), x = gl.getExtension('WEBGL_debug_renderer_info');
  return { dur: SR.music.dur, tail: SR.VIDEO_TAIL, gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '', canvas: gl.canvas.width + 'x' + gl.canvas.height }; })()`);
probe.close();
if (info.canvas !== `${W}x${H}`) fail(new Error('canvas is ' + info.canvas));
const TOTAL = info.dur + info.tail, FROM = +arg('from', 0), TO = Math.min(+arg('to', TOTAL), TOTAL);
const F0 = Math.round(FROM * FPS), F1 = Math.round(TO * FPS), PER = Math.round(CHUNK * FPS);
log(`export ${NAME}: ${FROM}-${TO} s (${F1 - F0} frames at ${FPS} fps), ${SUB} sub-frames, chunks of ${CHUNK} s, ${WORKERS} workers | GPU ${info.gpu} | canvas ${info.canvas}`);

const enc = (crf, level) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-profile:v', 'high', '-level:v', level, '-g', '30', '-bf', '2',
  '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709'];   // BT.709 in the stream itself, so every player reads the colours right
const chunks = [];
for (let c0 = F0; c0 < F1; c0 += PER) {
  const c1 = Math.min(c0 + PER, F1), tag = `${String(c0).padStart(5, '0')}-${String(c1 - 1).padStart(5, '0')}`;
  const out4 = path.join(CH, `4k_${tag}.mp4`), out1 = path.join(CH, `1080_${tag}.mp4`);
  if (fs.existsSync(out4) && fs.existsSync(out1)) log(`chunk ${tag}: already done, skipped`);
  else chunks.push({ c0, c1, tag, out4, out1 });
}
const todo = chunks.reduce((n, c) => n + c.c1 - c.c0, 0), began = Date.now();
let done = 0, relaunches = 0, stalls = 0;
const recent = [];   // [time, frames done] over the last minute: the current rate, not the average since the start
const progress = setInterval(() => {
  const now = Date.now(); recent.push([now, done]); while (recent.length > 1 && now - recent[0][0] > 60000) recent.shift();
  const [t0, d0] = recent[0], rate = (done - d0) / Math.max((now - t0) / 1000, 1), avg = done / Math.max((now - began) / 1000, 1);
  process.stdout.write(`\r${done} / ${todo} frames · now ${rate.toFixed(2)} frames/s (average ${avg.toFixed(2)}) · ETA ${((todo - done) / Math.max(rate || avg, 1e-6) / 3600).toFixed(2)} h · stalls ${stalls} · restarts ${relaunches}   `);
}, 10000);

async function worker(w) {
  let B = null;
  const lastFrames = [];   // per frame: did it stall? a browser that keeps stalling is replaced at once
  // one frame as PNG bytes; on a stall: nudge (re-apply the viewport, which forces a fresh frame), retry, and after
  // three misses start a fresh browser session. A browser that stalled on 4 of its last 10 frames is replaced first
  // (one worker's browser once stalled on nearly every frame, ~5 s each, while the others ran normally).
  async function capture(t) {
    if (lastFrames.length >= 10 && lastFrames.filter(Boolean).length >= 4) {
      log(`  worker ${w}: ${lastFrames.filter(Boolean).length} of its last ${lastFrames.length} frames stalled, restarting the browser`);
      B.close(); relaunches++; lastFrames.length = 0;
      B = await openBrowser();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await B.ev(`renderFrame(${t}, ${SUB}, ${FPS})`, 60000);
        const shot = await B.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }, attempt === 0 ? 5000 : 30000);
        lastFrames.push(attempt > 0); if (lastFrames.length > 10) lastFrames.shift();
        return Buffer.from(shot.data, 'base64');
      } catch (e) {
        stalls++;
        if (attempt > 0) log(`  worker ${w}, frame t=${t.toFixed(4)}: ${e.message} (attempt ${attempt + 1})`);
        if (attempt >= 5) throw e;
        if (attempt < 3) { await B.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, 10000).catch(() => {}); continue; }
        B.close(); relaunches++;
        log(`  worker ${w}: restarting the browser (${relaunches} so far)`);
        B = await openBrowser();
      }
    }
  }
  B = await openBrowser();
  for (let c; (c = chunks.shift());) {
    const part4 = c.out4 + '.part.mp4', part1 = c.out1 + '.part.mp4';
    const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-filter_complex', '[0:v]split=2[a][b];' +
        '[a]scale=flags=accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p[v4];' +
        '[b]scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p[v1]',
      '-map', '[v4]', ...enc(CRF4K, '5.2'), part4,
      '-map', '[v1]', ...enc(CRF1080, '4.2'), part1], { stdio: ['pipe', 'ignore', 'pipe'] });
    children.add(ff);
    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d; });
    const ffDone = new Promise(r => ff.on('close', code => r(code)));
    const t0 = Date.now();
    log(`worker ${w}: chunk ${c.tag} started`);
    for (let k = c.c0; k < c.c1; k++) {
      const png = await capture(k / FPS);
      if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
      done++;
    }
    ff.stdin.end();
    const code = await ffDone;
    children.delete(ff);
    if (code !== 0) throw new Error(`ffmpeg exit ${code}: ${ffErr.slice(0, 600)}`);
    fs.renameSync(part4, c.out4); fs.renameSync(part1, c.out1);
    const sec = (Date.now() - t0) / 1000;
    log(`worker ${w}: chunk ${c.tag} done in ${(sec / 60).toFixed(1)} min (${(sec / (c.c1 - c.c0)).toFixed(2)} s/frame)`);
  }
  B.close();
}
await Promise.all(Array.from({ length: Math.min(WORKERS, chunks.length) }, (_, w) => worker(w + 1)));
clearInterval(progress);
console.log('');

// join the chunks and add the audio
const DUR = (F1 - F0) / FPS;
for (const [res, label] of [['4k', '4K'], ['1080', '1080p']]) {
  const list = path.join(CH, `list_${res}.txt`);
  const files = fs.readdirSync(CH).filter(f => f.startsWith(res + '_') && f.endsWith('.mp4') && !f.includes('.part'))
    .filter(f => { const [a, b] = f.slice(res.length + 1, -4).split('-').map(Number); return a >= F0 && b < F1; }).sort();
  const have = files.reduce((n, f) => { const [a, b] = f.slice(res.length + 1, -4).split('-').map(Number); return n + b - a + 1; }, 0);
  if (have !== F1 - F0) fail(new Error(`${label}: chunks cover ${have} of ${F1 - F0} frames`));
  fs.writeFileSync(list, files.map(f => `file '${path.join(CH, f).replace(/\\/g, '/')}'`).join('\n') + '\n');
  const out = path.join(OUT, `${NAME}_${label}.mp4`);
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-ss', String(FROM), '-i', WAV, '-filter_complex', `[1:a]apad=whole_dur=${DUR}[a]`,
    '-map', '0:v', '-map', '[a]', '-t', String(DUR), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (r.status !== 0) fail(new Error('mux ' + label + ': ' + r.stderr.slice(0, 600)));
  log(`wrote ${out} (${(fs.statSync(out).size / 1e9).toFixed(2)} GB)`);
}
log(`all done in ${((Date.now() - began) / 3600000).toFixed(2)} h (stalls ${stalls}, browser restarts ${relaunches})`);
cleanup();
process.exit(0);
