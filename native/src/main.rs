use anyhow::{Context, Result, bail, ensure};
use clap::{ArgGroup, Parser, Subcommand};
use image::{DynamicImage, ImageDecoder, ImageReader};
use ort::{
    session::{
        Session,
        builder::{AutoDevicePolicy, GraphOptimizationLevel},
    },
    value::Tensor,
};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Instant,
};

const SIDE: usize = 224;
const ELEMENTS: usize = 3 * SIDE * SIDE;
const PREPROCESS: &str = "v2-whole224-bilinear-imagenet";
const RESAMPLER: &str = "kururi-bilinear-pillow13-rgb8";
mod resample;

#[derive(Parser, Debug)]
#[command(
    version,
    about = "Local image-orientation inference. Images are read only unless --output is supplied."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    #[command(about = "Predict clockwise correction from pixels (or an audit tensor).")]
    Predict(Args),
}

#[derive(clap::Args, Debug)]
#[command(group(ArgGroup::new("input").required(true).args(["image", "tensor", "dir"])))]
struct Args {
    #[arg(help = "ONNX model path. Its external-data file must remain beside it.")]
    #[arg(long, required_unless_present = "preprocess_only")]
    model: Option<PathBuf>,
    #[arg(
        help = "ONNX Runtime 1.31 library. Defaults to ORT_DYLIB_PATH or an executable sibling."
    )]
    #[arg(long)]
    runtime_library: Option<PathBuf>,
    #[arg(help = "Original JPEG/PNG/WebP/TIFF/BMP image; EXIF orientation is applied first.")]
    #[arg(long)]
    image: Option<PathBuf>,
    #[arg(help = "Recursively process supported images, sorted by path. Symlinks are skipped.")]
    #[arg(long)]
    dir: Option<PathBuf>,
    #[arg(help = "Already preprocessed little-endian f32 NCHW tensor [1,3,224,224].")]
    #[arg(long)]
    tensor: Option<PathBuf>,
    #[arg(help = "ONNX Runtime intra-op thread count. Zero selects available CPUs, capped at 8.")]
    #[arg(long, default_value_t = 0)]
    threads: usize,
    #[arg(help = "Untimed warmup forwards. Zero preserves first-inference measurement.")]
    #[arg(long, default_value_t = 0)]
    warmup: usize,
    #[arg(help = "Number of timed forward passes. Each pass uses the same input.")]
    #[arg(long, default_value_t = 1)]
    runs: usize,
    #[arg(
        long,
        help = "Override model-recommended views with 1 or 4. Four views average aligned probabilities."
    )]
    views: Option<usize>,
    #[arg(help = "Write the actual native preprocessed f32 tensor for parity analysis.")]
    #[arg(long, conflicts_with = "dir")]
    write_input: Option<PathBuf>,
    #[arg(help = "Decode/preprocess and optionally write the tensor without loading a model.")]
    #[arg(long, requires = "image", conflicts_with_all = ["tensor", "dir"])]
    preprocess_only: bool,
    #[arg(help = "Save corrected pixels to a NEW path. Existing files are never overwritten.")]
    #[arg(long, requires = "image", conflicts_with_all = ["preprocess_only", "tensor", "dir"])]
    output: Option<PathBuf>,
    #[arg(help = "Save corrected directory images under a NEW directory, preserving subpaths.")]
    #[arg(long, requires = "dir", conflicts_with_all = ["image", "tensor"])]
    output_dir: Option<PathBuf>,
    #[arg(help = "Below this softmax confidence, abstain and do not save corrected pixels.")]
    #[arg(long, default_value_t = 0.0)]
    min_confidence: f32,
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn open_image(path: &Path) -> Result<(DynamicImage, u8)> {
    let mut decoder = ImageReader::open(path)?
        .with_guessed_format()?
        .into_decoder()?;
    let orientation = decoder
        .orientation()
        .context("Cannot read image orientation")?;
    let exif = orientation.to_exif();
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    Ok((image, exif))
}

fn prepare(image: &DynamicImage) -> Vec<f32> {
    let resized = resample::resize_rgb8(&image.to_rgb8(), SIDE as u32, SIDE as u32);
    let means = [0.485_f32, 0.456, 0.406];
    let stds = [0.229_f32, 0.224, 0.225];
    let mut data = vec![0.0_f32; ELEMENTS];
    for (index, pixel) in resized.pixels().enumerate() {
        for channel in 0..3 {
            data[channel * SIDE * SIDE + index] =
                (pixel[channel] as f32 / 255.0 - means[channel]) / stds[channel];
        }
    }
    data
}

fn read_tensor(path: &Path) -> Result<Vec<f32>> {
    let bytes = fs::read(path)?;
    ensure!(
        bytes.len() == ELEMENTS * 4,
        "Expected {} input bytes, got {}",
        ELEMENTS * 4,
        bytes.len()
    );
    let values: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("four-byte chunk")))
        .collect();
    ensure!(
        values.iter().all(|x| x.is_finite()),
        "Input tensor contains nonfinite values"
    );
    Ok(values)
}

fn write_tensor(path: &Path, data: &[f32]) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("Cannot create new tensor file {}", path.display()))?;
    for value in data {
        file.write_all(&value.to_le_bytes())?;
    }
    Ok(())
}

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| {
            matches!(
                s.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "tif" | "tiff" | "bmp"
            )
        })
        .unwrap_or(false)
}

fn collect_images(root: &Path, files: &mut Vec<PathBuf>, skipped: &mut usize) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            *skipped += 1;
        } else if kind.is_dir() {
            collect_images(&entry.path(), files, skipped)?;
        } else if kind.is_file() && supported(&entry.path()) {
            files.push(entry.path());
        } else {
            *skipped += 1;
        }
    }
    Ok(())
}

fn corrected(image: &DynamicImage, class: usize) -> Result<DynamicImage> {
    Ok(match class {
        0 => image.clone(),
        1 => image.rotate90(),
        2 => image.rotate180(),
        3 => image.rotate270(),
        _ => bail!("invalid class"),
    })
}

fn rotate_chw(data: &[f32], quarters_cw: usize) -> Vec<f32> {
    let mut result = vec![0.0_f32; ELEMENTS];
    for channel in 0..3 {
        for y in 0..SIDE {
            for x in 0..SIDE {
                let (source_y, source_x) = match quarters_cw % 4 {
                    0 => (y, x),
                    1 => (SIDE - 1 - x, y),
                    2 => (SIDE - 1 - y, SIDE - 1 - x),
                    _ => (x, SIDE - 1 - y),
                };
                result[channel * SIDE * SIDE + y * SIDE + x] =
                    data[channel * SIDE * SIDE + source_y * SIDE + source_x];
            }
        }
    }
    result
}

fn average_aligned_probabilities(view_logits: &[Vec<f32>]) -> Result<Vec<f32>> {
    let mut probabilities = vec![0.0_f32; 4];
    for (view, logits) in view_logits.iter().enumerate() {
        ensure!(
            logits.len() == 4 && logits.iter().all(|x| x.is_finite()),
            "Model produced invalid or nonfinite logits"
        );
        let maximum = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let exp: Vec<f32> = logits.iter().map(|x| (x - maximum).exp()).collect();
        let denominator: f32 = exp.iter().sum();
        for class in 0..4 {
            probabilities[(class + view) % 4] +=
                exp[class] / denominator / view_logits.len() as f32;
        }
    }
    Ok(probabilities)
}

fn process_one(
    args: &Args,
    path: &Path,
    is_tensor: bool,
    output: Option<&Path>,
    mut session: Option<&mut Session>,
) -> Result<Value> {
    let started = Instant::now();
    if !is_tensor {
        ensure!(
            supported(path),
            "Unsupported image format {}; supported: JPEG, PNG, WebP, TIFF, BMP",
            path.display()
        );
    }
    let input_started = Instant::now();
    let mut original = None;
    let mut exif_orientation = None;
    let input = if !is_tensor {
        let (image, exif) =
            open_image(path).with_context(|| format!("Cannot decode {}", path.display()))?;
        let data = prepare(&image);
        original = Some(image);
        exif_orientation = Some(exif);
        data
    } else {
        read_tensor(path)?
    };
    let input_ms = ms(input_started);
    if let Some(path) = &args.write_input {
        write_tensor(path, &input)?;
    }
    if args.preprocess_only {
        return Ok(json!({
            "scope": "image_decode_and_preprocess_only",
            "preprocess": PREPROCESS, "resampler": RESAMPLER,
            "input_shape": [1, 3, SIDE, SIDE], "exif_orientation": exif_orientation,
            "input_ms": input_ms, "item_total_ms": ms(started)
        }));
    }
    let session = session
        .as_mut()
        .expect("session present outside preprocess mode");
    let views = args.views.expect("views resolved from model metadata");
    let views_started = Instant::now();
    let inputs: Vec<Tensor<f32>> = (0..views)
        .map(|view| {
            Tensor::from_array((
                [1_usize, 3, SIDE, SIDE],
                rotate_chw(&input, view).into_boxed_slice(),
            ))
        })
        .collect::<std::result::Result<_, _>>()?;
    let tensor_views_ms = ms(views_started);
    for _ in 0..args.warmup {
        for input in &inputs {
            let _ = session.run(ort::inputs![input])?;
        }
    }
    let mut runs_ms = Vec::with_capacity(args.runs);
    let mut per_view_ms = Vec::with_capacity(args.runs);
    let mut view_logits = Vec::new();
    for _ in 0..args.runs {
        let started = Instant::now();
        let mut view_times = Vec::with_capacity(views);
        view_logits.clear();
        for input in &inputs {
            let view_started = Instant::now();
            let outputs = session.run(ort::inputs![input])?;
            view_times.push(ms(view_started));
            let (shape, values) = outputs[0].try_extract_tensor::<f32>()?;
            ensure!(
                **shape == [1_i64, 4],
                "Expected logits shape [1,4], got {shape:?}"
            );
            view_logits.push(values.to_vec());
        }
        runs_ms.push(ms(started));
        per_view_ms.push(view_times);
    }
    let probabilities = average_aligned_probabilities(&view_logits)?;
    let class = probabilities
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(index, _)| index)
        .expect("four output classes");
    let accepted = probabilities[class] >= args.min_confidence;
    let mut save_ms = None;
    if let Some(output) = output
        && accepted
    {
        let started = Instant::now();
        let image = original.as_ref().expect("image required for output");
        let corrected = corrected(image, class)?;
        ensure!(
            supported(output),
            "Unsupported output format {}; supported: JPEG, PNG, WebP, TIFF, BMP",
            output.display()
        );
        let format = image::ImageFormat::from_path(output)?;
        let parent = output
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let mut staged = tempfile::NamedTempFile::new_in(parent)?;
        {
            let mut file = std::io::BufWriter::new(staged.as_file_mut());
            corrected.write_to(&mut file, format)?;
            file.flush()?;
        }
        staged.persist_noclobber(output).map_err(|error| {
            anyhow::anyhow!("Cannot save new output {}: {error}", output.display())
        })?;
        save_ms = Some(ms(started));
    }
    Ok(json!({
        "scope": if !is_tensor {"native_image_cli"} else {"raw_tensor_inference_harness"},
        "includes_image_decode": !is_tensor,
        "preprocess": if !is_tensor {Some(PREPROCESS)} else {None},
        "resampler": if !is_tensor {Some(RESAMPLER)} else {None},
        "input_shape": [1,3,SIDE,SIDE], "exif_orientation": exif_orientation,
        "input_ms": input_ms, "tensor_views_ms": tensor_views_ms, "inference_ms": runs_ms,
        "per_view_inference_ms": per_view_ms, "views": views,
        "total_forward_passes": (args.warmup + args.runs) * views,
        "save_ms": save_ms, "item_total_ms": ms(started),
        "logits": if views == 1 {Some(&view_logits[0])} else {None},
        "view_logits": view_logits, "probabilities": probabilities,
        "class": class, "correction_cw": class * 90,
        "accepted": accepted, "min_confidence": args.min_confidence,
        "saved": output.is_some() && accepted
    }))
}

fn main() -> Result<()> {
    let total = Instant::now();
    let Command::Predict(mut args) = Cli::parse().command;
    if args.threads == 0 {
        args.threads = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
            .min(8);
    }
    ensure!(
        args.threads > 0 && args.runs > 0,
        "--threads and --runs must be positive"
    );
    ensure!(
        args.views.is_none() || args.views == Some(1) || args.views == Some(4),
        "--views must be 1 or 4"
    );
    ensure!(
        (0.0..=1.0).contains(&args.min_confidence),
        "--min-confidence must be between 0 and 1"
    );
    for output in [&args.output, &args.output_dir, &args.write_input]
        .into_iter()
        .flatten()
    {
        ensure!(
            !output.exists(),
            "Refusing to overwrite existing output {}",
            output.display()
        );
    }
    if args.preprocess_only {
        let mut result = process_one(&args, args.image.as_ref().unwrap(), false, None, None)?;
        result["internal_total_ms"] = json!(ms(total));
        println!("{result}");
        return Ok(());
    }
    let env_started = Instant::now();
    let runtime_library = args
        .runtime_library
        .clone()
        .or_else(|| std::env::var_os("ORT_DYLIB_PATH").map(PathBuf::from))
        .unwrap_or_else(|| {
            let filename = if cfg!(target_os = "macos") {
                "libonnxruntime.dylib"
            } else if cfg!(target_os = "windows") {
                "onnxruntime.dll"
            } else {
                "libonnxruntime.so"
            };
            std::env::current_exe()
                .expect("executable path")
                .with_file_name(filename)
        });
    ensure!(
        runtime_library.is_file(),
        "Missing ONNX Runtime 1.31 library {}; use --runtime-library or ORT_DYLIB_PATH",
        runtime_library.display()
    );
    let env = ort::init_from(&runtime_library)?
        .with_name("kururi-native")
        .with_telemetry(false)
        .build()?;
    let environment_ms = ms(env_started);
    let session_started = Instant::now();
    let mut session = Session::builder(&env)?
        .with_auto_device(AutoDevicePolicy::PreferCPU)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .with_intra_threads(args.threads)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .with_inter_threads(1)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .commit_from_file(args.model.as_ref().expect("clap enforces model"))?;
    let session_load_ms = ms(session_started);
    let recommended_views = session
        .metadata()?
        .custom("kururi.recommended_views")
        .map(|value| value.parse::<usize>())
        .transpose()?
        .unwrap_or(1);
    ensure!(
        recommended_views == 1 || recommended_views == 4,
        "Unsupported model recommended_views"
    );
    args.views.get_or_insert(recommended_views);
    if args.tensor.is_none() {
        let metadata = session.metadata()?;
        ensure!(
            metadata.custom("kururi.preprocess").as_deref() == Some(PREPROCESS),
            "Image mode requires model metadata kururi.preprocess={PREPROCESS}; use --tensor for other models"
        );
        ensure!(
            metadata.custom("kururi.class_order").as_deref() == Some("0,90,180,270"),
            "Unsupported class order"
        );
        ensure!(
            metadata.custom("kururi.class_semantics").as_deref()
                == Some("correction_clockwise_degrees"),
            "Unsupported class semantics"
        );
    }
    let mut errors = 0;
    let mut result = if let Some(root) = &args.dir {
        ensure!(root.is_dir(), "--dir must be an existing directory");
        let mut files = Vec::new();
        let mut skipped = 0;
        collect_images(root, &mut files, &mut skipped)?;
        files.sort();
        ensure!(
            !files.is_empty(),
            "No supported images found in {}",
            root.display()
        );
        if let Some(output_root) = &args.output_dir {
            fs::create_dir(output_root)?;
        }
        let mut results = Vec::with_capacity(files.len());
        for path in files {
            let relative = path.strip_prefix(root)?;
            let output = args
                .output_dir
                .as_ref()
                .map(|destination| destination.join(relative));
            match process_one(&args, &path, false, output.as_deref(), Some(&mut session)) {
                Ok(mut item) => {
                    item["path"] = json!(relative);
                    results.push(item);
                }
                Err(error) => {
                    errors += 1;
                    results.push(json!({"path":relative, "error":format!("{error:#}")}));
                }
            }
        }
        json!({"scope":"native_image_directory", "session_reused":true, "results":results,
               "error_count":errors, "skipped_unsupported_or_symlink_entries":skipped})
    } else {
        let path = args
            .image
            .as_ref()
            .or(args.tensor.as_ref())
            .expect("clap enforces input");
        process_one(
            &args,
            path,
            args.tensor.is_some(),
            args.output.as_deref(),
            Some(&mut session),
        )?
    };
    result["backend"] = json!("ONNX Runtime CPU");
    result["ort_crate"] = json!("2.0.0-rc.15");
    result["ort_runtime_api"] = json!(31);
    result["ort_runtime_build"] = json!(ort::info());
    result["threads"] = json!(args.threads);
    result["warmup"] = json!(args.warmup);
    result["runs"] = json!(args.runs);
    result["views"] = json!(args.views);
    result["recommended_views"] = json!(recommended_views);
    result["experimental_views_override"] = json!(args.views != Some(recommended_views));
    result["environment_ms"] = json!(environment_ms);
    result["session_load_ms"] = json!(session_load_ms);
    result["internal_total_ms"] = json!(ms(total));
    println!("{result}");
    if errors > 0 {
        std::process::exit(2);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    #[test]
    fn channels_are_nchw_and_imagenet_normalized() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(400, 100, Rgb([255, 0, 128])));
        let data = prepare(&image);
        assert_eq!(data.len(), ELEMENTS);
        let expected = [
            (1.0 - 0.485) / 0.229,
            -0.456 / 0.224,
            (128.0 / 255.0 - 0.406) / 0.225,
        ];
        for channel in 0..3 {
            assert!(
                data[channel * SIDE * SIDE..(channel + 1) * SIDE * SIDE]
                    .iter()
                    .all(|x| (*x - expected[channel]).abs() < 1e-6)
            );
        }
    }

    #[test]
    fn correction_classes_rotate_clockwise() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_fn(2, 3, |x, y| {
            Rgb([(y * 2 + x) as u8, 0, 0])
        }));
        let right = corrected(&image, 1).unwrap().to_rgb8();
        assert_eq!(right.dimensions(), (3, 2));
        assert_eq!(right.get_pixel(2, 0)[0], 0);
        assert_eq!(right.get_pixel(0, 1)[0], 5);
        let restored = corrected(&DynamicImage::ImageRgb8(right), 3).unwrap();
        assert_eq!(restored.to_rgb8(), image.to_rgb8());
        assert!(corrected(&image, 4).is_err());
    }

    #[test]
    fn four_view_alignment_preserves_base_correction() {
        let input: Vec<f32> = (0..ELEMENTS).map(|index| index as f32).collect();
        let right = rotate_chw(&input, 1);
        assert_eq!(right[0], input[(SIDE - 1) * SIDE]);
        assert_eq!(rotate_chw(&right, 3), input);
        for base in 0..4 {
            let logits: Vec<Vec<f32>> = (0..4)
                .map(|view| {
                    let mut values = vec![0.0_f32; 4];
                    values[(base + 4 - view) % 4] = 10.0;
                    values
                })
                .collect();
            let probabilities = average_aligned_probabilities(&logits).unwrap();
            assert!(probabilities[base] > 0.999);
            assert!((probabilities.iter().sum::<f32>() - 1.0).abs() < 1e-6);
        }
        assert!(average_aligned_probabilities(&[vec![f32::NAN; 4]]).is_err());
    }

    #[test]
    fn cli_requires_exactly_one_input_and_protects_output_modes() {
        assert!(
            Cli::try_parse_from([
                "kururi-native",
                "predict",
                "--model",
                "m.onnx",
                "--image",
                "x.jpg"
            ])
            .is_ok()
        );
        assert!(
            Cli::try_parse_from([
                "kururi-native",
                "predict",
                "--model",
                "m.onnx",
                "--image",
                "x.jpg",
                "--dir",
                "images"
            ])
            .is_err()
        );
        assert!(
            Cli::try_parse_from([
                "kururi-native",
                "predict",
                "--model",
                "m.onnx",
                "--tensor",
                "x.f32",
                "--output",
                "x.jpg"
            ])
            .is_err()
        );
        assert!(
            Cli::try_parse_from([
                "kururi-native",
                "predict",
                "--image",
                "x.jpg",
                "--preprocess-only"
            ])
            .is_ok()
        );
    }
}
