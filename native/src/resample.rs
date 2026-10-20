use image::RgbImage;

const COEFFICIENT_BITS: u32 = 22;
const COEFFICIENT_SCALE: f64 = (1_u32 << COEFFICIENT_BITS) as f64;
const ROUNDING_BIAS: i64 = 1_i64 << (COEFFICIENT_BITS - 1);

struct Taps {
    start: usize,
    weights: Vec<i32>,
}

fn axis_taps(input: u32, output: u32) -> Vec<Taps> {
    let scale = f64::from(input as f32) / f64::from(output);
    let support = scale.max(1.0);
    let inverse_support = 1.0 / support;
    (0..output)
        .map(|position| {
            let center = (f64::from(position) + 0.5) * scale;
            let start = (center - support + 0.5).max(0.0) as usize;
            let end = ((center + support + 0.5) as usize).min(input as usize);
            let weights: Vec<f64> = (start..end)
                .map(|sample| {
                    let distance = ((sample as f64 - center + 0.5) * inverse_support).abs();
                    (1.0 - distance).max(0.0)
                })
                .collect();
            let total: f64 = weights.iter().sum();
            Taps {
                start,
                weights: weights
                    .iter()
                    .map(|weight| (0.5 + weight / total * COEFFICIENT_SCALE) as i32)
                    .collect(),
            }
        })
        .collect()
}

fn to_channel(value: i64) -> u8 {
    (value >> COEFFICIENT_BITS).clamp(0, 255) as u8
}

fn horizontal(source: &RgbImage, width: u32) -> RgbImage {
    let taps = axis_taps(source.width(), width);
    let input_stride = source.width() as usize * 3;
    let output_stride = width as usize * 3;
    let mut output = RgbImage::new(width, source.height());
    for (input_row, output_row) in source
        .as_raw()
        .chunks_exact(input_stride)
        .zip(output.as_mut().chunks_exact_mut(output_stride))
    {
        for (tap, pixel) in taps.iter().zip(output_row.chunks_exact_mut(3)) {
            let mut sums = [ROUNDING_BIAS; 3];
            let start = tap.start * 3;
            let end = start + tap.weights.len() * 3;
            for (sample, &weight) in input_row[start..end].chunks_exact(3).zip(&tap.weights) {
                for channel in 0..3 {
                    sums[channel] += i64::from(sample[channel]) * i64::from(weight);
                }
            }
            for channel in 0..3 {
                pixel[channel] = to_channel(sums[channel]);
            }
        }
    }
    output
}

fn vertical(source: &RgbImage, height: u32) -> RgbImage {
    let taps = axis_taps(source.height(), height);
    let stride = source.width() as usize * 3;
    let input = source.as_raw();
    let mut output = RgbImage::new(source.width(), height);
    for (tap, output_row) in taps.iter().zip(output.as_mut().chunks_exact_mut(stride)) {
        for (position, pixel) in output_row.chunks_exact_mut(3).enumerate() {
            let mut sums = [ROUNDING_BIAS; 3];
            for (offset, &weight) in tap.weights.iter().enumerate() {
                let start = (tap.start + offset) * stride + position * 3;
                for channel in 0..3 {
                    sums[channel] += i64::from(input[start + channel]) * i64::from(weight);
                }
            }
            for channel in 0..3 {
                pixel[channel] = to_channel(sums[channel]);
            }
        }
    }
    output
}

pub fn resize_rgb8(source: &RgbImage, width: u32, height: u32) -> RgbImage {
    assert!(
        source.width() > 0 && source.height() > 0 && width > 0 && height > 0,
        "Resize dimensions must be positive"
    );
    match (source.width() != width, source.height() != height) {
        (false, false) => source.clone(),
        (true, false) => horizontal(source, width),
        (false, true) => vertical(source, height),
        (true, true) => {
            let width_reduction = i64::from(source.width()) - i64::from(width);
            let height_reduction = i64::from(source.height()) - i64::from(height);
            if height_reduction > 0 && height_reduction > 2 * width_reduction {
                horizontal(&vertical(source, height), width)
            } else {
                vertical(&horizontal(source, width), height)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::resize_rgb8;
    use image::{Rgb, RgbImage};

    #[test]
    fn same_dimensions_preserve_every_channel() {
        let source = RgbImage::from_fn(7, 3, |x, y| {
            Rgb([(x * 37) as u8, (y * 81) as u8, (x + y * 7) as u8])
        });
        assert_eq!(resize_rgb8(&source, 7, 3), source);
    }

    #[test]
    fn constant_images_stay_constant_across_both_pass_orders() {
        for (width, height, target_width, target_height) in
            [(19, 5, 4, 3), (5, 19, 3, 4), (1, 1, 9, 7)]
        {
            let color = Rgb([0, 123, 255]);
            let source = RgbImage::from_pixel(width, height, color);
            let resized = resize_rgb8(&source, target_width, target_height);
            assert_eq!(resized.dimensions(), (target_width, target_height));
            assert!(resized.pixels().all(|pixel| *pixel == color));
        }
    }

    #[test]
    fn half_values_round_up_in_each_channel() {
        let source = RgbImage::from_raw(2, 1, vec![0, 254, 10, 1, 255, 11]).unwrap();
        assert_eq!(
            resize_rgb8(&source, 1, 1).get_pixel(0, 0),
            &Rgb([1, 255, 11])
        );
    }
}
