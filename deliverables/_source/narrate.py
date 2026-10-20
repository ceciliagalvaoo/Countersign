"""Narration of the demo video with ElevenLabs: one file per shot, the text of its English subtitle.
Voice: Bella (premade, "Professional, Bright, Warm"), model eleven_multilingual_v2.
The key is read from ELEVENLABS_API_KEY or from ../../../.elevenlabs.env (outside the repository); never commit it.
Output: 03-demo-video/narration/NN.mp3 (gitignored). A shot whose text has not changed is not generated again.
Run: python3 narrate.py [shot numbers]
"""
import hashlib
import json
import os
import sys
import subprocess
from pathlib import Path

from edit_demo import NARR, SHOTS

VOICE = "hpp4J3VqNfWAUOO0d1Us"   # Bella
MODEL = "eleven_multilingual_v2"
SETTINGS = {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True, "speed": 1.06}

# Spoken forms where the subtitle's written form would be read badly
SAY = {"USDC": "U S D C", "KYC": "K Y C", "2026": "twenty twenty-six", "agent_revoked": "agent revoked"}


def key():
    if os.environ.get("ELEVENLABS_API_KEY"):
        return os.environ["ELEVENLABS_API_KEY"]
    env = Path(__file__).resolve().parents[3] / ".elevenlabs.env"
    for line in env.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no ElevenLabs key")


def spoken(text):
    for a, b in SAY.items():
        text = text.replace(a, b)
    return text


def main():
    only = sys.argv[1:]
    NARR.mkdir(parents=True, exist_ok=True)
    k = key()
    for i, (num, text, _) in enumerate(SHOTS):
        if only and num not in only:
            continue
        say = spoken(text)
        tag = hashlib.sha1((VOICE + MODEL + json.dumps(SETTINGS) + say).encode()).hexdigest()[:12]
        dst, stamp = NARR / f"{num}.mp3", NARR / f"{num}.txt"
        if dst.exists() and stamp.exists() and stamp.read_text() == tag:
            continue
        body = {"text": say, "model_id": MODEL, "voice_settings": SETTINGS,
                "previous_text": spoken(SHOTS[i - 1][1]) if i else None,
                "next_text": spoken(SHOTS[i + 1][1]) if i + 1 < len(SHOTS) else None}
        # curl, not urllib: this machine's Python 3.9 times out on the API's TLS endpoint
        subprocess.run(["curl", "-s", "-f", "-m", "45", "--retry", "6", "--retry-all-errors", "--retry-delay", "2", "-o", str(dst), "-X", "POST",
                        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128",
                        "-H", f"xi-api-key: {k}", "-H", "Content-Type: application/json", "-d", json.dumps(body)], check=True)
        stamp.write_text(tag)
        print("voice", num)


if __name__ == "__main__":
    main()
