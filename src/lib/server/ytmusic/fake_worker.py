#!/usr/bin/env python3
"""Stdlib-only stand-in for ytm_worker.py used by unit tests.

Modes (first argv):
  echo   - replies {"result": {"method": ..., "params": ...}} to every frame
  crash  - replies to the first frame, then exits 1
  silent - never replies (for timeout tests)
"""

import json
import sys

mode = sys.argv[1] if len(sys.argv) > 1 else "echo"
replied = False

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    if mode == "silent":
        continue
    if req.get("method") == "boom":
        out = {"id": req.get("id"), "error": {"message": "synthetic failure"}}
    else:
        out = {
            "id": req.get("id"),
            "result": {"method": req.get("method"), "params": req.get("params")},
        }
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()
    if mode == "crash" and not replied:
        sys.exit(1)
    replied = True
