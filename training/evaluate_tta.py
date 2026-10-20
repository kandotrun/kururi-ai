#!/usr/bin/env python3
"""Evaluate a fixed four-view inference mode from four-angle validation predictions.

This does not fit weights or thresholds. It averages correction distributions
after undoing the extra clockwise rotation in class space. The formula never
reads expected labels.
"""

import argparse
import collections
import copy
import json

import numpy as np
from train import group_metrics, sha256, write_json


def ensemble_predictions(predictions):
    grouped = collections.defaultdict(dict)
    for row in predictions:
        k = row["applied_clockwise_degrees"] // 90
        assert k in (0, 1, 2, 3)
        assert k not in grouped[row["id"]]
        grouped[row["id"]][k] = row
    result = []
    for rows in grouped.values():
        assert sorted(rows) == [0, 1, 2, 3]
        probabilities = np.asarray([rows[k]["probabilities"] for k in range(4)])
        assert probabilities.shape == (4, 4)
        assert np.isfinite(probabilities).all()
        assert np.max(np.abs(probabilities.sum(axis=1) - 1)) < 1e-5
        # For extra input rotation k, class j corrects the unrotated input by j+k.
        base = np.mean([np.roll(probabilities[k], k) for k in range(4)], axis=0)
        for a in range(4):
            p = np.roll(base, -a)
            row = copy.deepcopy(rows[a])
            row.update(
                predicted_class=int(p.argmax()),
                confidence=float(p.max()),
                probabilities=p.tolist(),
            )
            result.append(row)
    return result


def describe(predictions, manifest):
    rows = {r["id"]: r for r in manifest["images"]}
    result = group_metrics(predictions)
    for field in ("category", "format", "upright_label_status"):
        result["by_" + field] = {
            key: group_metrics([r for r in predictions if r[field] == key])
            for key in sorted({r[field] for r in predictions})
        }
    high = [
        p
        for p in predictions
        if rows[p["id"]].get("v2_visual_review", {}).get("confidence") == "high"
    ]
    if high:
        result["high_confidence_source_labels_only"] = group_metrics(high)
    result["confidence_thresholds_descriptive_only"] = {}
    for threshold in (0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99):
        kept = [r for r in predictions if r["confidence"] >= threshold]
        result["confidence_thresholds_descriptive_only"][str(threshold)] = {
            "accepted": len(kept),
            "coverage": len(kept) / len(predictions),
            "accuracy": (
                sum(r["expected_class"] == r["predicted_class"] for r in kept)
                / len(kept)
                if kept
                else None
            ),
        }
    return result


def self_check():
    # Exercise every possible underlying correction; no target labels are needed.
    for underlying_cw in range(4):
        rows = []
        for applied in range(4):
            p = [0.0] * 4
            p[(-underlying_cw - applied) % 4] = 1.0
            rows.append(
                {
                    "id": "fixture",
                    "applied_clockwise_degrees": applied * 90,
                    "probabilities": p,
                }
            )
        out = ensemble_predictions(rows)
        assert all(
            r["predicted_class"]
            == (-underlying_cw - r["applied_clockwise_degrees"] // 90) % 4
            for r in out
        )
    # Check arbitrary, inconsistent model outputs against the actual inference
    # loop for every input angle, without assuming an upright/ideal prediction.
    rng = np.random.default_rng(321)
    p = rng.dirichlet(np.ones(4), size=4)
    rows = [
        {
            "id": "arbitrary",
            "applied_clockwise_degrees": k * 90,
            "probabilities": p[k].tolist(),
        }
        for k in range(4)
    ]
    offline = ensemble_predictions(rows)
    for a in range(4):
        actual_inference_loop = np.mean(
            [np.roll(p[(a + k) % 4], k) for k in range(4)], axis=0
        )
        np.testing.assert_allclose(
            offline[a]["probabilities"], actual_inference_loop, rtol=1e-14, atol=1e-14
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    self_check()
    evaluation = json.load(open(args.evaluation))
    manifest = json.load(open(args.manifest))
    assert (
        sha256(args.manifest) == evaluation["manifest_sha256"]
    ), "manifest changed since evaluation"
    predictions = ensemble_predictions(evaluation["predictions"])
    result = {
        "split": evaluation["split"],
        "model_name": evaluation["model_name"],
        "checkpoint_sha256": evaluation["checkpoint_sha256"],
        "manifest_sha256": evaluation["manifest_sha256"],
        "inference_mode": "four_view_probability_mean",
        "forwards_per_input": 4,
        "alignment": "q[k][j] = p[clockwise-rotated-input k][(j-k) mod 4]; arithmetic mean over k",
        "metrics": describe(predictions, manifest),
        "single_view_metrics": describe(evaluation["predictions"], manifest),
        "predictions": predictions,
        "latency": "Must measure four forwards; no speed claim from this probability-only evaluation.",
        "self_check": "inverse alignment checked for all16 ideal rotation pairs and arbitrary inconsistent probabilities against a four-forward inference loop",
    }
    write_json(args.output, result)
    print(
        json.dumps(
            {
                k: v
                for k, v in result.items()
                if k not in ("predictions", "single_view_metrics")
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
