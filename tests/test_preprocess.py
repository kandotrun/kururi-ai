from pathlib import Path

import torch
from PIL import Image

from cli.preprocess import prepare_input


def test_prepare_input_shape(tmp_path: Path):
    img = Image.new("RGB", (320, 180), color=(255, 255, 255))
    tensor = prepare_input(img)
    assert tensor.shape == (1, 3, 224, 224)
    assert torch.isfinite(tensor).all()
