#!/usr/bin/env python3
"""PNG -> WebP helper for capture.mjs.

Usage: python webp.py <in.png> <out-1x.webp> <out-2x.webp> <device-scale-factor>

The PNG was shot at <device-scale-factor> (2 for desktop, 3 for the phone captures).
Writes the 2x file (device width * 2 / dsf) and the 1x file (device width / dsf), both resized
with Lanczos when needed, and prints ONE JSON line with the real pixel + byte sizes.

Quality starts at 82 (method 6) and steps down to a floor of 70 while a file is over its budget
(1x <= 90 KB, 2x <= 260 KB). If a file is still over budget at q70 the JSON says so (`over`).
"""
import json
import os
import sys

from PIL import Image

BUDGET_KB = {"1x": 90, "2x": 260}
Q_START, Q_FLOOR, Q_STEP = 82, 70, 4


def save_webp(img, path, budget_kb):
    q = Q_START
    while True:
        img.save(path, "WEBP", quality=q, method=6)
        kb = os.path.getsize(path) / 1024
        if kb <= budget_kb or q <= Q_FLOOR:
            return q, kb
        q = max(Q_FLOOR, q - Q_STEP)


def main():
    src, out1, out2, dsf = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
    im = Image.open(src).convert("RGB")
    w, h = im.size
    w2, h2 = round(w * 2 / dsf), round(h * 2 / dsf)
    w1, h1 = round(w / dsf), round(h / dsf)
    im2 = im if (w2, h2) == (w, h) else im.resize((w2, h2), Image.LANCZOS)
    im1 = im.resize((w1, h1), Image.LANCZOS)
    q2, kb2 = save_webp(im2, out2, BUDGET_KB["2x"])
    q1, kb1 = save_webp(im1, out1, BUDGET_KB["1x"])
    print(json.dumps({
        "width1x": w1, "height1x": h1, "width2x": w2, "height2x": h2,
        "kb1x": round(kb1, 1), "kb2x": round(kb2, 1), "q1x": q1, "q2x": q2,
        "over": [k for k, kb in (("1x", kb1), ("2x", kb2)) if kb > BUDGET_KB[k]],
    }))


if __name__ == "__main__":
    main()
