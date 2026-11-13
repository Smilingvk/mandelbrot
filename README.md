# forma · fractal explorer

A small lab for exploring fractals. It combines an interactive browser experience with a high-resolution Rust renderer for reproducible images and data.

## Explore in your browser

Open `index.html` in a modern browser. No installation or server is required.

- Switch between the Mandelbrot set and Newton fractals.
- Choose a Newton equation or enter your own function, such as `z^3 - 1`.
- Supported syntax: `z`, `i`, `pi`, `e`, arithmetic operators, powers, parentheses, and `sin`, `cos`, `exp`, `log`, and `sqrt`.
- Click or scroll to zoom, drag to pan, tune iteration depth and colors, and download the current view as a PNG.

Rendering runs locally in a browser canvas. Deep views and complex Newton equations may take a few seconds to calculate.

## Rust renderer

The command-line renderer distributes work across CPU cores with Rayon and can export each pixel's classification and iteration count for later analysis.

The goal is to move beyond a pretty image: use the renderer to investigate how finite resolution and iteration limits affect measurements of the set's boundary.

## The mathematical question

The boundary of the Mandelbrot set is known to have Hausdorff dimension 2. This program does not prove that theorem. It provides a reproducible way to explore finite-grid approximations and ask how measured boundary complexity changes with resolution, iteration budget, and sampling choices.

For each parameter `c`, it iterates

```text
z[0] = 0
z[n + 1] = z[n]^2 + c
```

If the orbit's magnitude exceeds 2, the parameter is outside the set. If it has not escaped by the configured iteration limit, the program reports it as **unresolved**, not as mathematically proven to be inside. Two common interior regions—the main cardioid and the period-2 bulb—are recognized with analytic tests.

### Build and run

Requires a Rust toolchain with Cargo.

```bash
cargo run --release -- --output mandelbrot.png
```

Render a deeper view and save the raw pixel classifications for analysis:

```bash
cargo run --release -- \
  --center-x -0.75 --center-y 0.1 --span 0.5 \
  --width 1600 --height 1000 --max-iter 3000 \
  --output view.png --csv view.csv
```

Estimate a box-counting slope for the rasterized boundary proxy (Python 3 and NumPy required):

```bash
python3 -m pip install -r analysis/requirements.txt
python3 analysis/box_count.py view.csv --min-box 2 --max-box 64
```

The script prints counts at every power-of-two scale. Its slope is an experiment on a finite raster and depends on resolution, iteration limit, viewport, and the chosen fit range.

The `--span` option is the vertical size of the complex-plane window; the horizontal span is determined by the image aspect ratio.

## What makes this implementation useful for experiments

- Rayon schedules small row-tiles across worker threads, reducing the load imbalance that occurs when each thread receives one large image band.
- Smooth escape-time coloring avoids coloring every exterior pixel by only its integer escape count.
- Analytic tests skip iteration for points in the main cardioid and period-2 bulb.
- CSV output distinguishes those certified regions, escaped points, and points still unresolved at the iteration limit.
- Runtime and pixel throughput are printed so later versions can be benchmarked.

## Planned research extensions

1. Repeat measurements while varying resolution, maximum iterations, grid offset, and region of the parameter plane.
2. Report sensitivity and uncertainty instead of presenting one finite-resolution slope as a proof of fractal dimension.
3. Add adaptive quadtree refinement so computation concentrates near the boundary.
4. Compare Rayon tile sizes and serial rendering, then add deep-zoom precision techniques if needed.

## Current limitations

- The current renderer uses `f64`; extreme deep zooms require higher precision or perturbation methods.
- A pixel that has not escaped by the iteration limit is not necessarily inside the set.
- The two analytic tests cover only the main cardioid and period-2 bulb; other interior points may remain unresolved.
- The CSV export is one record per pixel and can become large for high-resolution images.

## License

MIT
