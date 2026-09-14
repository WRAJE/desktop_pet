#!/usr/bin/env python3
"""Pack approved character art into the desktop-pet sprite atlas. Does not invent a new design."""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image

FRAME = 128
ANCHOR = (64, 122)
COLS = 6
TARGET_H = 118
SIT_H = 90
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

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "source"
OUT = ROOT / "assets" / "sprites"


def flood_clear(im: Image.Image, thresh: int = 36) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = px[2, 2][:3]
    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > thresh:
            continue
        px[x, y] = (0, 0, 0, 0)
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def bbox(im: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = im.split()[-1]
    box = alpha.getbbox()
    return box


def keep_main_sprite(im: Image.Image) -> Image.Image:
    """Drop leftover pixels from neighboring pose cells; keep the body and nearby Zzz."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    labels = [-1] * (w * h)
    comps: list[list[tuple[int, int]]] = []

    def opaque(x: int, y: int) -> bool:
        return px[x, y][3] > 18

    for y in range(h):
        for x in range(w):
            i = y * w + x
            if labels[i] >= 0 or not opaque(x, y):
                continue
            cid = len(comps)
            q = deque([(x, y)])
            labels[i] = cid
            cells: list[tuple[int, int]] = []
            while q:
                cx, cy = q.popleft()
                cells.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = ny * w + nx
                    if labels[ni] < 0 and opaque(nx, ny):
                        labels[ni] = cid
                        q.append((nx, ny))
            comps.append(cells)
    if not comps:
        return im

    main = max(range(len(comps)), key=lambda i: len(comps[i]))
    mxs = [p[0] for p in comps[main]]
    mys = [p[1] for p in comps[main]]
    minx, maxx, miny, maxy = min(mxs), max(mxs), min(mys), max(mys)
    keep = {main}
    for i, cells in enumerate(comps):
        if i == main:
            continue
        xs = [p[0] for p in cells]
        ys = [p[1] for p in cells]
        icx, icy = sum(xs) / len(xs), sum(ys) / len(ys)
        dx = 0.0 if minx <= icx <= maxx else min(abs(icx - minx), abs(icx - maxx))
        dy = 0.0 if miny <= icy <= maxy else min(abs(icy - miny), abs(icy - maxy))
        dist = (dx * dx + dy * dy) ** 0.5
        near_side = icx < w * 0.1 or icx > w * 0.9
        small = len(cells) < 120
        if near_side and small:
            continue
        if dist <= 16:
            keep.add(i)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    opx = out.load()
    for i in keep:
        for x, y in comps[i]:
            opx[x, y] = px[x, y]
    return out


def remove_specks(im: Image.Image, rounds: int = 4) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    for _ in range(rounds):
        kill: list[tuple[int, int]] = []
        for y in range(h):
            for x in range(w):
                if px[x, y][3] <= 18:
                    continue
                n = 0
                for nx in range(x - 1, x + 2):
                    for ny in range(y - 1, y + 2):
                        if nx == x and ny == y:
                            continue
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 18:
                            n += 1
                if n < 2:
                    kill.append((x, y))
        if not kill:
            break
        for x, y in kill:
            px[x, y] = (0, 0, 0, 0)
    return im


def trim_sparse_sides(im: Image.Image, min_pixels: int = 12) -> Image.Image:
    """Strip thin leftover columns on the left/right edges."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    def col_count(x: int) -> int:
        return sum(1 for y in range(h) if px[x, y][3] > 18)

    left, right = 0, w - 1
    while left < right and col_count(left) < min_pixels:
        left += 1
    while right > left and col_count(right) < min_pixels:
        right -= 1
    if left == 0 and right == w - 1:
        return im
    return im.crop((left, 0, right + 1, h))


def fit_frame(
    im: Image.Image,
    height: int = TARGET_H,
    dx: int = 0,
) -> Image.Image:
    """Scale every pose to the same pixel height so animations do not pop in size."""
    im = remove_specks(keep_main_sprite(flood_clear(im)))
    im = trim_sparse_sides(im, min_pixels=12)
    box = bbox(im)
    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    if not box:
        return canvas
    crop = im.crop(box)
    cw, ch = crop.size
    scale = height / max(1, ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    if nw > FRAME - 4:
        s = (FRAME - 4) / nw
        nw, nh = max(1, int(nw * s)), max(1, int(nh * s))
    if nh > FRAME - 6:
        s = (FRAME - 6) / nh
        nw, nh = max(1, int(nw * s)), max(1, int(nh * s))
    crop = crop.resize((nw, nh), Image.Resampling.NEAREST)
    x = ANCHOR[0] - nw // 2 + dx
    y = ANCHOR[1] - nh
    canvas.paste(crop, (x, y), crop)
    return canvas


def split_grid(im: Image.Image, cols: int, rows: int = 1) -> list[Image.Image]:
    w, h = im.size
    cw, rh = w // cols, h // rows
    cells = []
    for r in range(rows):
        for c in range(cols):
            cells.append(im.crop((c * cw, r * rh, (c + 1) * cw, (r + 1) * rh)))
    return cells


def pad(frames: list[Image.Image], n: int) -> list[Image.Image]:
    if not frames:
        return [Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))] * n
    out = list(frames)
    while len(out) < n:
        out.append(frames[len(out) % len(frames)])
    return out[:n]


def main() -> None:
    front = Image.open(SRC / "1-正面待机.png")
    poses = Image.open(SRC / "3-表情动作表.png")
    walk_src = Image.open(SRC / "4-走路侧面.png")
    portrait = Image.open(SRC / "2-半身头像.png")
    physics = Image.open(SRC / "erii-physics.png")
    emotes = Image.open(SRC / "erii-emotes.png")
    spin_src = Image.open(SRC / "erii-spin.png")
    panic_src = Image.open(SRC / "erii-panic.png")

    idle0 = fit_frame(front)
    pose_cells = [fit_frame(c) for c in split_grid(poses, 3, 2)]
    sit = fit_frame(split_grid(poses, 3, 2)[4], SIT_H) if len(pose_cells) > 4 else idle0
    sleep = fit_frame(split_grid(poses, 3, 2)[5], SIT_H) if len(pose_cells) > 5 else idle0
    walk_cells = [fit_frame(c) for c in split_grid(walk_src, 4, 1)]
    phy = [fit_frame(c) for c in split_grid(physics, 4, 1)]
    emo = [fit_frame(c) for c in split_grid(emotes, 4, 1)]
    spin = [fit_frame(c) for c in split_grid(spin_src, 4, 1)]
    panic = [fit_frame(c) for c in split_grid(panic_src, 4, 1)]

    closed = pose_cells[1] if len(pose_cells) > 1 else idle0
    smile = pose_cells[2] if len(pose_cells) > 2 else idle0
    hop = pose_cells[3] if len(pose_cells) > 3 else idle0

    x_eyes = phy[0]
    startled = phy[2] if len(phy) > 2 else hop
    heart = emo[0]
    yawn = emo[1]
    look_a = emo[2]
    look_b = emo[3]

    rows = {
        "idle": [idle0],
        "walk": pad(walk_cells, 6),
        "held": [x_eyes, startled, x_eyes, hop],
        "fall": [startled, hop],
        "land": [idle0, idle0, idle0, idle0],
        "sit": [sit, sit],
        "sleep": [sleep, sleep, sleep, sleep],
        "blink_tilt": [idle0, closed, closed, smile],
        "happy_hop": [smile, hop, hop, idle0],
        "spin": spin,
        "heart": [heart, heart, idle0, heart],
        "panic_run": pad(panic, 4),
        "yawn": [yawn, yawn, closed, idle0],
        "look": [look_a, look_a, look_b, look_b],
        "sway": [fit_frame(front, dx=-3), idle0, fit_frame(front, dx=3), idle0],
    }

    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * len(ROW_ORDER)), (0, 0, 0, 0))
    meta = {
        "idle": {"fps": 1, "loop": True},
        "walk": {"fps": 6, "loop": True},
        "held": {"fps": 8, "loop": True},
        "fall": {"fps": 6, "loop": True},
        "land": {"fps": 12, "loop": False},
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

    OUT.mkdir(parents=True, exist_ok=True)
    for r, name in enumerate(ROW_ORDER):
        fr = pad(rows[name], meta[name].get("frames", len(rows[name])))
        meta[name]["frames"] = len(fr)
        for i, cell in enumerate(fr[:COLS]):
            sheet.paste(cell, (i * FRAME, r * FRAME), cell)

    sheet.save(OUT / "erii.png")
    atlas = {
        "image": "erii.png",
        "frameSize": [FRAME, FRAME],
        "anchor": [ANCHOR[0], ANCHOR[1]],
        "scale": 3,
        "placeholder": False,
        "animations": {name: {"row": i, **meta[name]} for i, name in enumerate(ROW_ORDER)},
    }
    (OUT / "atlas.json").write_text(json.dumps(atlas, indent=2), encoding="utf-8")

    idle0.save(OUT / "idle_preview.png")
    face = flood_clear(portrait)
    box = bbox(face) or (0, 0, face.width, face.height)
    face = face.crop(box).resize((256, 256), Image.Resampling.NEAREST)
    (ROOT / "assets").mkdir(exist_ok=True)
    face.save(ROOT / "assets" / "icon.png")
    face.resize((32, 32), Image.Resampling.NEAREST).save(OUT / "tray.png")
    print("packed", sheet.size, "->", OUT / "erii.png")


if __name__ == "__main__":
    main()
