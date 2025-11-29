import torch

from cli.model_loader import sanitize_state_dict


def test_sanitize_state_dict_removes_module_prefix():
    state = {"module.layer": torch.tensor([1])}
    cleaned = sanitize_state_dict(state)
    assert list(cleaned.keys()) == ["layer"]
    assert torch.equal(cleaned["layer"], torch.tensor([1]))
