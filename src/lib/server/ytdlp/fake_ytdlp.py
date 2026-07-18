#!/usr/bin/env python3
"""Test stand-in for yt-dlp.

Parses the same argv the real pipeline builds, emits realistic progress
frames, and copies a pre-generated audio fixture (env FAKE_YTDLP_FIXTURE)
into the requested output location. Env FAKE_YTDLP_MODE:
  ok (default) - succeed
  fail-permanent - exit 1 with a "Video unavailable" stderr
  fail-transient - exit 1 with a network-ish stderr
"""

import json
import os
import shutil
import sys

mode = os.environ.get("FAKE_YTDLP_MODE", "ok")

if mode == "fail-permanent":
    print("ERROR: Video unavailable. This video is not available", file=sys.stderr)
    sys.exit(1)
if mode == "fail-transient":
    print("ERROR: unable to download webpage: timed out", file=sys.stderr)
    sys.exit(1)

# Recover the -o/--output template to find the destination directory.
output = None
args = sys.argv[1:]
for i, arg in enumerate(args):
    if arg in ("--output", "-o") and i + 1 < len(args):
        output = args[i + 1]

if output is None:
    print("fake yt-dlp: no --output given", file=sys.stderr)
    sys.exit(2)

for frac in (0.25, 0.6, 1.0):
    print(
        json.dumps(
            {
                "status": "downloading",
                "downloaded_bytes": int(1000 * frac),
                "total_bytes": 1000,
                "speed": 250000,
            }
        ),
        flush=True,
    )
print(json.dumps({"status": "finished"}), flush=True)

fixture = os.environ["FAKE_YTDLP_FIXTURE"]
ext = os.path.splitext(fixture)[1].lstrip(".")
dest = output.replace("%(ext)s", ext)
os.makedirs(os.path.dirname(dest), exist_ok=True)
shutil.copyfile(fixture, dest)
