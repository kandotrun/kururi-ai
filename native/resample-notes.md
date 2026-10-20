# RGB8 bilinear compatibility

`src/resample.rs` implements whole-image, positive-dimension RGB8 resize with the API:

```rust
pub fn resize_rgb8(source: &image::RgbImage, width: u32, height: u32) -> image::RgbImage
```

The numerical contract follows Pillow 13.0.0 `Image.resize(size, Image.Resampling.BILINEAR)` with its default whole-image box and no `reducing_gap`:

- Pixel centers are at half-integer coordinates.
- Downsampling widens the triangular filter by the input/output scale.
- Samples outside the image are excluded and surviving weights are normalized.
- Coefficients are rounded to 22-bit fixed point.
- Each pass adds the half-unit rounding bias and writes RGB8 output before the next pass.
- Unchanged axes are skipped.
- Pillow 13.0.0 runs the vertical pass first if the height reduction is positive and exceeds twice the width reduction; otherwise it runs the horizontal pass first. Preserving this choice matters because intermediate RGB8 rounding makes the operations noncommutative.

This is an independently written Rust implementation of the numerical procedure, not a copied C source block. It handles only RGB8, full-image boxes, and bilinear filtering. EXIF handling, decoding, alpha conversion, tensor normalization, and model execution remain the caller's responsibility. Empty input/output dimensions panic, consistent with Pillow rejecting nonpositive resize dimensions. The implementation uses 64-bit accumulators to avoid arithmetic overflow while preserving normal RGB8 results.

The isolated Rust test harness previously passed three checks: unchanged-dimension byte preservation, constant-color preservation with both pass orders and upsampling, and half-value rounding. Differential checks against Python/Pillow and integration checks are left to the caller. Standalone `rustc` needs `-C lto=thin` when linking this workspace's release `image` dependency; omitting it makes the system Apple linker attempt to read newer Rust LLVM bitcode directly.

Reference inspected on 2026-10-20:

- [Pillow 13.0.0 Resample.c](https://github.com/python-pillow/Pillow/blob/13.0.0/src/libImaging/Resample.c)
- [Pillow 13.0.0 license](https://github.com/python-pillow/Pillow/blob/13.0.0/LICENSE)

Pillow is distributed under the MIT-CMU license. Attribution and its notice are retained below as documentation for the referenced implementation.

> The Python Imaging Library (PIL) is
>
> Copyright © 1997-2011 by Secret Labs AB
>
> Copyright © 1995-2011 by Fredrik Lundh and contributors
>
> Pillow is the friendly PIL fork. It is
>
> Copyright © 2010 by Jeffrey 'Alex' Clark and contributors
>
> Like PIL, Pillow is licensed under the open source MIT-CMU License:
>
> By obtaining, using, and/or copying this software and/or its associated documentation, you agree that you have read, understood, and will comply with the following terms and conditions:
>
> Permission to use, copy, modify and distribute this software and its documentation for any purpose and without fee is hereby granted, provided that the above copyright notice appears in all copies, and that both that copyright notice and this permission notice appear in supporting documentation, and that the name of Secret Labs AB or the author not be used in advertising or publicity pertaining to distribution of the software without specific, written prior permission.
>
> SECRET LABS AB AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL SECRET LABS AB OR THE AUTHOR BE LIABLE FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
