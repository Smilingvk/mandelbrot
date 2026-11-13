use image::{ImageBuffer, Rgb};
use rayon::prelude::*;
use std::error::Error;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

const TILE_ROWS: usize = 8;

#[derive(Debug)]
struct Config {
    width: usize,
    height: usize,
    max_iterations: u32,
    center_x: f64,
    center_y: f64,
    vertical_span: f64,
    output: PathBuf,
    csv: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug)]
#[repr(u8)]
enum PixelClass {
    MainCardioid = 0,
    PeriodTwoBulb = 1,
    Escaped = 2,
    Unresolved = 3,
}

#[derive(Clone, Copy)]
struct PixelSample {
    iterations: u32,
    class: PixelClass,
    smooth_iterations: f64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error}");
        eprintln!("Run `mandelbrot-lab --help` for usage.");
        std::process::exit(2);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let config = parse_args()?;
    let pixel_count = config
        .width
        .checked_mul(config.height)
        .ok_or("image dimensions overflow the addressable size")?;
    let row_bytes = config.width.checked_mul(3).ok_or("row size overflow")?;

    let mut pixels = vec![0_u8; pixel_count.checked_mul(3).ok_or("image buffer too large")?];
    let mut samples = vec![PixelSample {
        iterations: 0,
        class: PixelClass::Unresolved,
        smooth_iterations: 0.0,
    }; pixel_count];

    let start = Instant::now();
    pixels
        .par_chunks_mut(row_bytes * TILE_ROWS)
        .zip(samples.par_chunks_mut(config.width * TILE_ROWS))
        .enumerate()
        .for_each(|(tile_index, (rgb_tile, sample_tile))| {
            let first_y = tile_index * TILE_ROWS;
            let tile_height = sample_tile.len() / config.width;

            for local_y in 0..tile_height {
                let y = first_y + local_y;
                let sample_row = &mut sample_tile[local_y * config.width..(local_y + 1) * config.width];
                let rgb_row = &mut rgb_tile[local_y * row_bytes..(local_y + 1) * row_bytes];

                for x in 0..config.width {
                    let c = pixel_to_complex(x, y, &config);
                    let sample = mandelbrot_sample(c, config.max_iterations);
                    sample_row[x] = sample;

                    let color = colorize(sample);
                    let offset = x * 3;
                    rgb_row[offset..offset + 3].copy_from_slice(&color);
                }
            }
        });
    let elapsed = start.elapsed();

    let image = ImageBuffer::<Rgb<u8>, _>::from_raw(
        config.width as u32,
        config.height as u32,
        pixels,
    )
    .expect("buffer dimensions were checked before rendering");
    image.save(&config.output)?;

    let mut counts = [0_u64; 4];
    for sample in &samples {
        counts[sample.class as usize] += 1;
    }
    let rendered_pixels = pixel_count as f64;
    println!("Image: {} x {}", config.width, config.height);
    println!("Saved PNG: {}", config.output.display());
    println!("Elapsed: {:.3} s ({:.0} pixels/s)", elapsed.as_secs_f64(), rendered_pixels / elapsed.as_secs_f64());
    println!("Certified main-cardioid pixels: {}", counts[PixelClass::MainCardioid as usize]);
    println!("Certified period-2 bulb pixels: {}", counts[PixelClass::PeriodTwoBulb as usize]);
    println!("Escaped pixels: {}", counts[PixelClass::Escaped as usize]);
    println!("Unresolved at iteration limit: {}", counts[PixelClass::Unresolved as usize]);

    if let Some(path) = config.csv {
        write_csv(&path, config.width, config.height, &samples)?;
        println!("Saved sample data: {}", path.display());
    }

    Ok(())
}

fn parse_args() -> Result<Config, String> {
    let mut config = Config {
        width: 1200,
        height: 800,
        max_iterations: 1000,
        center_x: -0.5,
        center_y: 0.0,
        vertical_span: 2.5,
        output: PathBuf::from("mandelbrot.png"),
        csv: None,
    };

    let args: Vec<String> = std::env::args().collect();
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--width" => config.width = parse_next(&args, &mut index, "--width")?,
            "--height" => config.height = parse_next(&args, &mut index, "--height")?,
            "--max-iter" => config.max_iterations = parse_next(&args, &mut index, "--max-iter")?,
            "--center-x" => config.center_x = parse_next(&args, &mut index, "--center-x")?,
            "--center-y" => config.center_y = parse_next(&args, &mut index, "--center-y")?,
            "--span" => config.vertical_span = parse_next(&args, &mut index, "--span")?,
            "--output" => config.output = PathBuf::from(parse_next::<String>(&args, &mut index, "--output")?),
            "--csv" => config.csv = Some(PathBuf::from(parse_next::<String>(&args, &mut index, "--csv")?)),
            unknown => return Err(format!("unknown option `{unknown}`")),
        }
        index += 1;
    }

    if config.width == 0 || config.height == 0 {
        return Err("width and height must be greater than zero".into());
    }
    if config.max_iterations == 0 {
        return Err("max iterations must be greater than zero".into());
    }
    if !config.vertical_span.is_finite() || config.vertical_span <= 0.0 {
        return Err("span must be a finite positive number".into());
    }
    if !config.center_x.is_finite() || !config.center_y.is_finite() {
        return Err("center coordinates must be finite numbers".into());
    }
    if config.width > u32::MAX as usize || config.height > u32::MAX as usize {
        return Err("PNG dimensions must fit in a 32-bit unsigned integer".into());
    }

    Ok(config)
}

fn parse_next<T: std::str::FromStr>(args: &[String], index: &mut usize, option: &str) -> Result<T, String> {
    *index += 1;
    let value = args.get(*index).ok_or_else(|| format!("{option} requires a value"))?;
    value.parse().map_err(|_| format!("invalid value `{value}` for {option}"))
}

fn print_help() {
    println!(
        "Mandelbrot Lab — parallel renderer and computational fractal experiment\n\n\
         Usage: mandelbrot-lab [options]\n\n\
         Options:\n\
           --width N       Image width (default: 1200)\n\
           --height N      Image height (default: 800)\n\
           --max-iter N    Maximum orbit iterations (default: 1000)\n\
           --center-x X    View center, real coordinate (default: -0.5)\n\
           --center-y Y    View center, imaginary coordinate (default: 0)\n\
           --span N        Vertical complex-plane span (default: 2.5)\n\
           --output FILE   PNG output path (default: mandelbrot.png)\n\
           --csv FILE      Export per-pixel classification and escape count\n\
           -h, --help      Show this help"
    );
}

fn pixel_to_complex(x: usize, y: usize, config: &Config) -> (f64, f64) {
    let units_per_pixel = config.vertical_span / config.height as f64;
    let real = config.center_x + (x as f64 + 0.5 - config.width as f64 / 2.0) * units_per_pixel;
    let imaginary = config.center_y - (y as f64 + 0.5 - config.height as f64 / 2.0) * units_per_pixel;
    (real, imaginary)
}

fn mandelbrot_sample(c: (f64, f64), max_iterations: u32) -> PixelSample {
    let (x, y) = c;

    if inside_main_cardioid(x, y) {
        return PixelSample { iterations: max_iterations, class: PixelClass::MainCardioid, smooth_iterations: 0.0 };
    }
    if inside_period_two_bulb(x, y) {
        return PixelSample { iterations: max_iterations, class: PixelClass::PeriodTwoBulb, smooth_iterations: 0.0 };
    }

    let (mut z_re, mut z_im) = (0.0_f64, 0.0_f64);
    let mut iteration = 0;
    let mut magnitude_squared = 0.0;

    while iteration < max_iterations && magnitude_squared <= 4.0 {
        let next_re = z_re * z_re - z_im * z_im + x;
        let next_im = 2.0 * z_re * z_im + y;
        z_re = next_re;
        z_im = next_im;
        magnitude_squared = z_re * z_re + z_im * z_im;
        iteration += 1;
    }

    if magnitude_squared > 4.0 {
        let log_abs_z = 0.5 * magnitude_squared.ln();
        let smooth = iteration as f64 + 1.0 - (log_abs_z.ln() / std::f64::consts::LN_2);
        PixelSample { iterations: iteration, class: PixelClass::Escaped, smooth_iterations: smooth }
    } else {
        PixelSample { iterations: iteration, class: PixelClass::Unresolved, smooth_iterations: 0.0 }
    }
}

fn inside_main_cardioid(x: f64, y: f64) -> bool {
    let shifted_x = x - 0.25;
    let q = shifted_x * shifted_x + y * y;
    q * (q + shifted_x) <= 0.25 * y * y
}

fn inside_period_two_bulb(x: f64, y: f64) -> bool {
    (x + 1.0) * (x + 1.0) + y * y <= 1.0 / 16.0
}

fn colorize(sample: PixelSample) -> [u8; 3] {
    match sample.class {
        PixelClass::MainCardioid | PixelClass::PeriodTwoBulb => [0, 0, 0],
        PixelClass::Unresolved => [18, 12, 34],
        PixelClass::Escaped => {
            let t = sample.smooth_iterations.max(0.0);
            let wave = |phase: f64| -> u8 {
                let value = 0.5 + 0.5 * (0.16 * t + phase).cos();
                (255.0 * value) as u8
            };
            [wave(0.0), wave(2.1), wave(4.2)]
        }
    }
}

fn write_csv(path: &PathBuf, width: usize, height: usize, samples: &[PixelSample]) -> Result<(), Box<dyn Error>> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    writeln!(writer, "x,y,class,iterations")?;
    for y in 0..height {
        for x in 0..width {
            let sample = samples[y * width + x];
            let class_name = match sample.class {
                PixelClass::MainCardioid => "main_cardioid",
                PixelClass::PeriodTwoBulb => "period_two_bulb",
                PixelClass::Escaped => "escaped",
                PixelClass::Unresolved => "unresolved_at_limit",
            };
            writeln!(writer, "{x},{y},{class_name},{}", sample.iterations)?;
        }
    }
    writer.flush()?;
    Ok(())
}
