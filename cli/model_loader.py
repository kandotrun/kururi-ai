from __future__ import annotations

from pathlib import Path
from typing import Literal

import timm
import torch

RotationClass = Literal[0, 1, 2, 3]


def sanitize_state_dict(state_dict: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    if len(state_dict) == 0:
        return state_dict
    sample_key = next(iter(state_dict))
    if sample_key.startswith("module."):
        return {k.removeprefix("module."): v for k, v in state_dict.items()}
    return state_dict


def load_model(
    model_name: str, checkpoint_path: Path, device: torch.device
) -> torch.nn.Module:
    model = timm.create_model(model_name, pretrained=False, num_classes=4)
    state = torch.load(checkpoint_path, map_location=device, weights_only=True)
    cleaned_state = sanitize_state_dict(state)
    model.load_state_dict(cleaned_state)
    model.to(device)
    model.eval()
    return model
