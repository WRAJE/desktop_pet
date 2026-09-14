#!/usr/bin/env python3
"""Geometric placeholder dummy — not a character portrait."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

FRAME = 64
ANCHOR = (32, 60)
COLS = 6
INK = (42, 42, 44, 255)
FILL = (206, 202, 196, 255)
BODY = (154, 162, 172, 255)
ACCENT = (196, 92, 108, 255)  # tiny marker only
WHITE = (245, 243, 240, 255)
SLEEP = (110, 130, 170, 255)

ROW_ORDER = [
    "idle",
    "walk",
    "held",
    "fall",
    "land",
    "sit",
    "sleep",
    "blink_tilt",
    "happy_hop",
    "spin",
    "heart",
    "panic_run",
    "yawn",
    "look",
    "sway",
]


class Pix:
    def __init__(self) -> None:
        self.px = [[None] * FRAME for _ in range(FRAME)]

    def put(self, x: int, y: int, c) -> None:
        if 0 <= x < FRAME and 0 <= y < FRAME:
            self.px[y][x] = c

    def rect(self, x: int, y: int, w: int, h: int, c) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.put(xx, yy, c)

    def box(self, x: int, y: int, w: int, h: int, fill, ink=INK) -> None:
        self.rect(x, y, w, h, fill)
        for i in range(w):
            self.put(x + i, y, ink)
            self.put(x + i, y + h - 1, ink)
        for j in range(h):
            self.put(x, y + j, ink)
            self.put(x + w - 1, y + j, ink)

    def to_image(self) -> Image.Image:
        im = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        data = [self.px[y][x] or (0, 0, 0, 0) for y in range(FRAME) for x in range(FRAME)]
        im.putdata(data)
        return im


def dummy(
    *,
    blink: bool = False,
    eyes: str = "dot",
    look: int = 0,
    mouth: str = "none",
    arms: str = "down",
    legs: str = "stand",
    head_dx: int = 0,
    body_dy: int = 0,
    squash: tuple[float, float] = (1.0, 1.0),
    marker: bool = True,
    zzz: bool = False,
) -> Pix:
    p = Pix()
    hx, hy = 24 + head_dx, 10 + body_dy
    p.box(hx, hy, 16, 16, FILL)
    if marker:
        p.rect(hx + 6, hy + 1, 4, 2, ACCENT)

    ex = hx + 4 + look
    ey = hy + 6
    if eyes == "x":
        for d in range(3):
            p.put(ex + d, ey + d, INK)
            p.put(ex + 2 - d, ey + d, INK)
            p.put(ex + 8 + d, ey + d, INK)
            p.put(ex + 10 - d, ey + d, INK)
    elif eyes == "closed" or blink:
        p.rect(ex, ey + 1, 3, 1, INK)
        p.rect(ex + 8, ey + 1, 3, 1, INK)
    elif eyes == "wide":
        p.box(ex, ey - 1, 4, 4, WHITE)
        p.box(ex + 8, ey - 1, 4, 4, WHITE)
        p.put(ex + 1, ey, INK)
        p.put(ex + 9, ey, INK)
    else:
        p.rect(ex, ey, 2, 2, INK)
        p.rect(ex + 8, ey, 2, 2, INK)

    if mouth == "o":
        p.box(hx + 6, hy + 11, 4, 3, WHITE)
    elif mouth == "flat":
        p.rect(hx + 6, hy + 12, 4, 1, INK)

    by = 26 + body_dy
    p.box(25, by, 14, 16, BODY)

    if arms == "down":
        p.box(21, by + 2, 4, 10, FILL)
        p.box(39, by + 2, 4, 10, FILL)
    elif arms == "out":
        p.box(16, by + 4, 10, 4, FILL)
        p.box(38, by + 4, 10, 4, FILL)
    elif arms == "up":
        p.box(21, by - 8, 4, 10, FILL)
        p.box(39, by - 8, 4, 10, FILL)
    elif arms == "heart":
        p.box(23, by + 4, 4, 6, FILL)
        p.box(37, by + 4, 4, 6, FILL)
        p.rect(30, by + 6, 2, 2, ACCENT)
        p.rect(32, by + 6, 2, 2, ACCENT)
        p.rect(31, by + 8, 2, 2, ACCENT)

    ly = by + 16
    if legs == "stand":
        p.box(27, ly, 4, 12, FILL)
        p.box(33, ly, 4, 12, FILL)
        p.rect(27, 58, 4, 2, INK)
        p.rect(33, 58, 4, 2, INK)
    elif legs == "walk_l":
        p.box(25, ly, 4, 10, FILL)
        p.box(35, ly + 2, 4, 12, FILL)
        p.rect(25, 56, 4, 2, INK)
        p.rect(35, 58, 4, 2, INK)
    elif legs == "walk_r":
        p.box(35, ly, 4, 10, FILL)
        p.box(25, ly + 2, 4, 12, FILL)
        p.rect(35, 56, 4, 2, INK)
        p.rect(25, 58, 4, 2, INK)
    elif legs == "kick":
        p.box(27, ly, 4, 8, FILL)
        p.box(37, ly - 2, 10, 4, FILL)
        p.rect(27, 56, 4, 2, INK)
        p.rect(45, ly - 2, 2, 4, INK)
    elif legs == "sit":
        p.box(18, ly, 10, 4, FILL)
        p.box(36, ly, 10, 4, FILL)
        p.rect(18, ly + 3, 4, 2, INK)
        p.rect(42, ly + 3, 4, 2, INK)
    elif legs == "sway_l":
        p.box(26, ly, 4, 12, FILL)
        p.box(34, ly, 4, 12, FILL)
        p.rect(26, 58, 4, 2, INK)
        p.rect(34, 58, 4, 2, INK)
    elif legs == "sway_r":
        p.box(28, ly, 4, 12, FILL)
        p.box(32, ly, 4, 12, FILL)
        p.rect(28, 58, 4, 2, INK)
        p.rect(32, 58, 4, 2, INK)

    if zzz:
        p.rect(44, 8, 3, 2, SLEEP)
        p.rect(48, 4, 4, 3, SLEEP)
        p.rect(54, 1, 5, 3, SLEEP)

    if squash != (1.0, 1.0):
        p = scale_about(p, squash[0], squash[1])
    return p


def scale_about(src: Pix, sx: float, sy: float) -> Pix:
    out = Pix()
    ax, ay = ANCHOR
    for y in range(FRAME):
        for x in range(FRAME):
            c = src.px[y][x]
            if c is None:
                continue
            out.put(int(ax + (x - ax) * sx), int(ay + (y - ay) * sy), c)
    return out


def frames_for(name: str) -> list[Pix]:
    if name == "idle":
        return [dummy(), dummy(blink=True), dummy(), dummy()]
    if name == "walk":
        return [
            dummy(legs="walk_l", arms="out"),
            dummy(),
            dummy(legs="walk_r", arms="out"),
            dummy(blink=True),
            dummy(legs="walk_l", arms="out"),
            dummy(legs="walk_r", arms="out"),
        ]
    if name == "held":
        return [
            dummy(eyes="x", mouth="o", arms="up", legs="kick"),
            dummy(eyes="wide", mouth="o", arms="out", legs="kick"),
            dummy(eyes="x", mouth="o", arms="up", legs="kick"),
            dummy(eyes="wide", mouth="o", arms="out", legs="stand"),
        ]
    if name == "fall":
        return [
            dummy(eyes="wide", mouth="o", arms="out"),
            dummy(eyes="wide", mouth="o", arms="up"),
        ]
    if name == "land":
        return [
            dummy(eyes="wide", mouth="o", squash=(1.3, 0.7)),
            dummy(mouth="o", squash=(1.15, 0.85)),
            dummy(squash=(0.92, 1.1)),
            dummy(),
        ]
    if name == "sit":
        return [dummy(legs="sit"), dummy(legs="sit", blink=True)]
    if name == "sleep":
        return [
            dummy(legs="sit", eyes="closed", zzz=True),
            dummy(legs="sit", eyes="closed", zzz=True, body_dy=1),
            dummy(legs="sit", eyes="closed", zzz=True),
            dummy(legs="sit", eyes="closed", zzz=True, body_dy=1),
        ]
    if name == "blink_tilt":
        return [
            dummy(),
            dummy(head_dx=-2, blink=True),
            dummy(head_dx=-3),
            dummy(head_dx=-1),
        ]
    if name == "happy_hop":
        return [
            dummy(mouth="flat", arms="up"),
            dummy(mouth="flat", arms="up", body_dy=-4),
            dummy(mouth="flat", arms="up", body_dy=-6),
            dummy(mouth="flat", body_dy=-1, squash=(1.1, 0.9)),
        ]
    if name == "spin":
        side = dummy(arms="out")
        thin = Pix()
        thin.box(29, 10, 6, 16, FILL)
        thin.rect(30, 11, 4, 2, ACCENT)
        thin.box(28, 26, 8, 16, BODY)
        thin.box(30, 42, 4, 16, FILL)
        return [dummy(arms="out"), thin, dummy(arms="out"), thin]
    if name == "heart":
        return [
            dummy(arms="heart"),
            dummy(arms="heart", body_dy=-2),
            dummy(arms="heart"),
            dummy(arms="heart"),
        ]
    if name == "panic_run":
        return [
            dummy(eyes="wide", mouth="o", legs="walk_l", arms="out"),
            dummy(eyes="wide", mouth="o", legs="walk_r", arms="up"),
            dummy(eyes="wide", mouth="o", legs="walk_l", arms="out"),
            dummy(eyes="wide", mouth="o", legs="walk_r", arms="up"),
        ]
    if name == "yawn":
        return [
            dummy(eyes="closed", mouth="o"),
            dummy(eyes="closed", mouth="o", arms="up"),
            dummy(eyes="closed", mouth="o"),
            dummy(eyes="dot"),
        ]
    if name == "look":
        return [
            dummy(look=-2),
            dummy(look=-3),
            dummy(look=3),
            dummy(look=2, blink=True),
        ]
    if name == "sway":
        return [
            dummy(legs="sway_l"),
            dummy(),
            dummy(legs="sway_r"),
            dummy(),
        ]
    return [dummy()]


META = {
    "idle": {"fps": 3, "loop": True},
    "walk": {"fps": 8, "loop": True},
    "held": {"fps": 8, "loop": True},
    "fall": {"fps": 6, "loop": True},
    "land": {"fps": 10, "loop": False},
    "sit": {"fps": 2, "loop": True},
    "sleep": {"fps": 2, "loop": True},
    "blink_tilt": {"fps": 6, "loop": False},
    "happy_hop": {"fps": 8, "loop": False},
    "spin": {"fps": 8, "loop": False},
    "heart": {"fps": 5, "loop": False},
    "panic_run": {"fps": 10, "loop": True},
    "yawn": {"fps": 4, "loop": False},
    "look": {"fps": 4, "loop": False},
    "sway": {"fps": 3, "loop": True},
}


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "assets" / "sprites"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = [frames_for(name) for name in ROW_ORDER]
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * len(ROW_ORDER)), (0, 0, 0, 0))
    for r, fr in enumerate(rows):
        for i, pix in enumerate(fr[:COLS]):
            im = pix.to_image()
            sheet.paste(im, (i * FRAME, r * FRAME), im)

    sheet.save(out_dir / "erii.png")
    atlas = {
        "image": "erii.png",
        "frameSize": [FRAME, FRAME],
        "anchor": [ANCHOR[0], ANCHOR[1]],
        "scale": 2,
        "placeholder": True,
        "animations": {
            name: {"row": i, "frames": len(rows[i]), **META[name]}
            for i, name in enumerate(ROW_ORDER)
        },
    }
    (out_dir / "atlas.json").write_text(json.dumps(atlas, indent=2), encoding="utf-8")

    preview = frames_for("idle")[0].to_image()
    preview.save(out_dir / "idle_preview.png")
    icon = preview.crop((20, 8, 44, 32)).resize((256, 256), Image.NEAREST)
    icon.save(root / "assets" / "icon.png")
    icon.resize((32, 32), Image.NEAREST).save(out_dir / "tray.png")
    print(f"placeholder sheet {sheet.size}")


if __name__ == "__main__":
    main()
