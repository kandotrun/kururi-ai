"""Local synthetic-image integration checks. No private photos or trained model.

The fixture outputs a known clockwise-90 prediction regardless of input, so it
tests CLI semantics/IO only and provides no model-accuracy evidence.
"""

from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from PIL import Image, ImageOps


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--binary",
        type=Path,
        default=Path(__file__).parent / "target/release/kururi-native",
    )
    parser.add_argument(
        "--report", type=Path, default=Path(__file__).parent / "smoke-report.json"
    )
    args = parser.parse_args()
    checks = []
    binary = args.binary.resolve()
    with tempfile.TemporaryDirectory(
        prefix="smoke-", dir=Path(__file__).parent
    ) as temporary:
        root = Path(temporary)
        model = root / "fixture.onnx"
        graph = helper.make_graph(
            [
                helper.make_node(
                    "Constant",
                    [],
                    ["logits"],
                    value=numpy_helper.from_array(
                        np.array([[0, 8, 0, 0]], dtype=np.float32)
                    ),
                )
            ],
            "constant-class-one-io-test",
            [
                helper.make_tensor_value_info(
                    "images", TensorProto.FLOAT, [1, 3, 224, 224]
                )
            ],
            [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, 4])],
        )
        graph_model = helper.make_model(
            graph, opset_imports=[helper.make_opsetid("", 18)], ir_version=10
        )
        helper.set_model_props(
            graph_model,
            {
                "kururi.preprocess": "v2-whole224-bilinear-imagenet",
                "kururi.class_order": "0,90,180,270",
                "kururi.class_semantics": "correction_clockwise_degrees",
            },
        )
        onnx.save(graph_model, model)

        def run(*arguments: object, succeeds: bool = True) -> dict:
            result = subprocess.run(
                [str(binary), "predict", *map(str, arguments)],
                capture_output=True,
                text=True,
            )
            if succeeds:
                assert result.returncode == 0, result.stderr
                return json.loads(result.stdout)
            assert result.returncode != 0, result.stdout
            return {"returncode": result.returncode, "stderr": result.stderr.strip()}

        pixels = np.zeros((21, 32, 3), dtype=np.uint8)
        for y in range(21):
            for x in range(32):
                pixels[y, x] = [x * 7, y * 11, (x + y) * 4]
        for orientation in range(1, 9):
            source = root / f"orientation-{orientation}.png"
            exif = Image.Exif()
            exif[274] = orientation
            Image.fromarray(pixels).save(source, exif=exif)
            original_hash = digest(source)
            output = root / f"corrected-{orientation}.png"
            result = run("--model", model, "--image", source, "--output", output)
            assert result["exif_orientation"] == orientation, result
            assert result["correction_cw"] == 90 and result["saved"], result
            with Image.open(source) as image:
                expected = (
                    ImageOps.exif_transpose(image)
                    .convert("RGB")
                    .transpose(Image.Transpose.ROTATE_270)
                )
            with Image.open(output) as image:
                assert np.array_equal(
                    np.asarray(image), np.asarray(expected)
                ), orientation
                assert image.getexif().get(274, 1) == 1
            assert digest(source) == original_hash
        checks.append(
            "All 8 EXIF orientations applied once, then class1 corrected clockwise90; pixels exact and originals unchanged"
        )

        for name, array in [
            (
                "rgba",
                np.concatenate(
                    [pixels, np.arange(21 * 32, dtype=np.uint8).reshape(21, 32, 1)],
                    axis=2,
                ),
            ),
            ("gray16", np.arange(21 * 32, dtype=np.uint16).reshape(21, 32) * 90),
        ]:
            source_variant = root / f"{name}.png"
            output_variant = root / f"{name}-output.png"
            Image.fromarray(array).save(source_variant)
            run("--model", model, "--image", source_variant, "--output", output_variant)
            with Image.open(source_variant) as original:
                expected = np.asarray(original.transpose(Image.Transpose.ROTATE_270))
            with Image.open(output_variant) as image:
                assert np.array_equal(np.asarray(image), expected), name
        checks.append("PNG correction preserves alpha and 16-bit grayscale values")

        source = root / "orientation-1.png"
        original_hash = digest(source)
        run("--model", model, "--image", source, "--output", source, succeeds=False)
        assert digest(source) == original_hash
        checks.append("Existing output/input overwrite refused")
        unsupported_output = root / "unsupported.gif"
        run(
            "--model",
            model,
            "--image",
            source,
            "--output",
            unsupported_output,
            succeeds=False,
        )
        assert not unsupported_output.exists()
        checks.append("Unsupported output format creates no partial file")

        abstained = root / "abstained.png"
        result = run(
            "--model",
            model,
            "--image",
            source,
            "--output",
            abstained,
            "--min-confidence",
            "0.9999",
        )
        assert not result["accepted"] and not result["saved"] and not abstained.exists()
        checks.append("Abstention produces no output")

        directory = root / "input"
        (directory / "nested").mkdir(parents=True)
        Image.fromarray(pixels).save(directory / "a.png")
        Image.fromarray(pixels).save(directory / "nested" / "b.png")
        (directory / "ignored.txt").write_text("not an image")
        (directory / "link.png").symlink_to(source)
        output_directory = root / "output"
        result = run(
            "--model", model, "--dir", directory, "--output-dir", output_directory
        )
        assert result["error_count"] == 0 and len(result["results"]) == 2
        assert result["skipped_unsupported_or_symlink_entries"] == 2
        assert (output_directory / "a.png").exists() and (
            output_directory / "nested" / "b.png"
        ).exists()
        run(
            "--model",
            model,
            "--dir",
            directory,
            "--output-dir",
            output_directory,
            succeeds=False,
        )
        checks.append(
            "Recursive directory retains subpaths, skips unsupported/symlinks, refuses existing output root"
        )

        bad_tensor = root / "bad.f32"
        bad_tensor.write_bytes(b"wrong-size")
        run("--model", model, "--tensor", bad_tensor, succeeds=False)
        np.full((1, 3, 224, 224), np.nan, dtype="<f4").tofile(bad_tensor)
        run("--model", model, "--tensor", bad_tensor, succeeds=False)
        checks.append("Wrong-sized and nonfinite tensors refused")

        tensor = root / "native.f32"
        result = run("--image", source, "--preprocess-only", "--write-input", tensor)
        assert result["scope"] == "image_decode_and_preprocess_only"
        actual = np.fromfile(tensor, dtype="<f4").reshape(3, 224, 224)
        with Image.open(source) as image:
            reference = (
                np.asarray(
                    ImageOps.exif_transpose(image)
                    .convert("RGB")
                    .resize((224, 224), Image.Resampling.BILINEAR),
                    dtype=np.float32,
                ).transpose(2, 0, 1)
                / 255
            )
        reference = (
            reference - np.array([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
        ) / np.array([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]
        error = np.abs(actual - reference)
        assert np.isfinite(actual).all()
        assert np.array_equal(actual, reference)
        fixture_errors = []
        generator = np.random.default_rng(20261020)
        for fixture_index, (width, height) in enumerate(
            [
                (1, 1),
                (32, 21),
                (640, 480),
                (480, 640),
                (20, 1200),
                (1200, 20),
                (224, 224),
                (224, 311),
                (311, 224),
                (227, 119),
                (4096, 64),
                (64, 4096),
            ]
        ):
            fixture = root / f"resize-{fixture_index}.png"
            fixture_tensor = root / f"resize-{fixture_index}.f32"
            values = generator.integers(0, 256, (height, width, 3), dtype=np.uint8)
            Image.fromarray(values).save(fixture)
            run(
                "--image", fixture, "--preprocess-only", "--write-input", fixture_tensor
            )
            actual_fixture = np.fromfile(fixture_tensor, dtype="<f4").reshape(
                3, 224, 224
            )
            reference_fixture = (
                np.asarray(
                    Image.fromarray(values).resize(
                        (224, 224), Image.Resampling.BILINEAR
                    ),
                    dtype=np.float32,
                ).transpose(2, 0, 1)
                / 255
            )
            reference_fixture = (
                reference_fixture
                - np.array([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
            ) / np.array([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]
            fixture_errors.append(
                float(np.abs(actual_fixture - reference_fixture).max())
            )
            assert np.array_equal(actual_fixture, reference_fixture), (
                width,
                height,
                fixture_errors[-1],
            )
        checks.append(
            "Twelve RGB8 resize fixtures match Pillow13 preprocessing bit for bit"
        )
        run("--model", model, "--tensor", tensor)
        ensemble = run("--model", model, "--tensor", tensor, "--views", "4")
        assert ensemble["views"] == 4 and ensemble["total_forward_passes"] == 4
        assert (
            ensemble["models"] == 1
            and len(ensemble["model_results"]) == 1
            and len(ensemble["model_results"][0]["logits"]) == 4
        )
        assert np.allclose(
            ensemble["probabilities"], [0.25, 0.25, 0.25, 0.25], atol=1e-6
        )
        checks.append(
            "Native tensor shape/channel normalization and raw tensor inference checked"
        )
        checks.append(
            "Four-view execution reports four forwards and aligned probability averaging"
        )

        second_model = root / "fixture-second.onnx"
        second_graph = helper.make_graph(
            [
                helper.make_node(
                    "Constant",
                    [],
                    ["logits"],
                    value=numpy_helper.from_array(
                        np.array([[0, 0, 0, 8]], dtype=np.float32)
                    ),
                )
            ],
            "constant-class-three-io-test",
            [
                helper.make_tensor_value_info(
                    "images", TensorProto.FLOAT, [1, 3, 224, 224]
                )
            ],
            [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, 4])],
        )
        second_graph_model = helper.make_model(
            second_graph,
            opset_imports=[helper.make_opsetid("", 18)],
            ir_version=10,
        )
        helper.set_model_props(
            second_graph_model,
            {
                "kururi.preprocess": "v2-whole224-bilinear-imagenet",
                "kururi.class_order": "0,90,180,270",
                "kururi.class_semantics": "correction_clockwise_degrees",
            },
        )
        onnx.save(second_graph_model, second_model)
        weighted = run(
            "--model",
            model,
            "--model-weight",
            "0.75",
            "--model",
            second_model,
            "--model-weight",
            "0.25",
            "--tensor",
            tensor,
        )
        assert weighted["models"] == 2 and weighted["class"] == 1, weighted
        assert weighted["probabilities"][1] > weighted["probabilities"][3]
        checks.append(
            "Repeated model inputs and per-model weights form a weighted ensemble"
        )

        recommended_model = root / "recommended-four-views.onnx"
        helper.set_model_props(
            graph_model,
            {
                "kururi.preprocess": "v2-whole224-bilinear-imagenet",
                "kururi.class_order": "0,90,180,270",
                "kururi.class_semantics": "correction_clockwise_degrees",
                "kururi.recommended_views": "4",
            },
        )
        onnx.save(graph_model, recommended_model)
        recommended = run("--model", recommended_model, "--image", source)
        overridden = run(
            "--model", recommended_model, "--image", source, "--views", "1"
        )
        assert (
            recommended["views"] == 4 and not recommended["experimental_views_override"]
        )
        assert overridden["views"] == 1 and overridden["experimental_views_override"]
        checks.append(
            "Embedded recommended views are default; explicit single-view override is marked experimental"
        )

        invalid = root / "wrong-metadata.onnx"
        helper.set_model_props(
            graph_model, {"kururi.preprocess": "v1-autocrop224-no-normalization"}
        )
        onnx.save(graph_model, invalid)
        run("--model", invalid, "--image", source, succeeds=False)
        checks.append("Image mode rejects incompatible model metadata")

        report = {
            "passed": True,
            "checks": checks,
            "synthetic_preprocess_vs_pillow": {
                "max_abs": float(error.max()),
                "mean_abs": float(error.mean()),
            },
            "resize_fixture_max_abs": max(fixture_errors),
            "resize_fixture_count": len(fixture_errors),
            "scope": "synthetic IO/metadata/rotation tests only; no trained model accuracy or benchmark evidence",
        }
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
