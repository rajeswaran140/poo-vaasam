#!/usr/bin/env python3
"""render-lyric-cards — render each lyric cue as a full-frame transparent PNG:
a rounded lozenge that hugs the (correctly Tamil-shaped) text, centred on the
caption line. generate-song-short.ts then overlays these onto the hook clip with
per-cue enable timing.

Why Pillow and not ffmpeg's libass/drawtext: drawtext does no complex-script
shaping (Tamil clusters break), and this box's libass build mis-spaces Tamil
clusters. Pillow's raqm layout engine (HarfBuzz) shapes Tamil correctly and
gives full control over the rounded plate. Requires Pillow built with raqm.

Reads a JSON spec on argv[1]:
  {"font": "<ttf>", "width": 1080, "height": 1920, "centerY": 1440,
   "outDir": "<dir>", "cues": [{"i": 0, "text": "…"}, …]}
Writes <outDir>/cap_<i>.png for each cue and prints the count.
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont, features

# style constants (tuned against the 1080x1920 hook-clip template)
FONT_PX = 58
PAD_X, PAD_Y = 42, 24
RADIUS = 46
LINE_GAP = 12
MAX_TEXT_FRAC = 0.86      # box may span at most this fraction of frame width
MAX_LINES = 2             # wrap long lyric lines to at most 2 lines
PLATE_RGBA = (0, 0, 0, 150)
TEXT_RGBA = (255, 255, 255, 255)
SHADOW_RGBA = (0, 0, 0, 140)


def main() -> int:
    if not features.check("raqm"):
        print("ERROR: Pillow lacks raqm; Tamil would render unshaped", file=sys.stderr)
        return 2

    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    W, H, CY = int(spec["width"]), int(spec["height"]), int(spec["centerY"])
    out_dir = spec["outDir"]
    font = ImageFont.truetype(spec["font"], FONT_PX)
    max_text_w = int(W * MAX_TEXT_FRAC) - 2 * PAD_X
    scratch = ImageDraw.Draw(Image.new("RGBA", (8, 8)))

    def measure(s: str):
        left, top, right, bottom = scratch.textbbox((0, 0), s, font=font, language="ta")
        return right - left, bottom - top

    def wrap(text: str):
        lines, cur = [], ""
        for word in text.split(" "):
            trial = (cur + " " + word).strip()
            if not cur or measure(trial)[0] <= max_text_w:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        return lines[:MAX_LINES]

    count = 0
    for cue in spec["cues"]:
        lines = wrap(cue["text"])
        dims = [measure(ln) for ln in lines]
        text_w = max(w for w, _ in dims)
        line_h = max(h for _, h in dims)
        text_h = line_h * len(lines) + LINE_GAP * (len(lines) - 1)
        box_w, box_h = text_w + 2 * PAD_X, text_h + 2 * PAD_Y

        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        x0, y0 = (W - box_w) // 2, CY - box_h // 2
        draw.rounded_rectangle([x0, y0, x0 + box_w, y0 + box_h], radius=RADIUS, fill=PLATE_RGBA)

        y = y0 + PAD_Y
        for ln, (w, _h) in zip(lines, dims):
            x = (W - w) // 2
            draw.text((x + 2, y + 2), ln, font=font, fill=SHADOW_RGBA, language="ta")
            draw.text((x, y), ln, font=font, fill=TEXT_RGBA, language="ta")
            y += line_h + LINE_GAP

        img.save(f"{out_dir}/cap_{cue['i']}.png")
        count += 1

    print(count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
