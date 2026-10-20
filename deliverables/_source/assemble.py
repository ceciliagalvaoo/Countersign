"""Assembles the demo video from the shot list: Claude's clips (03-demo-video/clips) and Pablo's recordings
(03-demo-video/raw/U*.mov|mp4). A missing recording becomes a cream card that says what to record, so the cut can
be reviewed before every take exists. Narration lines are burned in as English subtitles; if raw/narration.m4a
exists it is laid under the picture. Output: 03-demo-video/cut/InternationalAI-Countersign-DemoVideo.mp4
Run: python3 assemble.py   (needs ffmpeg and Pillow)
"""
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
VID = HERE.parent / "03-demo-video"
CLIPS, RAW, CUT = VID / "clips", VID / "raw", VID / "cut"
TMP = CUT / "_parts"
TMP.mkdir(parents=True, exist_ok=True)

ROWS = [r for r in (VID / "SHOT-LIST.md").read_text().splitlines() if re.match(r"^\| \d{2} \|", r)]

# Which clip covers each shot (P and W shots are Claude's; U shots are Pablo's files)
CLAUDE = {"01": ["P01"], "02": ["P02"], "03": ["P03"], "04": ["P04"], "05": ["P05"], "06": ["P06"],
          "12": ["W12", "P12"], "15": ["P15", "W15"], "18": ["P18a", "P18b"], "19": ["P19"], "20": ["W20"], "21": ["P21"]}

FONT = "/System/Library/Fonts/Supplemental/Georgia.ttf"


def run(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(p):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)])
    return float(out)


def subtitle_png(text, dst):
    """The English subtitle as a transparent overlay: navy text on a cream band at the foot of the frame."""
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 31)
    words, line, lines = text.split(), "", []
    for w in words:
        if d.textlength(line + " " + w, font=font) > 1500:
            lines.append(line); line = w
        else:
            line = (line + " " + w).strip()
    lines.append(line)
    lh = 42
    top = 1080 - 60 - lh * len(lines)
    width = max(d.textlength(l, font=font) for l in lines)
    d.rounded_rectangle((960 - width / 2 - 28, top - 16, 960 + width / 2 + 28, 1080 - 44), radius=10, fill=(244, 240, 229, 232))
    for i, l in enumerate(lines):
        d.text((960, top + i * lh + lh / 2), l, font=font, fill=(27, 43, 107, 255), anchor="mm")
    img.save(dst)


def normalise(src, dst, sub=None):
    """Same size, frame rate and codec for every part, no audio (the narration is laid on top), subtitle burned in."""
    base = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF4F0E5,fps=30"
    if sub:
        run("ffmpeg", "-y", "-i", str(src), "-i", str(sub), "-an", "-filter_complex", f"[0:v]{base}[v];[v][1:v]overlay=0:0",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(dst))
    else:
        run("ffmpeg", "-y", "-i", str(src), "-an", "-vf", base, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(dst))


def placeholder(num, fname, what, dst, secs=6):
    img = Image.new("RGB", (1920, 1080), (244, 240, 229))
    d = ImageDraw.Draw(img)
    big, small = ImageFont.truetype(FONT, 64), ImageFont.truetype(FONT, 34)
    d.text((960, 400), f"Shot {num} · to record by Pablo", font=big, fill=(37, 71, 201), anchor="mm")
    d.text((960, 490), fname, font=small, fill=(27, 43, 107), anchor="mm")
    words, line, lines = what.split(), "", []
    for w in words:
        if len(line + " " + w) > 70:
            lines.append(line); line = w
        else:
            line = (line + " " + w).strip()
    lines.append(line)
    for i, l in enumerate(lines[:4]):
        d.text((960, 580 + i * 48), l, font=small, fill=(90, 103, 158), anchor="mm")
    png = dst.with_suffix(".png")
    img.save(png)
    run("ffmpeg", "-y", "-loop", "1", "-i", str(png), "-t", str(secs), "-vf", "fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dst))


def srt_time(t):
    h, m = int(t // 3600), int(t % 3600 // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"


parts, subs, t = [], [], 0.0
for row in ROWS:
    cells = [c.strip() for c in row.strip("|").split("|")]
    num, kind, fname, what, narration = cells[0], cells[2], cells[3].strip("`"), cells[4], cells[5].strip('"')
    segs = []
    if num in CLAUDE:
        segs = [CLIPS / f"{c}.mp4" for c in CLAUDE[num]]
    else:
        base = fname.replace("`", "").rsplit(".", 1)[0]
        found = [p for p in RAW.glob(base + ".*") if p.suffix.lower() in (".mov", ".mp4", ".m4v", ".webm")]
        if found:
            segs = [found[0]]
        else:
            ph = TMP / f"{num}-placeholder.mp4"
            placeholder(num, fname, re.sub(r"\*\*", "", what), ph)
            segs = [ph]
    start = t
    sub = TMP / f"{num}-sub.png"
    subtitle_png(narration, sub)
    for i, s in enumerate(segs):
        dst = TMP / f"{num}-{i}.mp4"
        normalise(s, dst, sub)
        parts.append(dst)
        t += duration(dst)
    subs.append((start, t, narration))

(TMP / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
silent = TMP / "silent.mp4"
run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(TMP / "list.txt"), "-c", "copy", str(silent))

srt = CUT / "InternationalAI-Countersign-DemoVideo.en.srt"
srt.write_text("".join(f"{i + 1}\n{srt_time(a)} --> {srt_time(b - 0.05)}\n{txt}\n\n" for i, (a, b, txt) in enumerate(subs)))

out = CUT / "InternationalAI-Countersign-DemoVideo.mp4"
narration = next(iter(RAW.glob("narration.*")), None)
if narration:
    run("ffmpeg", "-y", "-i", str(silent), "-i", str(narration), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", str(out))
else:
    run("ffmpeg", "-y", "-i", str(silent), "-c", "copy", str(out))
total = duration(out)
print(f"cut: {out.name}  {total:.1f}s  ({len(parts)} parts; subtitles {srt.name})")
if total > 300:
    print(f"WARNING: {total - 300:.1f}s over the 5:00 limit of the call")
