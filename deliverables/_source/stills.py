"""Clean stills from the demo recordings for the deck and the documents: the same views as the video, without the
subtitle or the badge. Output: deliverables/figures/stills/*.png
Run: python3 stills.py   (needs ffmpeg)
"""
import subprocess

from edit_demo import CLIPS, FILES, PAGE_TOP, PT, HERE, secs

OUT = HERE.parent / "figures" / "stills"
OUT.mkdir(parents=True, exist_ok=True)

# name: (recording, time, centre x, centre y, width) in viewport points; height is width * 9 / 16
STILLS = {
    "card-top": (2, "8:28", 1110, 360, 640),
    "card-bottom": (2, "8:50", 1000, 600, 760),
    "needs-signature": (2, "7:33", 260, 560, 620),
    "issuer-approved": (4, "3:05", 1100, 520, 800),
    "decision-panel": (4, "7:27", 1110, 610, 560),
    "agent-revoked": (4, "12:42", 650, 420, 560),
    "refused-chat": (4, "13:24", 260, 640, 640),
}
# from Claude's recordings of public pages
WEB = {"explorer-decision": ("W12", 2.0), "explorer-failed": ("W15", 1.0)}   # top of the page: the hash is visible

for name, (fi, t, cx, cy, w) in STILLS.items():
    h = w * 9 / 16
    x, y = max(cx - w / 2, 0) * PT, max(cy - h / 2, 0) * PT + PAGE_TOP
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(secs(t)), "-i", str(FILES[fi]), "-frames:v", "1",
                    "-vf", f"crop={int(w * PT)}:{int(h * PT)}:{int(x)}:{int(y)},scale=1920:-2:flags=lanczos", str(OUT / f"{name}.png")], check=True)
for name, (clip, t) in WEB.items():
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(t), "-i", str(CLIPS / f"{clip}.mp4"), "-frames:v", "1",
                    "-vf", "crop=1920:1010:0:0", str(OUT / f"{name}.png")], check=True)

# Tight crops for the deck (free aspect), in viewport points: (recording, time, left, top, right, bottom, patches).
# A patch hides the mouse pointer: (time, left, top, right, bottom) is copied from another frame of the same, unscrolled view.
TIGHT = {
    "card-full": (2, "8:25", 930, 243, 1364, 812, [("8:34", 1060, 290, 1180, 360)]),
    "card-risk": (2, "8:50", 930, 430, 1364, 790, [("8:57", 1138, 592, 1182, 634)]),
    "decision-tight": (4, "7:27", 930, 500, 1364, 806, []),
    "revoked-tight": (4, "12:42", 482, 287, 914, 521, []),
}


def frame(fi, t):
    from PIL import Image
    tmp = OUT / "_frame.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(secs(t)), "-i", str(FILES[fi]), "-frames:v", "1",
                    "-vf", f"crop=2232:1352:0:{PAGE_TOP}", str(tmp)], check=True)
    im = Image.open(tmp).convert("RGB")
    tmp.unlink()
    return im


for name, (fi, t, l, tp, r, b, patches) in TIGHT.items():
    im = frame(fi, t)
    for pt, pl, ptp, pr, pb in patches:
        box = tuple(int(v * PT) for v in (pl, ptp, pr, pb))
        im.paste(frame(fi, pt).crop(box), box[:2])
    im.crop(tuple(int(v * PT) for v in (l, tp, r, b))).save(OUT / f"{name}.png")

print("stills:", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))
