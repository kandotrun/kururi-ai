import hashlib
import json
import random
import sys
from pathlib import Path

import numpy as np
import PIL
from PIL import Image

MASK = np.uint64(0xFFFFFFFF)


def mulberry32_bytes(seed: int, count: int) -> np.ndarray:
    index = np.arange(1, count + 1, dtype=np.uint64)
    state = (np.uint64(seed & 0xFFFFFFFF) + index * np.uint64(0x6D2B79F5)) & MASK
    value = state
    value = ((value ^ (value >> np.uint64(15))) * (value | np.uint64(1))) & MASK
    mixed = ((value ^ (value >> np.uint64(7))) * (value | np.uint64(61))) & MASK
    value = value ^ ((value + mixed) & MASK)
    value = (value ^ (value >> np.uint64(14))) & MASK
    return (value >> np.uint64(24)).astype(np.uint8)


def gradient_bytes(width: int, height: int) -> np.ndarray:
    y, x = np.mgrid[0:height, 0:width].astype(np.int64)
    channels = [
        (x * 7 + y * 13 + channel * 85 + ((x * y) >> 3)) & 255 for channel in range(3)
    ]
    return np.stack(channels, axis=-1).astype(np.uint8).reshape(-1)


def synthetic(content: str, seed: int, width: int, height: int) -> bytes:
    if content == "noise":
        return mulberry32_bytes(seed, width * height * 3).tobytes()
    if content == "gradient":
        return gradient_bytes(width, height).tobytes()
    raise ValueError(content)


def pillow_resize(
    data: bytes, width: int, height: int, target_width: int, target_height: int
) -> bytes:
    image = Image.frombytes("RGB", (width, height), data)
    return image.resize(
        (target_width, target_height), Image.Resampling.BILINEAR
    ).tobytes()


def sample_points(
    target_width: int, target_height: int, rng: random.Random
) -> list[tuple[int, int]]:
    corners = [(0, 0), (target_width - 1, target_height - 1)]
    extra = [
        (rng.randrange(target_width), rng.randrange(target_height)) for _ in range(4)
    ]
    return corners + extra


def make_case(
    case_id: str,
    content: str,
    seed: int,
    size: tuple[int, int],
    target: tuple[int, int],
    rng: random.Random,
) -> dict:
    width, height = size
    target_width, target_height = target
    data = synthetic(content, seed, width, height)
    output = pillow_resize(data, width, height, target_width, target_height)
    samples = []
    for x, y in sample_points(target_width, target_height, rng):
        offset = (y * target_width + x) * 3
        samples.append([x, y, output[offset], output[offset + 1], output[offset + 2]])
    return {
        "id": case_id,
        "content": content,
        "seed": seed,
        "width": width,
        "height": height,
        "targetWidth": target_width,
        "targetHeight": target_height,
        "sha256": hashlib.sha256(output).hexdigest(),
        "samples": samples,
    }


def main() -> None:
    output_path = Path(sys.argv[1])
    rng = random.Random(20261021)
    cases = []
    for index in range(48):
        width = rng.randint(1, 48)
        height = rng.randint(1, 48)
        target_width = rng.randint(1, 48)
        target_height = rng.randint(1, 48)
        content = "noise" if index % 3 else "gradient"
        cases.append(
            make_case(
                f"random-{index}",
                content,
                1000 + index,
                (width, height),
                (target_width, target_height),
                rng,
            )
        )
    vertical_first = [
        ((40, 160), (36, 20)),
        ((330, 1000), (224, 224)),
        ((12, 90), (11, 7)),
    ]
    for index, (size, target) in enumerate(vertical_first):
        cases.append(
            make_case(
                f"vertical-first-{index}", "noise", 2000 + index, size, target, rng
            )
        )
    real = [
        (1600, 1067),
        (1067, 1600),
        (1600, 1200),
        (1200, 1600),
        (330, 220),
        (220, 330),
        (330, 495),
        (330, 330),
        (330, 186),
        (4032, 3024),
    ]
    for size in real:
        for side in (224, 288):
            for content in ("noise", "gradient"):
                if size == (4032, 3024) and content == "gradient":
                    continue
                cases.append(
                    make_case(
                        f"real-{size[0]}x{size[1]}-{side}-{content}",
                        content,
                        size[0] * 7 + size[1] + side,
                        size,
                        (side, side),
                        rng,
                    )
                )
    output_path.write_text(
        json.dumps({"pillow": PIL.__version__, "cases": cases}, separators=(",", ":"))
        + "\n"
    )
    print(len(cases), "cases", output_path.stat().st_size, "bytes")


main()
