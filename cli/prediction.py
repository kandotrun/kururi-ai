from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

import torch

from cli.constants import SUPPORTED_EXTENSIONS
from cli.model_loader import RotationClass
from cli.preprocess import load_image, prepare_input


def predict_with_model(
    image_path: Path,
    model: torch.nn.Module,
    device: torch.device,
    save_rotated: Optional[Path],
) -> tuple[RotationClass, torch.Tensor]:
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    image = load_image(image_path)
    inputs = prepare_input(image).to(device)

    with torch.no_grad():
        logits = model(inputs)
        probabilities = torch.softmax(logits, dim=1).squeeze(0)

    predicted_class: RotationClass = int(probabilities.argmax().item())

    if save_rotated is not None:
        rotated = image.rotate(-90 * predicted_class, expand=True)
        save_rotated.parent.mkdir(parents=True, exist_ok=True)
        rotated.save(save_rotated)

    return predicted_class, probabilities.cpu()


def angle_from_class(rotation_class: RotationClass) -> int:
    return int(rotation_class) * 90


def list_image_files(root: Path) -> list[Path]:
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {root}")
    files = [p for p in root.rglob("*") if p.suffix.lower() in SUPPORTED_EXTENSIONS]
    files.sort()
    return files
