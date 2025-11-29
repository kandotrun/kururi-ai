from __future__ import annotations

from pathlib import Path

import torchvision.transforms as transforms
from PIL import Image
import torch


class AutoCrop:
    def __init__(self, final_size: int = 224):
        self.final_size = final_size

    def __call__(self, img: Image.Image) -> Image.Image:
        img = self._resize_to_limit_short_edge(img)
        aspect_ratio = img.width / img.height
        if aspect_ratio > 4 / 3:
            new_width = int(img.height * 4 / 3)
            left = (img.width - new_width) / 2
            img = img.crop((left, 0, left + new_width, img.height))
        elif aspect_ratio < 3 / 4:
            new_height = int(img.width * 4 / 3)
            top = (img.height - new_height) / 2
            img = img.crop((0, top, img.width, top + new_height))
        return img.resize((self.final_size, self.final_size), Image.BICUBIC)

    def _resize_to_limit_short_edge(self, img: Image.Image) -> Image.Image:
        if img.width < img.height:
            if img.width > self.final_size:
                scale = self.final_size / img.width
                new_height = int(scale * img.height)
                return img.resize((self.final_size, new_height), Image.BICUBIC)
        else:
            if img.height > self.final_size:
                scale = self.final_size / img.height
                new_width = int(scale * img.width)
                return img.resize((new_width, self.final_size), Image.BICUBIC)
        return img


def build_transform() -> transforms.Compose:
    return transforms.Compose([AutoCrop(), transforms.ToTensor()])


def load_image(image_path: Path) -> Image.Image:
    return Image.open(image_path).convert("RGB")


def prepare_input(image: Image.Image) -> torch.Tensor:
    tensor = build_transform()(image)
    return tensor.unsqueeze(0)
