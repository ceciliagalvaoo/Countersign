"""Edits the screen recordings into the demo video: cuts, smooth zooms on what matters, a badge that names whose
screen is showing (investor, fund manager, a wallet, the public ledger), the e-mail in the header blurred, and the
English subtitle of each shot burned in. Claude's pitch clips (03-demo-video/clips) are placed between the shots.

Recordings: the four QuickTime files of 20/10 (2232x1640, Retina), outside the repository (RAW below).
Coordinates of every zoom are in viewport points of the page (1395 x 845), the same as the browser screenshots.
Output: 03-demo-video/cut/InternationalAI-Countersign-DemoVideo.mp4 and its .srt
Run: python3 edit_demo.py [--preview]   (needs ffmpeg and Pillow)
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
VID = HERE.parent / "03-demo-video"
CLIPS, CUT = VID / "clips", VID / "cut"
TMP = CUT / "_edit"
TMP.mkdir(parents=True, exist_ok=True)
RAW = Path("/Users/pabloazevedo/projects-wild/CounterSign/videos claude")
FILES = {
    2: RAW / "Gravação de Tela 2026-10-20 às 10.50.55.mov",
    3: RAW / "Gravação de Tela 2026-10-20 às 13.16.55.mov",
    4: RAW / "Gravação de Tela 2026-10-20 às 13.29.05.mov",
}
PREVIEW = "--preview" in sys.argv

SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
SANS = "/System/Library/Fonts/Avenir Next.ttc"
CREAM, CREAM_DEEP, NAVY, COBALT, SOFT, OCHRE, VERMILION = (
    (244, 240, 229), (235, 229, 214), (27, 43, 107), (37, 71, 201), (90, 103, 158), (160, 106, 18), (192, 57, 27))

PT = 1.6            # recording pixels per viewport point
PAGE_TOP = 288      # recording pixels above the page (tabs, address bar, the debugging bar)
PAGE_W, PAGE_H = 1395, 845
FULL = (697, 422, 1502)

# Badges: whose screen this is
BADGES = {
    "investor": ("INVESTOR VIEW", "her screen, a test investor account", COBALT, "person"),
    "manager": ("FUND MANAGER VIEW", "the fund's issuer, another account", OCHRE, "stamp"),
    "her-wallet": ("HER WALLET", "Freighter, Portuguese locale: only she can sign", NAVY, "key"),
    "issuer-wallet": ("ISSUER WALLET", "Freighter, Portuguese locale: the issuer signs", NAVY, "key"),
    "ledger": ("PUBLIC LEDGER", "stellar.expert, Stellar testnet", COBALT, "chain"),
    "docs": ("DOCUMENTATION", "the same limitations in every document", SOFT, "page"),
    "suite": ("TEST SUITE", "from our recorded runs", SOFT, "page"),
    "validation": ("USER VALIDATION", "n = 2, moderated sessions, testnet", SOFT, "person"),
}

# Header e-mail, always blurred; investor e-mails in the manager's tables, blurred on those shots (recording pixels)
BLUR_HEADER = (1680, 14, 450, 70)
BLUR_TABLE = (100, 640, 660, 600)

# The video, shot by shot. U parts: (file, start, end, speed, badge, blur_table, keys)
# keys: list of (t, cx, cy, w) in output seconds and viewport points; between two keys the view eases.
SHOTS = [
    ("00", "Before her agent can buy anything new, she reads exactly what she signs.", [
        ("U", 2, "8:22", "8:34", 1.25, "investor", False, [(0, *FULL), (1.6, 1110, 330, 620), (4.0, 1110, 330, 620), (8.2, 1110, 600, 620)]),
    ]),
    ("01", "This is Countersign. A receivables fund buys payments that companies will receive later, and investors buy its units. Our agent buys those units for her.", [("C", "P01", None, None, 3.0)]),
    ("02", "This competition's banking brief puts investment subscription in the red tier. The hard part for an agent is not talking about an investment. It is buying one.", [("C", "P02", 10.2)]),
    ("03", "Our composite persona, built from public data and not validated by interviews, keeps savings in USDC. She gives up at one screen: the confirmation of her first purchase.", [("C", "P03", 10.5)]),
    ("04", "Agents have already lost money through a chat, through an operator panel, and through a signing screen that showed one thing while the transaction did another.", [("C", "P04", 10.5)]),
    ("05", "So we built an investing agent that cannot buy a fund unit unless the investor's mandate, the fund's issuer and a wallet contract the agent cannot change agree.", [("C", "P05")]),
    ("06", "The agent's wallet is a contract on Stellar: it can only pay fund wallets the investor approved, within limits she signed, and it cannot change those limits. Nobody holds a fund unit unless the fund's issuer signs the mint.", [("C", "P06")]),
    ("07", "She states her goal in one sentence. The agent asks only what is missing and fills a typed mandate. Nothing is valid until she approves it.", [
        ("U", 2, "1:06", "1:17", 1.4, "investor", False, [(0, 330, 330, 820), (2.5, 330, 330, 820), (5.0, 670, 330, 760)]),
        ("U", 2, "1:45", "1:51", 1.0, "investor", False, [(0, 600, 380, 900), (2.0, 552, 402, 620)]),
    ]),
    ("08", "Her mandate wallet is our wallet contract on Stellar, not audited. She deploys it with her caps, signs it in her own wallet, and deposits test USDC.", [
        ("U", 2, "4:02", "4:13", 1.4, "investor", False, [(0, 1090, 420, 660), (2.0, 1090, 420, 660), (6.5, 1090, 620, 660)]),
        ("U", 2, "4:39", "4:41", 1.0, "her-wallet", False, [(0, 640, 220, 1100)]),
        ("U", 2, "4:50", "4:54", 1.0, "investor", False, [(0, 1020, 430, 760)]),
        ("U", 2, "5:48", "5:54", 1.2, "investor", False, [(0, 1090, 520, 660), (3.5, 1090, 640, 660)]),
    ]),
    ("09", "She asks for a purchase, then changes her mind. The plan is redone without starting over.", [
        ("U", 2, "6:52", "6:58", 1.0, "investor", False, [(0, 400, 600, 900), (2.5, 260, 690, 640)]),
        ("U", 2, "7:24", "7:40", 1.6, "investor", False, [(0, 260, 600, 620), (4.0, 260, 700, 620), (9.0, 260, 700, 620)]),
    ]),
    ("10", "A first purchase in a new fund waits for her signature, on a card decoded from the transaction bytes, not written by the model.", [
        ("U", 2, "8:48", "8:53", 1.0, "investor", False, [(0, 1080, 520, 760), (3.0, 1000, 660, 700)]),
        ("U", 2, "9:04", "9:06", 1.0, "her-wallet", False, [(0, 640, 220, 1100)]),
        ("U", 2, "9:48", "9:53", 1.0, "investor", False, [(0, 1040, 640, 760)]),
    ]),
    ("11", "The agent executes within the mandate she signed. Our policy approved it, and the hash of that decision travels with the payment.", [
        ("U", 3, "2:27", "2:31", 1.0, "investor", False, [(0, 400, 560, 900), (1.5, 240, 690, 620)]),
        ("U", 3, "3:08", "3:16", 1.0, "investor", False, [(0, 240, 600, 640), (5.0, 240, 660, 640)]),
    ]),
    ("12", "Anyone can open the transaction and see the decision on chain: the decision argument is the hash of log line twenty, the line of our log that approved this purchase.", [("C", "W12", None, "ledger"), ("C", "P12", 7.2)]),
    ("13", "Nobody holds a fund unit until the fund's issuer countersigns the mint. The fund manager approves the order and signs in her own wallet; the units are minted on chain, and the investor's screen shows the purchase completed.", [
        ("U", 4, "1:48", "1:58", 1.2, "manager", True, [(0, *FULL), (1.6, 1000, 520, 820), (5.0, 1150, 520, 600)]),
        ("U", 4, "2:57", "3:01", 1.4, "manager", True, [(0, 900, 600, 1000), (2.5, 1100, 520, 700)]),
        ("U", 4, "3:03.6", "3:07", 1.0, "manager", True, [(0, 1150, 520, 600)]),
        ("U", 4, "7:22", "7:30", 1.3, "investor", False, [(0, *FULL), (1.5, 1110, 610, 560)]),
    ]),
    ("14", "Recurring purchases are pre-authorised within her mandate, and she can interrupt them. The time trigger is simulated; the transactions are real.", [
        ("U", 4, "9:55", "10:00", 1.0, "investor", False, [(0, 700, 420, 800), (2.0, 600, 400, 620)]),
        ("U", 4, "10:18", "10:25", 1.2, "investor", False, [(0, 650, 440, 640)]),
    ]),
    ("15", "From our test suite: twelve adversarial cases, all blocked or recovered. Four were refused on chain by our wallet contract, even with the agent key in hand. A refused transaction stays on the ledger as FAILED, with its fee charged: that is our wallet contract saying no.", [("C", "P15", None, "suite"), ("C", "W15", None, "ledger")]),
    ("16", "The issuer can freeze the units. She can revoke the agent with one signature; our wallet contract on Stellar, not audited, then refuses its purchases: the next recurring purchase was refused before anything was built or signed.", [
        ("U", 4, "3:57", "4:01", 1.0, "manager", False, [(0, 700, 400, 1000)]),
        ("U", 4, "4:28", "4:33", 1.0, "manager", False, [(0, 800, 270, 900)]),
        ("U", 4, "11:13", "11:17", 1.0, "investor", False, [(0, 1110, 420, 640)]),
        ("U", 4, "11:21", "11:23", 1.0, "her-wallet", False, [(0, 640, 220, 1100)]),
        ("U", 4, "11:30", "11:33", 1.0, "investor", False, [(0, 1110, 560, 640)]),
        ("U", 4, "12:40", "12:45", 1.0, "investor", False, [(0, 650, 400, 720), (1.5, 650, 430, 520)]),
        ("U", 4, "13:22", "13:27", 1.0, "investor", False, [(0, 260, 640, 640)]),
    ]),
    ("17", "Two people tested it in moderated sessions on the testnet app. The investor finished all nine tasks on her own. Two sessions: exploratory, not statistics.", [("C", "PV", None, "validation")]),
    ("18", "Eleven of twelve scripted tasks completed, in about one turn each. Every hash has a task and a log line.", [("C", "P18a", None, "suite"), ("C", "P18b", None, "suite")]),
    ("19", "Not offered in Mainland China; no licence; simulated KYC; test assets. All fourteen limitations are listed in our documents.", [("C", "P19", 8.0)]),
    ("21", "Countersign. Sign only what you can read. Reviewers: live demo accounts are in our submission form.", [("C", "P21")]),
]


def run(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def duration(p):
    """Video parts are timed by their frame count (exact at 30 fps); the container duration rounds up and drifts."""
    p = str(p)
    if p.endswith(".mp4") and "/_edit/" in p:
        n = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
                                     "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", p]).decode().strip()
        if n.isdigit():
            return int(n) / 30
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))


def secs(s):
    m, x = s.split(":")
    return int(m) * 60 + float(x)


# ------------------------------------------------------------------ overlays
def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def draw_icon(d, kind, cx, cy, r, color):
    w = 4
    if kind == "person":
        d.ellipse((cx - r * .32, cy - r * .62, cx + r * .32, cy - r * .02), outline=color, width=w)
        d.arc((cx - r * .62, cy + r * .05, cx + r * .62, cy + r * 1.1), 180, 360, fill=color, width=w)
    elif kind == "stamp":
        d.rounded_rectangle((cx - r * .6, cy + r * .18, cx + r * .6, cy + r * .5), radius=4, outline=color, width=w)
        d.line((cx, cy - r * .2, cx, cy + r * .18), fill=color, width=w)
        d.ellipse((cx - r * .28, cy - r * .7, cx + r * .28, cy - r * .16), outline=color, width=w)
    elif kind == "key":
        d.ellipse((cx - r * .62, cy - r * .3, cx - r * .02, cy + r * .3), outline=color, width=w)
        d.line((cx - r * .02, cy, cx + r * .62, cy), fill=color, width=w)
        d.line((cx + r * .42, cy, cx + r * .42, cy + r * .26), fill=color, width=w)
        d.line((cx + r * .6, cy, cx + r * .6, cy + r * .2), fill=color, width=w)
    elif kind == "chain":
        d.rounded_rectangle((cx - r * .7, cy - r * .22, cx + r * .05, cy + r * .22), radius=int(r * .22), outline=color, width=w)
        d.rounded_rectangle((cx - r * .05, cy - r * .22, cx + r * .7, cy + r * .22), radius=int(r * .22), outline=color, width=w)
    else:  # page
        d.rounded_rectangle((cx - r * .42, cy - r * .58, cx + r * .42, cy + r * .58), radius=4, outline=color, width=w)
        for k in (-.25, 0, .25):
            d.line((cx - r * .24, cy + r * k, cx + r * .24, cy + r * k), fill=color, width=3)


def badge_png(key, right=False):
    """On the product's screens the badge sits top left; on Claude's clips, top right, clear of their titles."""
    dst = TMP / f"badge-{key}{'-r' if right else ''}.png"
    title, sub, color, icon = BADGES[key]
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ft, fs = font(SANS, 25, 2), font(SANS, 21, 5)
    tw = max(d.textlength(title, font=ft) + 30, d.textlength(sub, font=fs))
    w_all, y0, h = 92 + tw + 34, 40, 92
    x0 = 1920 - 44 - w_all if right else 44
    x1 = x0 + w_all
    d.rounded_rectangle((x0 + 5, y0 + 6, x1 + 5, y0 + h + 6), radius=h // 2, fill=(27, 43, 107, 40))
    d.rounded_rectangle((x0, y0, x1, y0 + h), radius=h // 2, fill=(*CREAM, 246), outline=(*color, 255), width=3)
    d.ellipse((x0 + 12, y0 + 12, x0 + 80, y0 + 80), fill=(*color, 255))
    draw_icon(d, icon, x0 + 46, y0 + 48, 26, (*CREAM, 255))
    # the highlight: a marker stroke under the title
    tx = x0 + 98
    mark = COBALT if color == NAVY else color
    d.rounded_rectangle((tx - 4, y0 + 40, tx + d.textlength(title, font=ft) + 4, y0 + 49), radius=4, fill=(*mark, 70))
    d.text((tx, y0 + 15), title, font=ft, fill=(*color, 255))
    d.text((tx, y0 + 52), sub, font=fs, fill=(*NAVY, 235))
    img.save(dst)
    return dst


def subtitle_png(num, text):
    dst = TMP / f"sub-{num}.png"
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(SERIF, 31)
    words, line, lines = text.split(), "", []
    for w in words:
        if d.textlength(line + " " + w, font=f) > 1500:
            lines.append(line)
            line = w
        else:
            line = (line + " " + w).strip()
    lines.append(line)
    lh = 42
    top = 1080 - 60 - lh * len(lines)
    width = max(d.textlength(l, font=f) for l in lines)
    d.rounded_rectangle((960 - width / 2 - 28, top - 16, 960 + width / 2 + 28, 1080 - 44), radius=10, fill=(*CREAM, 236))
    for i, l in enumerate(lines):
        d.text((960, top + i * lh + lh / 2), l, font=f, fill=(*NAVY, 255), anchor="mm")
    img.save(dst)
    return dst


# ------------------------------------------------------------------ zoom expressions
PAD = (2404 - 2192) / 2 / PT   # cream margin, in points, on each side of the page once it is 16:9


def clamp_rect(cx, cy, w):
    """A 16:9 view inside the padded page; returns recording pixels of the padded frame: left, top, width."""
    w = min(w, PAGE_W + 2 * PAD)
    h = w * 9 / 16
    x = min(max(cx - w / 2, -PAD), PAGE_W + PAD - w)
    y = min(max(cy - h / 2, 0), PAGE_H - h)
    return (x + PAD) * PT, y * PT, w * PT


def piecewise(keys, idx):
    """Ease (smoothstep) between keyframes; holds the last value."""
    vals = [(k[0], clamp_rect(*k[1:])[idx]) for k in keys]
    expr = f"{vals[-1][1]:.2f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(vals, vals[1:]))):
        if abs(v1 - v0) < 0.01:
            seg = f"{v0:.2f}"
        else:
            a = f"clip((it-{t0})/{t1 - t0},0,1)"   # it: input time in zoompan
            seg = f"({v0:.2f}+({v1 - v0:.2f})*{a}*{a}*(3-2*{a}))"
        expr = f"if(lt(it,{t1}),{seg},{expr})"
    if vals[0][0] > 0:
        expr = f"if(lt(it,{vals[0][0]}),{vals[0][1]:.2f},{expr})"
    return expr


def render_u(dst, fi, a, b, speed, badge, blur_table, keys, sub):
    X, Y, W = (piecewise(keys, i) for i in range(3))
    out_w, out_h = (960, 540) if PREVIEW else (1920, 1080)
    blurs = [BLUR_HEADER] + ([BLUR_TABLE] if blur_table else [])
    g = f"[0:v]crop=2232:1352:0:{PAGE_TOP},setpts=(PTS-STARTPTS)/{speed},fps=30[p0];"
    for i, (bx, by, bw, bh) in enumerate(blurs):
        g += f"[p{i}]split[p{i}a][p{i}b];[p{i}b]crop={bw}:{bh}:{bx}:{by},boxblur=lr=16:lp=2:cr=8:cp=2[bl{i}];[p{i}a][bl{i}]overlay={bx}:{by}[p{i + 1}];"
    n = len(blurs)
    # page cropped of the browser's red edge, padded to 16:9 with cream, then a zoom and pan along the keyframes
    g += (f"[p{n}]crop=2192:1352:20:0,pad=2404:1352:106:0:color=0xF4F0E5,"
          f"zoompan=z='2404/({W})':x='{X}':y='{Y}':d=1:s=1920x1080:fps=30,"
          f"setsar=1[z];[z][1:v]overlay=0:0[zb];[zb][2:v]overlay=0:0,scale={out_w}:{out_h},format=yuv420p[v]")
    script = dst.with_suffix(".graph")
    script.write_text(g)
    run("ffmpeg", "-y", "-ss", str(secs(a)), "-t", str(secs(b) - secs(a)), "-i", str(FILES[fi]),
        "-i", str(badge_png(badge)), "-i", str(sub), "-filter_complex_script", str(script), "-map", "[v]", "-an",
        "-c:v", "libx264", "-preset", "veryfast" if PREVIEW else "medium", "-crf", "19", "-r", "30", str(dst))


def render_c(dst, clip, max_s, badge, sub, hold=0):
    out_w, out_h = (960, 540) if PREVIEW else (1920, 1080)
    src = CLIPS / f"{clip}.mp4"
    inputs = ["-i", str(src), "-i", str(sub)]
    base = "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF4F0E5,fps=30,setsar=1[a];[a][1:v]overlay=0:0[b]"
    if badge:
        inputs += ["-i", str(badge_png(badge, right=True))]
        base += ";[b][2:v]overlay=0:0[c]"
        last = "c"
    else:
        last = "b"
    pad = f",tpad=stop_mode=clone:stop_duration={hold}" if hold else ""
    base += f";[{last}]scale={out_w}:{out_h}{pad},format=yuv420p[v]"
    lim = ["-t", str(max_s)] if max_s else []
    run("ffmpeg", "-y", *lim, *inputs, "-filter_complex", base, "-map", "[v]", "-an",
        "-c:v", "libx264", "-preset", "veryfast" if PREVIEW else "medium", "-crf", "19", "-r", "30", str(dst))


def srt_time(t):
    return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int((t % 1) * 1000):03d}"


NARR = VID / "narration"      # one voice file per shot, made by narrate.py (ElevenLabs)
SOUND = VID / "sound"        # intro, transition and outro effects and the music, made with the ElevenLabs API
LEAD, TAIL = 0.5, 0.45       # the voice starts once the transition ink has cleared, and leaves a short breath after
TRANS, TRANS_CUT = TMP / "transition.mov", 14 / 30   # made by transition.py; the cut falls 14 frames into it


def extend(src, secs_more):
    """Freeze the last frame of a part for a few more seconds, so the voice of the shot fits."""
    dst = src.with_name(src.stem + "-x.mp4")
    run("ffmpeg", "-y", "-i", str(src), "-vf", f"tpad=stop_mode=clone:stop_duration={secs_more:.2f}", "-an",
        "-c:v", "libx264", "-preset", "veryfast" if PREVIEW else "medium", "-crf", "19", "-r", "30", str(dst))
    return dst


def main():
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    parts, subs, voices, t = [], [], [], 0.0
    for num, text, segs in SHOTS:
        sub = subtitle_png(num, text)
        start = t
        shot_parts = []
        for i, s in enumerate(segs):
            dst = TMP / f"{num}-{i}{'-p' if PREVIEW else ''}.mp4"
            if not only or num in only or not dst.exists():
                if s[0] == "U":
                    render_u(dst, *s[1:], sub)
                else:
                    render_c(dst, s[1], s[2] if len(s) > 2 else None, s[3] if len(s) > 3 else None, sub, s[4] if len(s) > 4 else 0)
            shot_parts.append(dst)
        length = sum(duration(p) for p in shot_parts)
        voice = NARR / f"{num}.mp3"
        if voice.exists():
            need = LEAD + duration(voice) + TAIL - length
            if need > 0.05:
                shot_parts[-1] = extend(shot_parts[-1], need)
                length += need
            voices.append((start + LEAD, voice))
        parts += shot_parts
        t = start + sum(duration(p) for p in shot_parts)
        subs.append((start, t, text))
        print(f"{num}  {start:6.1f} -> {t:6.1f}")
    name = "InternationalAI-Countersign-DemoVideo" + ("-preview" if PREVIEW else "")
    (TMP / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
    joined = TMP / "joined.mp4"
    run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(TMP / "list.txt"), "-c", "copy", str(joined))
    # the pen transition over every cut between two shots
    cuts = [b for (_, b, _) in subs[:-1]]
    silent = TMP / "silent.mp4"
    if TRANS.exists() and cuts:
        ins, g, last = [], "", "0:v"
        for k, c in enumerate(cuts):      # one input per cut, shifted in time (a split of one input drops frames)
            ins += ["-itsoffset", f"{max(c - TRANS_CUT, 0):.3f}", "-i", str(TRANS)]
            g += f"[{last}][{k + 1}:v]overlay=0:0:eof_action=pass[o{k}];"
            last = f"o{k}"
        g += f"[{last}]format=yuv420p[v]"
        run("ffmpeg", "-y", "-i", str(joined), *ins, "-filter_complex", g, "-map", "[v]", "-an",
            "-c:v", "libx264", "-preset", "veryfast" if PREVIEW else "medium", "-crf", "19", "-r", "30", str(silent))
    else:
        silent = joined
    out = CUT / f"{name}.mp4"
    if voices:
        total_v = duration(silent)
        # sound: the narration; a soft pen-and-whoosh on every cut, a chime at the start and at the end (ElevenLabs
        # sound effects); calm music under everything, ducked while she speaks (ElevenLabs Music). Files in SOUND.
        fx = [(0.0, SOUND / "intro.mp3", 0.55)] + [(max(c - TRANS_CUT - 0.05, 0), SOUND / "transition.mp3", 0.38) for c in cuts]
        fx.append((subs[-1][0], SOUND / "outro.mp3", 0.6))
        ins, chains, n = [], [], 1
        for at, v in voices:
            ins += ["-i", str(v)]
            chains.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=mono,adelay={int(at * 1000)}[v{n}]")
            n += 1
        vlabels = "".join(f"[v{k}]" for k in range(1, n))
        chains.append(f"{vlabels}amix=inputs={n - 1}:normalize=0,pan=stereo|c0=c0|c1=c0,apad,atrim=0:{total_v:.2f},asplit=2[voice][key]")
        f0 = n
        for at, f, vol in fx:
            ins += ["-i", str(f)]
            ms = int(at * 1000)
            chains.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol},adelay={ms}|{ms}[f{n}]")
            n += 1
        flabels = "".join(f"[f{k}]" for k in range(f0, n))
        chains.append(f"{flabels}amix=inputs={n - f0}:normalize=0,apad,atrim=0:{total_v:.2f}[fx]")
        ins += ["-i", str(SOUND / "music.mp3")]
        chains.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{total_v:.2f},volume=0.16,"
                      f"afade=t=in:d=2,afade=t=out:st={total_v - 4:.2f}:d=4[mraw]")
        chains.append("[mraw][key]sidechaincompress=threshold=0.02:ratio=5:attack=40:release=600:makeup=1[music]")
        chains.append("[voice][fx][music]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
        run("ffmpeg", "-y", "-i", str(silent), *ins, "-filter_complex", ";".join(chains), "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out))
    else:
        run("ffmpeg", "-y", "-i", str(silent), "-c", "copy", "-movflags", "+faststart", str(out))
    (CUT / f"{name}.en.srt").write_text("".join(f"{i + 1}\n{srt_time(a)} --> {srt_time(b - 0.05)}\n{x}\n\n" for i, (a, b, x) in enumerate(subs)))
    total = duration(out)
    print(f"cut: {out}  {total:.1f}s")
    if total > 300:
        print(f"WARNING: {total - 300:.1f}s over the 5:00 limit")


if __name__ == "__main__":
    main()
