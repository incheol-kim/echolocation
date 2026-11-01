// End-to-end check in headless Edge of the playback controls that work without a keyboard (phones) as well as with one:
// the pause screen shows the instructions and a timeline; dragging the bar jumps without starting playback; a tap in the
// centre plays/pauses; a double tap on the right/left third seeks +/-5 s (further taps add up); a single side tap pauses;
// the arrow keys still seek; real touch input (emulated) behaves like the mouse.
// Usage: node tools/check_controls.mjs   (exit code 0 = pass)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 9450 + Math.floor(Math.random() * 300);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--use-angle=d3d11', '--enable-gpu',
  '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--mute-audio', `--remote-debugging-port=${port}`, '--window-size=1280,720',
  '--user-data-dir=' + process.env.TEMP + '/edge-ctl-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => Promise.race([new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), sleep(8000).then(() => ({ timeout: method }))]);
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });   // the stage fits the screen, as in use
await send('Page.navigate', { url: 'file:///' + root.replace(/\\/g, '/') + '/dist/echolocation.html' });
for (let i = 0; i < 300 && !(await ev('!!window.SR_READY && document.getElementById("over").classList.contains("ready")')); i++) await sleep(100);
for (let i = 0; i < 50 && (await ev('document.getElementById("audio").readyState')) < 1; i++) await sleep(100);

const state = () => ev(`(() => { const a = document.getElementById('audio'), o = document.getElementById('over');
  return { t: a.currentTime, paused: a.paused, over: !o.classList.contains('hide'), ctl: getComputedStyle(document.getElementById('ctl')).display,
    time: document.getElementById('time').textContent, hint: document.getElementById('hint').textContent, msg: document.getElementById('msg').textContent, fx: document.getElementById('seekfx').textContent }; })()`);
const rect = sel => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const mouse = async (type, x, y, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount });
const click = async (x, y, n = 1) => { await mouse('mousePressed', x, y, n); await mouse('mouseReleased', x, y, n); };
const touch = async (x, y) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const key = async code => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code }); };

let ok = true;
const check = (name, pass, detail) => { ok = ok && pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const st = await rect('#stage'), cx = st.x + st.w / 2, cy = st.y + st.h * 0.45, rx = st.x + st.w * 0.85, lx = st.x + st.w * 0.15;

let s = await state();
check('pause screen shows the instructions and the timeline', s.over && s.ctl === 'block' && /Double-tap/.test(s.hint) && /Space/.test(s.hint) && s.time === '0:00 / 5:55', `${s.ctl}, "${s.time}"`);
check('on first load the centre reads "Echolocation"', s.msg === 'Echolocation', `"${s.msg}"`);
await key('ArrowRight'); await sleep(300); s = await state();
check('moving from the first screen (arrow key) shows "Paused"', s.msg === 'Paused' && s.paused && Math.abs(s.t - 5) < 0.3, `"${s.msg}" t=${s.t.toFixed(2)}`);

const tr = await rect('#track'), ty = tr.y + tr.h / 2;
await mouse('mousePressed', tr.x + tr.w * 0.2, ty); await mouse('mouseMoved', tr.x + tr.w * 0.35, ty); await mouse('mouseMoved', tr.x + tr.w * 0.5, ty); await mouse('mouseReleased', tr.x + tr.w * 0.5, ty);
await sleep(300); s = await state();
const DUR = await ev('SR.music.dur');
check('dragging the bar to the middle jumps there and does not start playback', Math.abs(s.t - DUR / 2) < 2 && s.paused && s.over, `t=${s.t.toFixed(1)} "${s.time}" paused=${s.paused}`);

await click(cx, cy); await sleep(900); s = await state();
check('a tap in the centre plays', !s.paused && !s.over, `paused=${s.paused}`);

let t0 = (await state()).t;
await click(rx, cy, 1); await sleep(140); await click(rx, cy, 2); await sleep(350); s = await state();
check('a double tap on the right third seeks +5 s and keeps playing', s.t - t0 > 4.5 && s.t - t0 < 6.5 && !s.paused && /5 s/.test(s.fx), `+${(s.t - t0).toFixed(2)} s, "${s.fx}"`);
t0 = s.t; await click(rx, cy, 1); await sleep(250); s = await state();
check('a further tap within the streak adds 5 s more', s.t - t0 > 4.5 && s.t - t0 < 6.5 && /10 s/.test(s.fx) && !s.paused, `+${(s.t - t0).toFixed(2)} s, "${s.fx}"`);

await sleep(1200); await click(rx, cy, 1); await sleep(1000); s = await state();
check('a single tap on a side pauses (after a short wait)', s.paused && s.over, `paused=${s.paused}`);

t0 = s.t; await key('ArrowLeft'); await sleep(250); s = await state();
check('the left arrow key seeks -5 s', Math.abs(s.t - (t0 - 5)) < 0.3, `${t0.toFixed(1)} -> ${s.t.toFixed(1)}`);

// the ends: the shown seconds stop growing, and running into the end stays there (as the arrow key does)
const fxNum = fx => +(/(\d+)/.exec(fx) || [0, -1])[1];
const setAt = async t => { await ev(`(document.getElementById('audio').currentTime = ${t}, 1)`); await sleep(1600); };   // past the streak window
const ensure = async (playing, tapAt = cx) => {   // each step sets its own play state, with a real tap as a user would
  for (let k = 0; k < 3 && (await state()).paused === playing; k++) { await click(tapAt, cy); await sleep(1200); }
};
await ensure(false); await setAt(2.5);
for (let k = 0; k < 4; k++) { await key('ArrowLeft'); await sleep(120); }
s = await state();
check('arrow keys at the start: stay at 0:00 and show only the time moved', s.t < 0.3 && fxNum(s.fx) <= 3, `t=${s.t.toFixed(2)} "${s.fx}"`);
await setAt(DUR - 3);
for (let k = 0; k < 4; k++) { await key('ArrowRight'); await sleep(120); }
await sleep(400); s = await state();
check('arrow keys at the end: stay at the end and show only the time moved', s.t > DUR - 0.1 && fxNum(s.fx) <= 3, `t=${s.t.toFixed(2)} "${s.fx}"`);
await setAt(8); await ensure(true);                                     // playing again, near the start
await click(lx, cy, 1); await sleep(140); await click(lx, cy, 2); await sleep(250);
for (let k = 0; k < 3; k++) { await click(lx, cy, 1); await sleep(250); }
s = await state();
check('taps back past the start: stop at 0:00, the seconds stop growing', s.t < 2 && fxNum(s.fx) <= 10 && !s.paused, `t=${s.t.toFixed(2)} "${s.fx}" paused=${s.paused}`);
await setAt(DUR - 9); await ensure(true);
await click(rx, cy, 1); await sleep(140); await click(rx, cy, 2); await sleep(250);
for (let k = 0; k < 4; k++) { await click(rx, cy, 1); await sleep(250); }
await sleep(500); s = await state();
check('taps forward past the end: stop at the end (paused), never back to the start', s.t > DUR - 0.1 && s.paused && fxNum(s.fx) <= 10, `t=${s.t.toFixed(2)} "${s.fx}" paused=${s.paused}`);
check('at the end the centre reads "Echolocation"', s.msg === 'Echolocation', `"${s.msg}"`);
await sleep(900); await key('ArrowLeft'); await sleep(300); s = await state();
check('moving back from the end (arrow key) shows "Paused"', s.msg === 'Paused' && s.paused && s.t < DUR - 4, `"${s.msg}" t=${s.t.toFixed(2)}`);

// touch part in a light scene: CDP sends each touch only after the page has handled the last one, so in the heaviest
// scenes (~12 fps here) its two taps arrive too far apart; a real finger's lift time is stamped by the device
await ev(`(document.getElementById('audio').currentTime = 15, document.getElementById('seekfx').textContent = '', 1)`); await sleep(500);
await ensure(false); await ev(`(document.getElementById('audio').currentTime = 15, 1)`); await sleep(500);
// headless Edge: touch dispatch hangs if the last input was a key press; a mouse move first settles the input pipeline
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none', buttons: 0 }); await sleep(300);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await touch(cx, cy); await sleep(900); s = await state();
check('touch: a tap in the centre plays', !s.paused, `paused=${s.paused}`);
// the page records each lift time; if headless Edge delivered the two taps further apart than a double tap (0.28 s),
// the miss is the harness's, so try once more; a miss with the taps close together is a real failure
await ev(`(window.UPS = [], addEventListener('pointerup', e => UPS.push(e.timeStamp), true), 1)`);
let gap = 0;
for (let attempt = 0; attempt < 2; attempt++) {
  await ensure(true, cx); await sleep(800);
  await ev(`(UPS.length = 0, document.getElementById('seekfx').textContent = '', 1)`);
  t0 = (await state()).t; await touch(lx, cy); await sleep(140); await touch(lx, cy); await sleep(350); s = await state();
  const ups = await ev('UPS'); gap = ups.length >= 2 ? (ups[1] - ups[0]) / 1000 : 9;
  if (s.t - t0 < -3.5 || gap <= 0.28) break;
  console.log(`  (touch taps reached the page ${gap.toFixed(2)} s apart, slower than a double tap: retrying)`);
}
check('touch: a double tap on the left third seeks -5 s and keeps playing', s.t - t0 < -3.5 && s.t - t0 > -5 && !s.paused, `${(s.t - t0).toFixed(2)} s, "${s.fx}", taps ${gap.toFixed(2)} s apart`);
await ev(`(document.getElementById('audio').currentTime = ${DUR - 6}, 1)`); await sleep(1600);
await touch(rx, cy); await sleep(140); await touch(rx, cy); await sleep(250);
for (let k = 0; k < 4; k++) { await touch(rx, cy); await sleep(250); }
await sleep(500); s = await state();
check('touch: taps forward past the end stop at the end, never back to the start', s.t > DUR - 0.1 && s.paused && fxNum(s.fx) <= 10, `t=${s.t.toFixed(2)} "${s.fx}" paused=${s.paused}`);

ws.close(); edge.kill();
process.exit(ok ? 0 : 1);
