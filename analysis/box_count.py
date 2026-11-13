#!/usr/bin/env python3
"""Estimate the box-counting slope of a rasterized Mandelbrot boundary proxy.

This measures a finite pixel approximation, not the mathematical boundary itself.
"""

import argparse
import csv
import math
from pathlib import Path

import numpy as np


def load_escape_grid(path: Path) -> np.ndarray:
    rows = []
    width = height = 0
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        required = {"x", "y", "class", "iterations"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"CSV must contain these columns: {sorted(required)}")
        for row in reader:
            x, y = int(row["x"]), int(row["y"])
            width = max(width, x + 1)
            height = max(height, y + 1)
            rows.append((x, y, row["class"] == "escaped"))

    if not rows:
        raise ValueError("CSV contains no pixel samples")

    escaped = np.zeros((height, width), dtype=np.bool_)
    seen = np.zeros((height, width), dtype=np.bool_)
    for x, y, is_escaped in rows:
        if seen[y, x]:
            raise ValueError(f"duplicate pixel coordinate ({x}, {y})")
        seen[y, x] = True
        escaped[y, x] = is_escaped
    if not seen.all():
        raise ValueError("CSV does not contain a complete rectangular raster")
    return escaped


def boundary_proxy(escaped: np.ndarray) -> np.ndarray:
    """Mark pixels on either side of a 4-neighbor escaped/non-escaped transition."""
    boundary = np.zeros_like(escaped)
    horizontal = escaped[:, 1:] != escaped[:, :-1]
    vertical = escaped[1:, :] != escaped[:-1, :]
    boundary[:, 1:] |= horizontal
    boundary[:, :-1] |= horizontal
    boundary[1:, :] |= vertical
    boundary[:-1, :] |= vertical
    return boundary


def box_counts(mask: np.ndarray) -> list[tuple[int, int]]:
    height, width = mask.shape
    max_scale = 1 << int(math.log2(min(height, width)))
    scales = []
    scale = 1
    while scale <= max_scale:
        padded_height = ((height + scale - 1) // scale) * scale
        padded_width = ((width + scale - 1) // scale) * scale
        padded = np.pad(mask, ((0, padded_height - height), (0, padded_width - width)))
        blocks = padded.reshape(padded_height // scale, scale, padded_width // scale, scale)
        occupied = int(np.count_nonzero(blocks.any(axis=(1, 3))))
        scales.append((scale, occupied))
        scale *= 2
    return scales


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="pixel CSV exported by mandelbrot-lab")
    parser.add_argument("--min-box", type=int, default=2, help="smallest box size used in the fit")
    parser.add_argument("--max-box", type=int, default=64, help="largest box size used in the fit")
    args = parser.parse_args()

    escaped = load_escape_grid(args.csv)
    edge = boundary_proxy(escaped)
    counts = box_counts(edge)
    selected = [(size, count) for size, count in counts
                if args.min_box <= size <= args.max_box and count > 0]
    if len(selected) < 3:
        raise SystemExit("Choose a box-size range containing at least three scales with boundary pixels")

    x = np.log([1.0 / size for size, _ in selected])
    y = np.log([count for _, count in selected])
    slope, intercept = np.polyfit(x, y, 1)
    predicted = slope * x + intercept
    residual = y - predicted
    total = float(np.sum((y - y.mean()) ** 2))
    r_squared = 1.0 - float(np.sum(residual**2)) / total if total else 1.0

    print("scale_px,occupied_boxes")
    for size, count in counts:
        print(f"{size},{count}")
    print(f"\nFinite-raster slope over scales {selected[0][0]}..{selected[-1][0]} px: {slope:.4f}")
    print(f"R^2 for the selected log-log fit: {r_squared:.5f}")
    print("Caution: this is a slope for a pixel-derived boundary proxy, not a proof of fractal dimension.")


if __name__ == "__main__":
    main()
