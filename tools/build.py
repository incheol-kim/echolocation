"""Assemble dist/echolocation.html (+ mp3) from src/ and data/."""
import glob, os, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_tools import MP3   # media/echolocation.mp3 or ECHO_MP3; without it the mp3 already in dist/ is kept

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build():
    tpl = open(os.path.join(ROOT, "src", "template.html"), encoding="utf-8").read()
    data = open(os.path.join(ROOT, "data", "music.json"), encoding="utf-8").read()
    files = sorted(glob.glob(os.path.join(ROOT, "src", "js", "*.js")))
    code = "\n".join(f"// ===== {os.path.basename(f)} =====\n" + open(f, encoding="utf-8").read() for f in files)
    baked = subprocess.run(["node", os.path.join(ROOT, "tools", "bake.js")], capture_output=True, text=True, check=True, cwd=ROOT).stdout
    if "</script" in code or "</script" in data or "</script" in baked:
        raise ValueError("script terminator inside inlined code")
    html = (tpl.replace("/*DATA*/", "const SR_DATA = " + data + ";")
               .replace("/*BAKED*/", "const SR_BAKED = " + baked + ";" + chr(10))
               .replace("/*CODE*/", code))
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", "echolocation.html")
    open(out, "w", encoding="utf-8").write(html)
    old_html = os.path.join(ROOT, "dist", "survey-record.html")   # the earlier name of the page
    if os.path.exists(old_html):
        os.remove(old_html)
    mp3 = os.path.join(ROOT, "dist", "echolocation.mp3")
    # copy only when the mixdown is newer than the copy: tags and artwork edited in dist/ (user 2026-11-01) are kept,
    # a new mixdown replaces it
    if os.path.exists(MP3):
        if not os.path.exists(mp3) or os.path.getmtime(MP3) > os.path.getmtime(mp3):
            shutil.copy2(MP3, mp3)
    elif not os.path.exists(mp3):
        raise SystemExit("no mp3: put it at media/echolocation.mp3 (or set ECHO_MP3)")
    old = os.path.join(ROOT, "dist", "survey-record.mp3")   # the earlier name of the same file
    if os.path.exists(old):
        os.remove(old)
    return out


if __name__ == "__main__":
    p = build()
    print(p, os.path.getsize(p), "bytes")
