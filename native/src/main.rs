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
    #[arg(
        long,
        help = "ONNX model path; repeat for an ensemble. Its external-data file must remain beside it."
    )]
    #[arg(required_unless_present = "preprocess_only")]
    model: Vec<PathBuf>,
    #[arg(
        long,
        help = "Ensemble weight for the corresponding --model. Defaults to 1 for each model."
    )]
    model_weight: Vec<f32>,
    #[arg(
        long,
        help = "Optional third model invoked only when the general ensemble is uncertain."
    )]
    fallback_model: Option<PathBuf>,
    #[arg(long, default_value_t = 0.1)]
    fallback_weight: f32,
    #[arg(
        long,
        default_value_t = 0.033_333_333,
        help = "Invoke the fallback when top1-top2 probability margin is below this value."
    )]
    fallback_margin: f32,
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
    #[arg(help = "Already preprocessed little-endian f32 CHW tensor for same-size models.")]
    #[arg(long)]
    tensor: Option<PathBuf>,
    #[arg(help = "Total ONNX Runtime thread budget. Zero selects available CPUs, capped at 12.")]
    #[arg(long, default_value_t = 0)]
    threads: usize,
    #[arg(
        long,
        help = "Run independent general-model inferences concurrently and split --threads among them."
    )]
    parallel_models: bool,
    #[arg(help = "Untimed warmup forwards. Zero preserves first-inference measurement.")]
    #[arg(long, default_value_t = 0)]
    warmup: usize,
    #[arg(help = "Number of timed forward passes. Each pass uses the same input.")]
    #[arg(long, default_value_t = 1)]
    runs: usize,
    #[arg(
        long,
        help = "Use 1 or 4 rotation views; defaults to the model metadata."
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

struct RuntimeModel {
    path: PathBuf,
    weight: f32,
    input_size: usize,
    batch_size: usize,
    views: usize,
    recommended_views: usize,
    session: Session,
}

struct DeferredModel {
    path: PathBuf,
    weight: f32,
    threads: usize,
    requested_views: Option<usize>,
    loaded: Option<RuntimeModel>,
}

struct ModelRun {
    probabilities: Vec<f32>,
    logits: Vec<Vec<f32>>,
    inference_ms: Vec<f64>,
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn elements(side: usize) -> usize {
    3 * side * side
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

fn prepare(image: &DynamicImage, side: usize) -> Vec<f32> {
    let resized = resample::resize_rgb8(&image.to_rgb8(), side as u32, side as u32);
    let means = [0.485_f32, 0.456, 0.406];
    let stds = [0.229_f32, 0.224, 0.225];
    let mut data = vec![0.0_f32; elements(side)];
    for (index, pixel) in resized.pixels().enumerate() {
        for channel in 0..3 {
            data[channel * side * side + index] =
                (pixel[channel] as f32 / 255.0 - means[channel]) / stds[channel];
        }
    }
    data
}

fn read_tensor(path: &Path, side: usize) -> Result<Vec<f32>> {
    let bytes = fs::read(path)?;
    let expected_elements = elements(side);
    ensure!(
        bytes.len() == expected_elements * 4,
        "Expected {} input bytes, got {}",
        expected_elements * 4,
        bytes.len()
    );
    let values: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
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

fn rotate_chw(data: &[f32], side: usize, quarters_cw: usize) -> Vec<f32> {
    let mut result = vec![0.0_f32; elements(side)];
    for channel in 0..3 {
        for y in 0..side {
            for x in 0..side {
                let (source_y, source_x) = match quarters_cw % 4 {
                    0 => (y, x),
                    1 => (side - 1 - x, y),
                    2 => (side - 1 - y, side - 1 - x),
                    _ => (x, side - 1 - y),
                };
                result[channel * side * side + y * side + x] =
                    data[channel * side * side + source_y * side + source_x];
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

fn extract_logits(
    outputs: &ort::session::SessionOutputs<'_>,
    batch: usize,
) -> Result<Vec<Vec<f32>>> {
    let (shape, values) = outputs[0].try_extract_tensor::<f32>()?;
    ensure!(
        **shape == [batch as i64, 4_i64],
        "Expected logits shape [{batch},4], got {shape:?}"
    );
    Ok(values
        .as_chunks::<4>()
        .0
        .iter()
        .map(|row| row.to_vec())
        .collect())
}

fn run_model(
    model: &mut RuntimeModel,
    input: &[f32],
    warmup: usize,
    runs: usize,
) -> Result<ModelRun> {
    ensure!(
        input.len() == elements(model.input_size),
        "Input tensor size {} does not match {}-pixel model {}",
        input.len(),
        model.input_size,
        model.path.display()
    );
    let inputs = if model.batch_size == 4 {
        let mut batch = Vec::with_capacity(4 * input.len());
        for view in 0..4 {
            batch.extend_from_slice(&rotate_chw(input, model.input_size, view));
        }
        vec![
            Tensor::from_array((
                [4_usize, 3, model.input_size, model.input_size],
                batch.into_boxed_slice(),
            ))
            .with_context(|| format!("Cannot allocate input for {}", model.path.display()))?,
        ]
    } else {
        (0..model.views)
            .map(|view| {
                Tensor::from_array((
                    [1_usize, 3, model.input_size, model.input_size],
                    rotate_chw(input, model.input_size, view).into_boxed_slice(),
                ))
                .with_context(|| format!("Cannot allocate input for {}", model.path.display()))
            })
            .collect::<Result<Vec<_>>>()?
    };
    for _ in 0..warmup {
        for input in &inputs {
            model
                .session
                .run(ort::inputs![input])
                .with_context(|| format!("Warmup inference failed for {}", model.path.display()))?;
        }
    }
    let mut inference_ms = Vec::with_capacity(runs);
    let mut logits = Vec::with_capacity(model.views);
    for _ in 0..runs {
        let started = Instant::now();
        logits.clear();
        if model.batch_size == 4 {
            let outputs = model
                .session
                .run(ort::inputs![&inputs[0]])
                .with_context(|| format!("Inference failed for {}", model.path.display()))?;
            logits = extract_logits(&outputs, 4)?;
        } else {
            for input in &inputs {
                let outputs = model
                    .session
                    .run(ort::inputs![input])
                    .with_context(|| format!("Inference failed for {}", model.path.display()))?;
                logits.extend(extract_logits(&outputs, 1)?);
            }
        }
        inference_ms.push(ms(started));
    }
    ensure!(
        logits.len() == model.views,
        "Model returned {} views, expected {}",
        logits.len(),
        model.views
    );
    let probabilities = average_aligned_probabilities(&logits)
        .with_context(|| format!("Invalid output from {}", model.path.display()))?;
    Ok(ModelRun {
        probabilities,
        logits,
        inference_ms,
    })
}

fn load_runtime_model(
    env: &ort::environment::Environment,
    path: &Path,
    weight: f32,
    threads: usize,
    requested_views: Option<usize>,
) -> Result<(RuntimeModel, usize)> {
    let session = Session::builder(env)?
        .with_auto_device(AutoDevicePolicy::PreferCPU)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .with_intra_threads(threads)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .with_inter_threads(1)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .commit_from_file(path)
        .with_context(|| format!("Cannot load ONNX model {}", path.display()))?;
    let metadata = session.metadata()?;
    let input_size = metadata
        .custom("kururi.input_size")
        .unwrap_or_else(|| "224".to_string())
        .parse::<usize>()
        .with_context(|| format!("Invalid input size metadata in {}", path.display()))?;
    ensure!(
        input_size > 0,
        "Invalid input size metadata in {}",
        path.display()
    );
    let batch_size = metadata
        .custom("kururi.batch_size")
        .unwrap_or_else(|| "1".to_string())
        .parse::<usize>()
        .with_context(|| format!("Invalid batch size metadata in {}", path.display()))?;
    ensure!(
        batch_size == 1 || batch_size == 4,
        "Unsupported batch size {batch_size} in {}",
        path.display()
    );
    let recommended_views = metadata
        .custom("kururi.recommended_views")
        .unwrap_or_else(|| "1".to_string())
        .parse::<usize>()
        .with_context(|| format!("Invalid recommended views in {}", path.display()))?;
    ensure!(
        recommended_views == 1 || recommended_views == 4,
        "Unsupported model recommended_views in {}",
        path.display()
    );
    ensure!(
        batch_size == 1 || recommended_views == 4,
        "A batch-size-4 model must recommend four views: {}",
        path.display()
    );
    ensure!(
        metadata.custom("kururi.preprocess").as_deref() == Some(PREPROCESS),
        "Image mode requires model metadata kururi.preprocess={PREPROCESS}: {}",
        path.display()
    );
    ensure!(
        metadata.custom("kururi.class_order").as_deref() == Some("0,90,180,270"),
        "Unsupported class order in {}",
        path.display()
    );
    ensure!(
        metadata.custom("kururi.class_semantics").as_deref()
            == Some("correction_clockwise_degrees"),
        "Unsupported class semantics in {}",
        path.display()
    );
    let views = match requested_views {
        Some(views) if batch_size == 4 => {
            ensure!(
                views == recommended_views,
                "A batch-size-4 model requires {recommended_views} views, not {views}: {}",
                path.display()
            );
            views
        }
        Some(views) => views,
        None => recommended_views,
    };
    drop(metadata);
    Ok((
        RuntimeModel {
            path: path.to_path_buf(),
            weight,
            input_size,
            batch_size,
            views,
            recommended_views,
            session,
        },
        recommended_views,
    ))
}

impl DeferredModel {
    fn load(
        &mut self,
        env: &ort::environment::Environment,
        expected_views: usize,
    ) -> Result<&mut RuntimeModel> {
        if self.loaded.is_none() {
            let (mut model, _) = load_runtime_model(
                env,
                &self.path,
                self.weight,
                self.threads,
                self.requested_views,
            )?;
            ensure!(
                model.views == expected_views,
                "The fallback model must use {expected_views} views"
            );
            model.weight = self.weight;
            self.loaded = Some(model);
        }
        Ok(self.loaded.as_mut().expect("fallback model loaded"))
    }
}

fn process_one(
    env: Option<&ort::environment::Environment>,
    args: &Args,
    path: &Path,
    is_tensor: bool,
    output: Option<&Path>,
    models: &mut [RuntimeModel],
    mut fallback: Option<&mut DeferredModel>,
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
    let (original, exif_orientation) = if is_tensor {
        ensure!(!models.is_empty(), "--tensor requires at least one --model");
        (None, None)
    } else {
        let (image, exif) =
            open_image(path).with_context(|| format!("Cannot decode {}", path.display()))?;
        (Some(image), Some(exif))
    };
    let input_side = models.first().map_or(SIDE, |model| model.input_size);
    let single_input = if is_tensor {
        Some(read_tensor(path, input_side)?)
    } else if args.preprocess_only {
        Some(prepare(
            original.as_ref().expect("decoded image"),
            input_side,
        ))
    } else {
        None
    };
    let input_ms = ms(input_started);
    if args.preprocess_only {
        let input = single_input.as_ref().expect("preprocessed input");
        if let Some(path) = &args.write_input {
            write_tensor(path, input)?;
        }
        return Ok(json!({
            "scope": "image_decode_and_preprocess_only",
            "preprocess": PREPROCESS, "resampler": RESAMPLER,
            "input_shape": [1, 3, input_side, input_side], "exif_orientation": exif_orientation,
            "input_ms": input_ms, "item_total_ms": ms(started)
        }));
    }
    let inputs = if let Some(input) = single_input {
        vec![input]
    } else {
        let image = original.as_ref().expect("decoded image");
        models
            .iter()
            .map(|model| prepare(image, model.input_size))
            .collect()
    };
    if let Some(path) = &args.write_input {
        ensure!(
            inputs.len() == 1,
            "--write-input requires exactly one model or --preprocess-only"
        );
        write_tensor(path, &inputs[0])?;
    }
    let inference_started = Instant::now();
    let model_runs = if args.parallel_models && models.len() == 2 {
        let (left_models, right_models) = models.split_at_mut(1);
        let (left_inputs, right_inputs) = inputs.split_at(1);
        std::thread::scope(|scope| -> Result<Vec<ModelRun>> {
            let warmup = args.warmup;
            let runs = args.runs;
            let left =
                scope.spawn(move || run_model(&mut left_models[0], &left_inputs[0], warmup, runs));
            let right = scope
                .spawn(move || run_model(&mut right_models[0], &right_inputs[0], warmup, runs));
            let left = left
                .join()
                .map_err(|_| anyhow::anyhow!("The first model worker panicked"))??;
            let right = right
                .join()
                .map_err(|_| anyhow::anyhow!("The second model worker panicked"))??;
            Ok(vec![left, right])
        })?
    } else {
        let mut runs = Vec::with_capacity(models.len());
        for (model, input) in models.iter_mut().zip(&inputs) {
            runs.push(run_model(model, input, args.warmup, args.runs)?);
        }
        runs
    };
    let fallback_input = inputs
        .first()
        .ok_or_else(|| anyhow::anyhow!("No model input"))?;
    let mut weight_sum: f32 = models.iter().map(|model| model.weight).sum();
    ensure!(
        weight_sum.is_finite() && weight_sum > 0.0,
        "Ensemble weights must have a positive finite sum"
    );
    let mut probabilities = vec![0.0_f32; 4];
    for (model, run) in models.iter().zip(&model_runs) {
        for (combined, value) in probabilities.iter_mut().zip(&run.probabilities) {
            *combined += model.weight / weight_sum * value;
        }
    }
    let mut sorted = probabilities.to_vec();
    sorted.sort_by(|left, right| right.total_cmp(left));
    let fallback_used = fallback.is_some() && sorted[0] - sorted[1] < args.fallback_margin;
    let fallback_run = if fallback_used {
        let deferred = fallback.as_deref_mut().expect("fallback checked");
        let expected_views = models.first().map_or(1, |model| model.views);
        let model = deferred.load(
            env.expect("fallback requires ONNX environment"),
            expected_views,
        )?;
        let prepared_input;
        let fallback_input = if is_tensor {
            ensure!(
                fallback_input.len() == elements(model.input_size),
                "Raw tensor size does not match the fallback model"
            );
            fallback_input
        } else {
            prepared_input = prepare(original.as_ref().expect("decoded image"), model.input_size);
            &prepared_input
        };
        let run = run_model(model, fallback_input, args.warmup, args.runs)?;
        let fallback_weight = model.weight;
        weight_sum += fallback_weight;
        ensure!(
            weight_sum.is_finite() && weight_sum > 0.0,
            "Ensemble weights must have a positive finite sum"
        );
        probabilities.fill(0.0);
        for (model, run) in models.iter().zip(&model_runs) {
            for (combined, value) in probabilities.iter_mut().zip(&run.probabilities) {
                *combined += model.weight / weight_sum * value;
            }
        }
        for (combined, value) in probabilities.iter_mut().zip(&run.probabilities) {
            *combined += fallback_weight / weight_sum * value;
        }
        Some(run)
    } else {
        None
    };
    let inference_ms = ms(inference_started);
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
    let views = models.first().map_or(1, |model| model.views);
    let mut model_results: Vec<Value> = models
        .iter()
        .zip(&model_runs)
        .map(|(model, run)| {
            json!({
                "model": model.path.file_name().and_then(|name| name.to_str()).unwrap_or("model.onnx"),
                "weight": model.weight,
                "input_size": model.input_size,
                "batch_size": model.batch_size,
                "views": model.views,
                "inference_ms": run.inference_ms,
                "probabilities": run.probabilities,
                "logits": run.logits
            })
        })
        .collect();
    if let (Some(deferred), Some(run)) = (fallback.as_deref(), fallback_run.as_ref()) {
        let model = deferred
            .loaded
            .as_ref()
            .expect("fallback run implies loaded model");
        model_results.push(json!({
            "model": model.path.file_name().and_then(|name| name.to_str()).unwrap_or("fallback.onnx"),
            "weight": model.weight,
            "input_size": model.input_size,
            "batch_size": model.batch_size,
            "views": model.views,
            "inference_ms": run.inference_ms,
            "probabilities": run.probabilities,
            "logits": run.logits,
            "fallback": true
        }));
    }
    Ok(json!({
        "scope": if !is_tensor {"native_image_cli"} else {"raw_tensor_inference_harness"},
        "includes_image_decode": !is_tensor,
        "preprocess": if !is_tensor {Some(PREPROCESS)} else {None},
        "resampler": if !is_tensor {Some(RESAMPLER)} else {None},
        "input_shapes": models.iter().map(|model| json!([model.batch_size,3,model.input_size,model.input_size])).collect::<Vec<_>>(),
        "exif_orientation": exif_orientation,
        "input_ms": input_ms, "inference_ms": inference_ms, "views": views,
        "models": models.len(), "model_results": model_results,
        "fallback_used": fallback_used, "fallback_margin_threshold": args.fallback_margin,
        "total_forward_passes": (args.warmup + args.runs) * views * (models.len() + usize::from(fallback_used)),
        "save_ms": save_ms, "item_total_ms": ms(started),
        "probabilities": probabilities,
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
            .min(12);
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
        ensure!(
            args.model_weight.is_empty(),
            "--model-weight requires at least one --model"
        );
        let mut result = process_one(
            None,
            &args,
            args.image.as_ref().unwrap(),
            false,
            None,
            &mut [],
            None,
        )?;
        result["internal_total_ms"] = json!(ms(total));
        println!("{result}");
        return Ok(());
    }
    ensure!(!args.model.is_empty(), "At least one --model is required");
    if !args.model_weight.is_empty() {
        ensure!(
            args.model_weight.len() == args.model.len(),
            "Provide one --model-weight per --model"
        );
    } else {
        args.model_weight = vec![1.0; args.model.len()];
    }
    ensure!(
        args.model_weight
            .iter()
            .all(|weight| weight.is_finite() && *weight >= 0.0),
        "--model-weight values must be finite and nonnegative"
    );
    ensure!(
        args.model_weight.iter().sum::<f32>() > 0.0,
        "At least one --model-weight must be positive"
    );
    ensure!(
        args.fallback_weight.is_finite() && args.fallback_weight > 0.0,
        "--fallback-weight must be finite and positive"
    );
    ensure!(
        (0.0..=1.0).contains(&args.fallback_margin),
        "--fallback-margin must be between 0 and 1"
    );
    ensure!(
        !args.preprocess_only || args.model.len() <= 1,
        "--preprocess-only accepts at most one model for input-size selection"
    );
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
    let mut models = Vec::with_capacity(args.model.len());
    let mut resolved_views = args.views;
    let model_threads = if args.parallel_models && args.model.len() > 1 {
        (args.threads / args.model.len()).max(1)
    } else {
        args.threads
    };
    let loaded_models = if args.parallel_models && args.model.len() > 1 {
        std::thread::scope(|scope| -> Result<Vec<(RuntimeModel, usize)>> {
            let handles: Vec<_> = args
                .model
                .iter()
                .zip(&args.model_weight)
                .map(|(path, weight)| {
                    let env = &env;
                    scope.spawn(move || {
                        load_runtime_model(env, path, *weight, model_threads, resolved_views)
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| {
                    handle
                        .join()
                        .map_err(|_| anyhow::anyhow!("A model-loading worker panicked"))?
                })
                .collect()
        })?
    } else {
        args.model
            .iter()
            .zip(&args.model_weight)
            .map(|(path, weight)| {
                load_runtime_model(&env, path, *weight, model_threads, resolved_views)
            })
            .collect::<Result<Vec<_>>>()?
    };
    for (model, recommended_views) in loaded_models {
        resolved_views.get_or_insert(recommended_views);
        models.push(model);
    }
    let mut fallback = if let Some(path) = &args.fallback_model {
        ensure!(
            path.is_file(),
            "Missing fallback ONNX model {}",
            path.display()
        );
        Some(DeferredModel {
            path: path.clone(),
            weight: args.fallback_weight,
            threads: args.threads,
            requested_views: resolved_views,
            loaded: None,
        })
    } else {
        None
    };
    let resolved_views = resolved_views.expect("at least one model");
    let session_load_ms = ms(session_started);
    ensure!(
        models.iter().all(|model| model.views == resolved_views),
        "All ensemble models must use the same number of views"
    );
    args.views = Some(resolved_views);
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
            match process_one(
                Some(&env),
                &args,
                &path,
                false,
                output.as_deref(),
                &mut models,
                fallback.as_mut(),
            ) {
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
            Some(&env),
            &args,
            path,
            args.tensor.is_some(),
            args.output.as_deref(),
            &mut models,
            fallback.as_mut(),
        )?
    };
    result["backend"] = json!("ONNX Runtime CPU");
    result["ort_crate"] = json!("2.0.0-rc.15");
    result["ort_runtime_api"] = json!(31);
    result["ort_runtime_build"] = json!(ort::info());
    result["threads"] = json!(args.threads);
    result["model_threads"] = json!(model_threads);
    result["parallel_models"] = json!(args.parallel_models);
    result["warmup"] = json!(args.warmup);
    result["runs"] = json!(args.runs);
    result["views"] = json!(args.views);
    result["recommended_views"] = json!(resolved_views);
    result["models"] = json!(models.len());
    result["fallback_model_configured"] = json!(fallback.is_some());
    result["fallback_margin_threshold"] = json!(args.fallback_margin);
    result["experimental_views_override"] = json!(
        models
            .iter()
            .any(|model| model.views != model.recommended_views)
    );
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
        let data = prepare(&image, SIDE);
        assert_eq!(data.len(), elements(SIDE));
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
        let input: Vec<f32> = (0..elements(SIDE)).map(|index| index as f32).collect();
        let right = rotate_chw(&input, SIDE, 1);
        assert_eq!(right[0], input[(SIDE - 1) * SIDE]);
        assert_eq!(rotate_chw(&right, SIDE, 3), input);
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
