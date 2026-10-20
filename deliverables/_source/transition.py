"""The scene transition of the demo video: a pen nib writes one cobalt stroke across the frame, the stroke swells until
the whole screen is cobalt ink, the Countersign nib shows for a beat, then the ink pulls away to the right and uncovers
the next scene. 0.9 s, 1920x1080 with alpha, laid over every cut between two shots (the cut sits in the full-ink frames).
Output: 03-demo-video/cut/_edit/transition.mov (PNG in MOV, keeps the alpha)
Run: python3 transition.py
"""
import math
import random
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "03-demo-video" / "cut" / "_edit"
FR = OUT / "_transition"
FR.mkdir(parents=True, exist_ok=True)
W, H = 1920, 1080
COBALT, CREAM, NAVY = (37, 71, 201), (244, 240, 229), (27, 43, 107)
COVER, HOLD, REVEAL = 12, 4, 11          # frames at 30 fps: 0.4 s writing, 0.13 s full ink, 0.37 s reveal
CUT_AT = COVER + HOLD // 2               # the frame where the cut between the two shots falls
random.seed(7)


def ease(a):
    return a * a * (3 - 2 * a)


def path(x):
    """The handwriting line: a slow wave, slightly rising, like a signature."""
    return H * 0.56 - 0.06 * (x - W / 2) * 0.35 + 70 * math.sin(x / 260) + 26 * math.sin(x / 83)


def ragged(points, jitter):
    return [(x + random.uniform(-jitter, jitter), y + random.uniform(-jitter, jitter)) for x, y in points]


def nib(d, x, y, s, angle):
    """A fountain-pen nib pointing down-left at the writing point, cream with a navy slit."""
    ca, sa = math.cos(angle), math.sin(angle)

    def p(u, v):
        return (x + (u * ca - v * sa) * s, y + (u * sa + v * ca) * s)
    body = [p(0, 0), p(0.55, -1.0), p(0.62, -2.1), p(-0.62, -2.1), p(-0.55, -1.0)]
    d.polygon(body, fill=(*CREAM, 255), outline=(*NAVY, 255))
    d.line([p(0, -0.05), p(0, -1.25)], fill=(*NAVY, 255), width=max(2, int(s * 0.06)))
    d.ellipse([p(-0.11, -1.36)[0] - s * 0.11, p(0, -1.36)[1] - s * 0.11, p(0, -1.36)[0] + s * 0.11, p(0, -1.36)[1] + s * 0.11],
              outline=(*NAVY, 255), width=max(2, int(s * 0.05)))


def brand(d, cx, cy, s, alpha):
    """The Countersign nib, drawn in cream on the ink: three strokes and the signature line."""
    c = (*CREAM, alpha)
    w = max(3, int(s * 0.05))
    d.line([(cx, cy + s * 0.55), (cx - s * 0.32, cy - s * 0.15), (cx - s * 0.18, cy - s * 0.55)], fill=c, width=w, joint="curve")
    d.line([(cx, cy + s * 0.55), (cx + s * 0.32, cy - s * 0.15), (cx + s * 0.18, cy - s * 0.55)], fill=c, width=w, joint="curve")
    d.line([(cx, cy + s * 0.5), (cx, cy - s * 0.05)], fill=c, width=w)
    d.ellipse([cx - s * 0.07, cy - s * 0.17, cx + s * 0.07, cy - s * 0.03], outline=c, width=w)
    pts = [(cx - s * 0.9 + k * s * 0.06, cy + s * 0.78 + math.sin(k / 3) * s * 0.05) for k in range(31)]
    d.line(pts, fill=c, width=w, joint="curve")


def frame(i):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if i < COVER:
        a = ease((i + 1) / COVER)
        head = -120 + a * (W + 360)
        width = 70 + (H * 1.45) * a ** 2.2
        xs = list(range(-160, int(head), 18)) + [head]
        pts = ragged([(x, path(x)) for x in xs], 2.5)
        d.line(pts, fill=(*COBALT, 255), width=int(width), joint="curve")
        for x, y in pts[::3]:                              # the ink's round edge, so the stroke reads as a brush
            r = width / 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=(*COBALT, 255))
        if head < W + 40:
            ang = math.atan2(path(head + 5) - path(head - 5), 10) - math.pi * 0.72
            nib(d, head, path(head), 64 + 50 * a, ang)
    elif i < COVER + HOLD:
        d.rectangle([0, 0, W, H], fill=(*COBALT, 255))
        k = (i - COVER + 1) / HOLD
        brand(d, W / 2, H / 2 - 30, 230, int(255 * min(1, k * 1.6)))
    else:
        a = ease((i - COVER - HOLD + 1) / REVEAL)
        edge = -80 + a * (W + 260)                          # the ink pulls away to the right with a wavy edge
        poly = [(edge + 40 * math.sin(y / 70 + 1.3) + 18 * math.sin(y / 23), y) for y in range(-20, H + 40, 20)]
        d.polygon(poly + [(W + 50, H + 40), (W + 50, -20)], fill=(*COBALT, 255))
        if a < 0.5:
            brand(d, W / 2, H / 2 - 30, 230, int(255 * (1 - a * 2)))
    return img.filter(ImageFilter.GaussianBlur(0.6))


def main():
    for i in range(COVER + HOLD + REVEAL):
        frame(i).save(FR / f"{i:03d}.png")
    dst = OUT / "transition.mov"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", str(FR / "%03d.png"),
                    "-c:v", "png", "-pix_fmt", "rgba", str(dst)], check=True)
    print(dst, "frames", COVER + HOLD + REVEAL, "cut at frame", CUT_AT)


if __name__ == "__main__":
    main()
