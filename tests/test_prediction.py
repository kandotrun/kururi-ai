from pathlib import Path

import torch

from cli.prediction import angle_from_class, list_image_files


def test_angle_from_class():
    assert angle_from_class(0) == 0
    assert angle_from_class(1) == 90
    assert angle_from_class(2) == 180
    assert angle_from_class(3) == 270


def test_list_image_files_filters_and_sorts(tmp_path: Path):
    keep = ["a.jpg", "b.PNG", "c.tiff"]
    drop = ["d.txt", "e.gif"]
    for name in keep + drop:
        (tmp_path / name).write_bytes(b"x")
    nested = tmp_path / "sub" / "f.jpeg"
    nested.parent.mkdir()
    nested.write_bytes(b"y")
    files = list_image_files(tmp_path)
    assert [p.name for p in files] == ["a.jpg", "b.PNG", "c.tiff", "f.jpeg"]
