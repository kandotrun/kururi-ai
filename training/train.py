#!/usr/bin/env python3
"""Local, group-separated photo-orientation transfer learning and explicit evaluation.

No network requests are made by this file. Run prepare_pretrained.py separately.
The test split is never loaded during train. Do not tune on test results.
"""

import argparse
import collections
import hashlib
import json
import math
import os
import random
import time
from pathlib import Path

import numpy as np
from PIL import Image
import safetensors.torch
import timm
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

CLASS_CW_DEGREES = [0, 90, 180, 270]
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
PREPROCESS = {
    "image_size": 224,
    "color": "RGB",
    "exif": "apply exactly once before synthetic rotations",
    "resize": "whole image to 224x224, aspect ratio may change, no crop",
    "interpolation": "Pillow bilinear",
    "pixel_scale": 1 / 255,
    "mean": MEAN,
    "std": STD,
    "layout": "NCHW",
    "class_correction_clockwise_degrees": CLASS_CW_DEGREES,
}


def write_json(path, obj):
    Path(path).write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    )


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sync(device):
    if str(device).startswith("mps"):
        torch.mps.synchronize()
    elif str(device).startswith("cuda"):
        torch.cuda.synchronize()


def read_manifest(path):
    payload = json.loads(Path(path).read_text())
    entries = payload["images"] if isinstance(payload, dict) else payload
    ids, group_splits, hash_splits = (
        set(),
        collections.defaultdict(set),
        collections.defaultdict(set),
    )
    for row in entries:
        assert row["id"] not in ids, "duplicate image id"
        ids.add(row["id"])
        split = row["split"]
        if split not in ("train", "val", "test"):
            continue
        assert row.get("group_id"), "every split image must have a group id"
        group_splits[row["group_id"]].add(split)
        for key in ("source_sha256", "pixelhash"):
            if row.get(key):
                hash_splits[(key, row[key])].add(split)
    assert all(
        len(s) == 1 for s in group_splits.values()
    ), "group leakage across splits"
    assert all(
        len(s) == 1 for s in hash_splits.values()
    ), "exact/pixel duplicate leakage across splits"
    entries = [
        r
        for r in entries
        if r["split"] in ("train", "val", "test") and not r.get("duplicate_of")
    ]
    return entries


def split_summary(entries):
    result = {}
    for split in ("train", "val", "test"):
        rows = [r for r in entries if r["split"] == split]
        result[split] = {
            "originals": len(rows),
            "groups": len({r["group_id"] for r in rows}),
            "rotation_variants": len(rows) * 4,
            "format": dict(
                collections.Counter(r.get("format", "unknown") for r in rows)
            ),
            "category": dict(
                collections.Counter(r.get("category", "unknown") for r in rows)
            ),
            "label_status": dict(
                collections.Counter(
                    r.get("upright_label_status", "unknown") for r in rows
                )
            ),
        }
    return result


class RotationDataset(Dataset):
    """Four right-angle variants/original, shuffled during training.

    Each epoch contains each rotation once, giving balanced random ordering.
    Images are resized then rotated; square bilinear resizing commutes with
    right-angle rotations up to the same integer pixel rounding.
    """

    def __init__(self, entries, training=False):
        self.entries = entries
        self.training = training
        self.cache = []
        group_counts = collections.Counter(r["group_id"] for r in entries)
        mean_weight = sum(1 / group_counts[r["group_id"]] for r in entries) / len(
            entries
        )
        self.weights = [1 / group_counts[r["group_id"]] / mean_weight for r in entries]
        for row in entries:
            with Image.open(row["canonical_path"]) as img:
                arr = np.asarray(
                    img.convert("RGB").resize((224, 224), Image.Resampling.BILINEAR)
                ).copy()
            self.cache.append(torch.from_numpy(arr).permute(2, 0, 1).contiguous())
        self.mean = torch.tensor(MEAN)[:, None, None]
        self.std = torch.tensor(STD)[:, None, None]

    def __len__(self):
        return len(self.entries) * 4

    def __getitem__(self, index):
        orig, applied_cw_quarters = divmod(index, 4)
        x = (
            torch.rot90(self.cache[orig], -applied_cw_quarters, [1, 2])
            .float()
            .div_(255)
        )
        if self.training:
            # Color-only changes preserve the orientation label.
            brightness = 1 + (torch.rand(()).item() - 0.5) * 0.2
            contrast = 1 + (torch.rand(()).item() - 0.5) * 0.2
            x = (x * brightness).clamp_(0, 1)
            center = x.mean(dim=(1, 2), keepdim=True)
            x = ((x - center) * contrast + center).clamp_(0, 1)
        x = (x - self.mean) / self.std
        return (
            x,
            (-applied_cw_quarters) % 4,
            orig,
            applied_cw_quarters,
            self.weights[orig],
        )


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.backends.mps.is_available():
        torch.mps.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def get_device(name):
    if name == "auto":
        name = (
            "mps"
            if torch.backends.mps.is_available()
            else ("cuda" if torch.cuda.is_available() else "cpu")
        )
    return torch.device(name)


def load_initial_model(source_dir):
    source_dir = Path(source_dir)
    provenance = json.loads((source_dir / "provenance.json").read_text())
    assert (
        sha256(source_dir / "model.safetensors")
        == provenance["files"]["model.safetensors"]["sha256"]
    )
    model = timm.create_model(
        provenance["model_name"], pretrained=False, num_classes=1000
    )
    model.load_state_dict(
        safetensors.torch.load_file(source_dir / "model.safetensors"), strict=True
    )
    model.reset_classifier(4)
    return model, provenance


def save_checkpoint(path, model, model_name, config, epoch, metrics):
    # Plain tensors + JSON-compatible primitives can be loaded weights_only=True.
    torch.save(
        {
            "state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
            "model_name": model_name,
            "config": config,
            "epoch": epoch,
            "val_metrics": metrics,
        },
        path,
    )


def load_checkpoint(path, device):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    model = timm.create_model(checkpoint["model_name"], pretrained=False, num_classes=4)
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    return model.to(device).eval(), checkpoint


def group_metrics(predictions):
    groups, originals = collections.defaultdict(list), collections.defaultdict(list)
    correct = 0
    confusion = [[0] * 4 for _ in range(4)]
    for r in predictions:
        ok = r["predicted_class"] == r["expected_class"]
        correct += ok
        groups[r["group_id"]].append(int(ok))
        originals[r["id"]].append(int(ok))
        confusion[r["expected_class"]][r["predicted_class"]] += 1
    values = np.asarray([np.mean(v) for v in groups.values()])
    boot_rng = np.random.default_rng(20261020)
    boot = [
        float(boot_rng.choice(values, len(values), replace=True).mean())
        for _ in range(1000)
    ]
    return {
        "variants": len(predictions),
        "originals": len(originals),
        "groups": len(groups),
        "correct": correct,
        "accuracy": correct / len(predictions),
        "group_macro_accuracy": float(values.mean()),
        "group_bootstrap_95_percent_ci": [
            float(np.quantile(boot, 0.025)),
            float(np.quantile(boot, 0.975)),
        ],
        "all_four_correct_originals": sum(all(v) for v in originals.values()),
        "all_four_correct_fraction": sum(all(v) for v in originals.values())
        / len(originals),
        "confusion_expected_rows_predicted_columns": confusion,
    }


@torch.inference_mode()
def evaluate(model, loader, device, detailed=False):
    model.eval()
    predictions, loss_sum = [], 0.0
    sync(device)
    started = time.perf_counter()
    for x, y, orig, applied, weights in loader:
        logits = model(x.to(device))
        loss_sum += nn.functional.cross_entropy(
            logits, y.to(device), reduction="sum"
        ).item()
        probs = logits.softmax(1).cpu()
        confidence, classes = probs.max(1)
        for j, index in enumerate(orig.tolist()):
            row = loader.dataset.entries[index]
            predictions.append(
                {
                    "id": row["id"],
                    "group_id": row["group_id"],
                    "format": row.get("format", "unknown"),
                    "category": row.get("category", "unknown"),
                    "upright_label_status": row.get("upright_label_status", "unknown"),
                    "applied_clockwise_degrees": int(applied[j]) * 90,
                    "expected_class": int(y[j]),
                    "predicted_class": int(classes[j]),
                    "confidence": float(confidence[j]),
                    "probabilities": probs[j].tolist(),
                }
            )
    sync(device)
    metrics = group_metrics(predictions)
    metrics["cross_entropy"] = loss_sum / len(predictions)
    metrics["wall_seconds"] = time.perf_counter() - started
    if detailed:
        for field in ("category", "format", "upright_label_status"):
            metrics["by_" + field] = {
                key: group_metrics([r for r in predictions if r[field] == key])
                for key in sorted({r[field] for r in predictions})
            }
        metrics["confidence_thresholds_descriptive_only"] = {}
        for threshold in (0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99):
            kept = [r for r in predictions if r["confidence"] >= threshold]
            metrics["confidence_thresholds_descriptive_only"][str(threshold)] = {
                "accepted": len(kept),
                "coverage": len(kept) / len(predictions),
                "accuracy": (
                    sum(r["expected_class"] == r["predicted_class"] for r in kept)
                    / len(kept)
                    if kept
                    else None
                ),
            }
    return metrics, predictions


def set_stage(model, stage):
    classifier_ids = {id(p) for p in model.get_classifier().parameters()}
    for name, parameter in model.named_parameters():
        parameter.requires_grad_(stage == "finetune" or id(parameter) in classifier_ids)
    model.train()
    # Dataset is small. Keep pretrained BatchNorm running statistics fixed.
    for module in model.modules():
        if isinstance(module, nn.modules.batchnorm._BatchNorm):
            module.eval()


def finetune_groups(model, backbone_lr, classifier_lr):
    classifier = list(model.get_classifier().parameters())
    classifier_ids = {id(p) for p in classifier}
    backbone = [p for p in model.parameters() if id(p) not in classifier_ids]
    assert backbone and classifier
    return [
        {"params": backbone, "lr": backbone_lr},
        {"params": classifier, "lr": classifier_lr},
    ]


def train(args):
    seed_everything(args.seed)
    device = get_device(args.device)
    torch.set_num_threads(args.cpu_threads)
    entries = read_manifest(args.manifest)
    summary = split_summary(entries)
    assert summary["train"]["groups"] >= 2 and summary["val"]["groups"] >= 2
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=False)
    model, provenance = load_initial_model(args.pretrained)
    initial_checkpoint = None
    if args.init_checkpoint:
        assert args.head_epochs == 0, "continuation must skip the frozen-head stage"
        initial_checkpoint = torch.load(
            args.init_checkpoint, map_location="cpu", weights_only=True
        )
        assert initial_checkpoint["model_name"] == provenance["model_name"]
        assert initial_checkpoint["config"]["manifest_sha256"] == sha256(args.manifest)
        assert initial_checkpoint["config"]["preprocess"] == PREPROCESS
        model.load_state_dict(initial_checkpoint["state_dict"], strict=True)
    config = {
        "seed": args.seed,
        "device": str(device),
        "batch_size": args.batch_size,
        "head_epochs": args.head_epochs,
        "max_epochs": args.max_epochs,
        "patience_finetune_epochs": args.patience,
        "head_lr": args.head_lr,
        "backbone_lr": args.backbone_lr,
        "finetune_classifier_lr": args.classifier_lr,
        "weight_decay": args.weight_decay,
        "criterion": "cross entropy; inverse group size weighted; label smoothing 0.03",
        "selection": "validation group macro accuracy; cross entropy breaks ties",
        "batchnorm": "running statistics frozen throughout; affine weights fine tuned",
        "augmentation": "all four exact right-angle rotations in shuffled order; brightness/contrast +/-10%",
        "preprocess": PREPROCESS,
        "manifest_sha256": sha256(args.manifest),
        "training_script_sha256": sha256(__file__),
        "split_summary": summary,
        "pretrained": provenance,
        "versions": {
            "torch": str(torch.__version__),
            "timm": timm.__version__,
            "numpy": np.__version__,
        },
        "parameter_count": sum(p.numel() for p in model.parameters()),
        "test_split_accessed_during_training": False,
        "reproducibility": "fixed RNG seed; MPS kernels may vary across software/hardware",
        "initial_checkpoint": (
            {
                "sha256": sha256(args.init_checkpoint),
                "source_epoch": initial_checkpoint["epoch"],
                "source_validation": initial_checkpoint["val_metrics"],
                "optimizer": "fresh AdamW; continuation from selected weights, not exact optimizer resume",
            }
            if initial_checkpoint
            else None
        ),
    }
    write_json(out / "config.json", config)
    (out / "train-used.py").write_bytes(Path(__file__).read_bytes())
    train_ds = RotationDataset(
        [r for r in entries if r["split"] == "train"], training=True
    )
    val_ds = RotationDataset([r for r in entries if r["split"] == "val"])
    generator = torch.Generator().manual_seed(args.seed)
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=0,
        generator=generator,
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0
    )
    model = model.to(device)
    best_key, best_epoch, stale, history = (-1.0, -math.inf), 0, 0, []
    if initial_checkpoint:
        val = initial_checkpoint["val_metrics"]
        best_key = (val["group_macro_accuracy"], -val["cross_entropy"])
        save_checkpoint(
            out / "best.pt", model, provenance["model_name"], config, 0, val
        )
    training_started = time.perf_counter()
    for epoch in range(1, args.max_epochs + 1):
        stage = "head" if epoch <= args.head_epochs else "finetune"
        if epoch == 1:
            set_stage(model, stage)
            if stage == "head":
                optimizer = torch.optim.AdamW(
                    [p for p in model.parameters() if p.requires_grad],
                    lr=args.head_lr,
                    weight_decay=args.weight_decay,
                )
            else:
                optimizer = torch.optim.AdamW(
                    finetune_groups(model, args.backbone_lr, args.classifier_lr),
                    weight_decay=args.weight_decay,
                )
        elif epoch == args.head_epochs + 1:
            # Start fine tuning from the best head checkpoint, selected on validation.
            checkpoint = torch.load(
                out / "best.pt", weights_only=True, map_location="cpu"
            )
            model.load_state_dict(checkpoint["state_dict"])
            set_stage(model, stage)
            optimizer = torch.optim.AdamW(
                finetune_groups(model, args.backbone_lr, args.classifier_lr),
                weight_decay=args.weight_decay,
            )
            stale = 0
        set_stage(model, stage)
        if stage == "finetune":
            progress = (epoch - args.head_epochs - 1) / max(
                1, args.max_epochs - args.head_epochs - 1
            )
            multiplier = 0.1 + 0.9 * (1 + math.cos(math.pi * progress)) / 2
            for group, base in zip(
                optimizer.param_groups, (args.backbone_lr, args.classifier_lr)
            ):
                group["lr"] = base * multiplier
        sync(device)
        started = time.perf_counter()
        loss_sum, correct, count = 0.0, 0, 0
        for x, y, orig, applied, weights in train_loader:
            x, y, weights = (
                x.to(device),
                y.to(device),
                weights.to(device=device, dtype=torch.float32),
            )
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            losses = nn.functional.cross_entropy(
                logits, y, reduction="none", label_smoothing=0.03
            )
            loss = (losses * weights).mean()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            loss_sum += loss.item() * len(x)
            correct += (logits.argmax(1) == y).sum().item()
            count += len(x)
        sync(device)
        train_seconds = time.perf_counter() - started
        val, _ = evaluate(model, val_loader, device)
        key = (val["group_macro_accuracy"], -val["cross_entropy"])
        improved = key > best_key
        if improved:
            best_key, best_epoch, stale = key, epoch, 0
            save_checkpoint(
                out / "best.pt", model, provenance["model_name"], config, epoch, val
            )
        elif stage == "finetune":
            stale += 1
        record = {
            "epoch": epoch,
            "stage": stage,
            "training_loss_group_weighted": loss_sum / count,
            "training_accuracy": correct / count,
            "training_seconds": train_seconds,
            "validation": val,
            "learning_rates": [g["lr"] for g in optimizer.param_groups],
            "new_best": improved,
        }
        history.append(record)
        write_json(out / "history.json", history)
        print(json.dumps(record), flush=True)
        if stage == "finetune" and stale >= args.patience:
            break
    result = {
        "best_epoch": best_epoch,
        "best_validation_group_macro_accuracy": best_key[0],
        "epochs_run": len(history),
        "training_wall_seconds": time.perf_counter() - training_started,
        "checkpoint_sha256": sha256(out / "best.pt"),
        "checkpoint_bytes": (out / "best.pt").stat().st_size,
        "test_evaluated": False,
    }
    write_json(out / "training_result.json", result)
    print(json.dumps(result), flush=True)


def run_evaluation(args):
    torch.set_num_threads(args.cpu_threads)
    seed_everything(args.seed)
    device = get_device(args.device)
    entries = read_manifest(args.manifest)
    rows = [r for r in entries if r["split"] == args.split]
    assert rows, f"empty {args.split} split"
    dataset = RotationDataset(rows)
    loader = DataLoader(
        dataset, batch_size=args.batch_size, shuffle=False, num_workers=0
    )
    model, checkpoint = load_checkpoint(args.checkpoint, device)
    metrics, predictions = evaluate(model, loader, device, detailed=True)
    result = {
        "split": args.split,
        "model_name": checkpoint["model_name"],
        "checkpoint_epoch": checkpoint["epoch"],
        "checkpoint_sha256": sha256(args.checkpoint),
        "manifest_sha256": sha256(args.manifest),
        "device": str(device),
        "metrics": metrics,
        "predictions": predictions,
        "interpretation": "Rotation-derived labels depend on upright source labels. Four rotations of one source are correlated. Group bootstrap CI is exploratory.",
    }
    write_json(args.output, result)
    print(
        json.dumps({k: v for k, v in result.items() if k != "predictions"}), flush=True
    )


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("check")
    p.add_argument("--manifest", required=True)
    p = sub.add_parser("train")
    p.add_argument("--manifest", required=True)
    p.add_argument("--pretrained", required=True)
    p.add_argument(
        "--init-checkpoint",
        help="continue from validation-selected weights with a fresh optimizer; requires --head-epochs 0",
    )
    p.add_argument("--output", required=True)
    p.add_argument("--device", default="auto")
    p.add_argument("--seed", type=int, default=20261020)
    p.add_argument("--cpu-threads", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--head-epochs", type=int, default=3)
    p.add_argument("--max-epochs", type=int, default=15)
    p.add_argument("--patience", type=int, default=4)
    p.add_argument("--head-lr", type=float, default=0.003)
    p.add_argument("--backbone-lr", type=float, default=0.0001)
    p.add_argument("--classifier-lr", type=float, default=0.0005)
    p.add_argument("--weight-decay", type=float, default=0.01)
    p = sub.add_parser("evaluate")
    p.add_argument("--manifest", required=True)
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--split", choices=("val", "test"), required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--device", default="auto")
    p.add_argument("--seed", type=int, default=20261020)
    p.add_argument("--cpu-threads", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.command == "check":
        print(json.dumps(split_summary(read_manifest(args.manifest)), indent=2))
    elif args.command == "train":
        train(args)
    else:
        run_evaluation(args)


if __name__ == "__main__":
    main()
