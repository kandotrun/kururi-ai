#!/usr/bin/env bash
set -euo pipefail

documents_only=false
if [ "${1:-}" = "--documents-only" ]; then
  documents_only=true
  shift
fi

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: scripts/publish-full-model.sh [--documents-only] <extracted-models-dir> [bucket]" >&2
  echo "example: scripts/publish-full-model.sh ~/Downloads/kururi/models kururi-ai-models" >&2
  exit 64
fi

source_dir="$1"
bucket="${2:-kururi-ai-models}"
prefix="v2.0.0"
part_mib=200
weights_cache="public, max-age=31536000, immutable"
document_cache="public, max-age=86400"
models=(convnext-base-224 convnext-small-288 convnext-small-224)
documents=(
  "licenses/Apache-2.0.txt|text/plain; charset=utf-8"
  "THIRD_PARTY_NOTICES.md|text/markdown; charset=utf-8"
  "MODEL_CARD.md|text/markdown; charset=utf-8"
  "upstream/convnext-base/README.md|text/markdown; charset=utf-8"
  "upstream/convnext-base/config.json|application/json; charset=utf-8"
  "upstream/convnext-base/provenance.json|application/json; charset=utf-8"
  "upstream/convnext-small/README.md|text/markdown; charset=utf-8"
  "upstream/convnext-small/config.json|application/json; charset=utf-8"
  "upstream/convnext-small/provenance.json|application/json; charset=utf-8"
)

required=()
if [ "$documents_only" = false ]; then
  required+=(ensemble.json)
  for model in "${models[@]}"; do
    required+=("$model.onnx" "$model.onnx.data")
  done
fi
for entry in "${documents[@]}"; do
  required+=("${entry%%|*}")
done
for name in "${required[@]}"; do
  if [ ! -f "$source_dir/$name" ]; then
    echo "missing $source_dir/$name" >&2
    exit 66
  fi
done

(cd "$source_dir" && shasum -a 256 -c SHA256SUMS --ignore-missing --quiet)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

upload() {
  local file="$1" key="$2" content_type="$3" cache_control="${4:-$weights_cache}"
  npx wrangler r2 object put "$bucket/$prefix/$key" \
    --file "$file" \
    --content-type "$content_type" \
    --cache-control "$cache_control" \
    --remote
}

for entry in "${documents[@]}"; do
  name="${entry%%|*}"
  upload "$source_dir/$name" "$name" "${entry#*|}" "$document_cache"
done

if [ "$documents_only" = true ]; then
  exit 0
fi

upload "$source_dir/ensemble.json" "ensemble.json" "application/json"

for model in "${models[@]}"; do
  upload "$source_dir/$model.onnx" "$model.onnx" "application/octet-stream"
  data="$source_dir/$model.onnx.data"
  size_mib=$(( ($(stat -f %z "$data" 2>/dev/null || stat -c %s "$data") + 1048575) / 1048576 ))
  if [ "$size_mib" -le 290 ]; then
    upload "$data" "$model.onnx.data" "application/octet-stream"
    continue
  fi
  index=0
  while [ $(( index * part_mib )) -lt "$size_mib" ]; do
    part="$work/$model.onnx.data.part$index"
    dd if="$data" of="$part" bs=1048576 skip=$(( index * part_mib )) count="$part_mib" status=none
    upload "$part" "$model.onnx.data.part$index" "application/octet-stream"
    rm -f "$part"
    index=$(( index + 1 ))
  done
  echo "$model.onnx.data uploaded in $index parts"
done
