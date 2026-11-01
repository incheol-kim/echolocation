# Echolocation — Solo Piano Improvisation

A point-cloud visual piece for a 5:55 improvised piano solo by **[Incheol Kim](https://linktr.ee/incheol)**.

A researcher stands alone on an alien world. Every note she hears goes out as a sonar pulse, and what it touches comes
back as points of light: the sand at her feet, a broken stele with a worn handprint, the ruins of a city buried under
a mound. Time drifts back and the city stands again; giant whale-like beings pass overhead, come close, and leave.

**Watch it**

- Web version (WebGL2, plays with the music): https://incheol-kim.github.io/echolocation/
- YouTube version: https://youtu.be/EkHneGfLjFU

The whole picture is generated in the browser from code and from timing data of the performance; nothing in it is
pre-rendered.

## Controls

| Input | Action |
|---|---|
| Tap / click, or Space | Play / pause |
| Double-tap the left / right third, or ← / → | 5 s back / forward (keep tapping to add 5 s) |
| Drag the bar on the pause screen | Jump |

Smooth playback needs a capable GPU. On laptops with two GPUs, browsers often run on the power-saving one: in Windows,
Settings → System → Display → Graphics, set your browser to *High performance*. `chrome://gpu` (or `edge://gpu`,
`whale://gpu`) shows which GPU is in use.

## Run locally

Open `dist/echolocation.html` in Chrome, Edge or another browser with WebGL2. `dist/echolocation.mp3` must sit next to
it. Opening the file directly (`file://`) works; no server is needed.

Page options:

- `dist/echolocation.html#t=125` — a still frame of second 125
- `?w=1920&h=1080` — render at a fixed size regardless of the window
- `?gen=1` — compute the researcher's points at load time instead of using the baked copy (slower, same picture)

## Build from source

Requirements: Python 3 and Node.js.

```
python tools/build.py      # src/ + data/ -> dist/echolocation.html (bakes the researcher's points with tools/bake.js)
node --test "test/*.test.js"
python -m unittest discover -s tools -p "test_*.py"
```

`data/music.json` holds the note onsets, velocities and loudness envelope of the performance. It was made from the
original MIDI and WAV with `tools/make_data.py`; those originals are not part of this repository (the tests that need
them are skipped). To rebuild it, put them at `media/echolocation.mid` and `media/echolocation.wav`, or set `ECHO_MIDI`
and `ECHO_WAV`. The build copies `media/echolocation.mp3` (or `ECHO_MP3`) into `dist/` when present and keeps the
existing `dist/echolocation.mp3` otherwise.

## Video export

`tools/export_video.mjs` renders the 4K / 1080p 60 fps video in headless Microsoft Edge (Windows): every frame is the
average of 16 sub-frames over a 180° shutter with sub-pixel jitter, streamed into ffmpeg together with the original WAV.
It needs ffmpeg (`tools/ffmpeg/bin/ffmpeg.exe` or `ECHO_FFMPEG`) and the WAV (`media/echolocation.wav` or `ECHO_WAV`),
neither of which is included. The rendered videos are published on YouTube, not here.

The `tools/check_*.mjs` scripts are browser checks used during development (headless Edge).

## Structure

```
src/template.html     page, HUD, controls
src/js/00-core.js     namespace, seeded random, matrices, splines
        10-music.js   performance data: notes, envelope
        20-gen.js     point generators: terrain, ruins, whales, researcher, sky, clouds, planet, rings
        30-gl.js      WebGL2 point renderer (additive splats into a half-float target, tone mapping)
        40-director.js  scenes, camera, timing of every event against the music
        50-app.js     stage, playback clock, controls, export frame rendering
data/music.json       timing data of the performance
dist/                 the built page and its mp3 (served by GitHub Pages through index.html)
test/                 unit tests (node --test)
tools/                build, bake, data, export and check scripts
```

## 한국어 요약

김인철(Incheol Kim)의 5분 55초 피아노 즉흥 연주에 맞춘 점구름(point cloud) 비주얼 아트입니다. 외계 행성의 연구원이
음 하나하나를 음파로 내보내고, 그 음파가 닿은 모래, 비석, 묻힌 도시, 거대한 고래 같은 생명체가 빛의 점으로 드러납니다.

- 웹 버전: `dist/echolocation.html`(같은 폴더에 `echolocation.mp3` 필요). GitHub Pages에서는 저장소 주소로 바로 열립니다.
- 조작: 탭이나 클릭 또는 스페이스로 재생 및 일시정지, 좌우 두 번 탭 또는 ←/→로 5초 이동, 일시정지 화면의 막대로 이동.
- 노트북에서는 Windows 그래픽 설정에서 브라우저를 '고성능' GPU로 지정하면 훨씬 매끄럽습니다.
- 빌드: `python tools/build.py`, 테스트: `node --test "test/*.test.js"`.

## Credits

Music: Incheol Kim — solo piano improvisation, *Echolocation*.

© 2026 Incheol Kim. All rights reserved.
