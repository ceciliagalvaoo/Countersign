"""Turns the orange mouse pointer of the screen recordings blue (cobalt), frame by frame, in a rendered part.
The pointer is found as the densest cluster of bright, saturated orange; only a window around it is recoloured, so the
app's own vermilion and ochre (darker) stay as they are. The badge corner is left alone.
Use: python3 recolor_cursor.py part.mp4   (rewrites the file in place)
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

W, H, R = 1920, 1080, 110           # frame size and half-size of the window around the pointer
COBALT_HUE = 227.0                  # #2547C9


def hsv(a):
    mx, mn = a.max(-1), a.min(-1)
    d = mx - mn + 1e-6
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, d / (mx + 1e-6), mx


def rgb(h, s, v):
    c = v * s
    hp = (h / 60) % 6
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(h)
    conds = [(hp < 1), (hp < 2), (hp < 3), (hp < 4), (hp < 5), (hp >= 5)]
    rs = [c, x, z, z, x, c]
    gs = [x, c, c, x, z, z]
    bs = [z, z, x, c, c, x]
    r = np.select(conds, rs); g = np.select(conds, gs); b = np.select(conds, bs)
    m = v - c
    return np.stack([r + m, g + m, b + m], -1)


def fix(frame):
    small = frame[::4, ::4].astype(np.float32) / 255
    h, s, v = hsv(small)
    hot = (h > 11) & (h < 26) & (s > 0.5) & (v > 0.8)
    hot[: 160 // 4, : 700 // 4] = False                     # the badge
    ys, xs = np.nonzero(hot)
    if len(xs) < 3:
        return frame
    my, mx_ = np.median(ys), np.median(xs)
    near = (np.abs(ys - my) < 14) & (np.abs(xs - mx_) < 14)
    ys, xs = ys[near], xs[near]
    # the pointer is a small, compact cluster with a pure white body; a red button is wider and has no white core
    if len(xs) < 3 or xs.max() - xs.min() > 18 or ys.max() - ys.min() > 22:
        return frame
    cy, cx = int(np.median(ys)) * 4, int(np.median(xs)) * 4
    y0, y1, x0, x1 = max(cy - R, 0), min(cy + R, H), max(cx - R, 0), min(cx + R, W)
    win = frame[y0:y1, x0:x1].astype(np.float32) / 255
    h, s, v = hsv(win)
    warm = ((h < 34) | (h > 350)) & (s > 0.07)
    if not warm.any():
        return frame
    new = rgb(np.full_like(h, COBALT_HUE), np.minimum(s * 1.05, 1), v * np.where(s > 0.4, 0.95, 1.0))
    win[warm] = new[warm]
    out = frame.copy()
    out[y0:y1, x0:x1] = (win * 255 + 0.5).clip(0, 255).astype(np.uint8)
    return out


def main(path):
    src = Path(path)
    tmp = src.with_name(src.stem + "-blue.mp4")
    dec = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", "30", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
                            str(tmp)], stdin=subprocess.PIPE)
    n = W * H * 3
    while True:
        buf = dec.stdout.read(n)
        if len(buf) < n:
            break
        enc.stdin.write(fix(np.frombuffer(buf, np.uint8).reshape(H, W, 3)).tobytes())
    enc.stdin.close(); enc.wait(); dec.wait()
    tmp.replace(src)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
