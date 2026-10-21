#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: scripts/publish-full-model.sh <extracted-models-dir> [bucket]" >&2
  echo "example: scripts/publish-full-model.sh ~/Downloads/kururi/models kururi-ai-models" >&2
  exit 64
fi

source_dir="$1"
bucket="${2:-kururi-ai-models}"
prefix="v2.0.0"
part_mib=200
cache_control="public, max-age=31536000, immutable"

(cd "$source_dir" && shasum -a 256 -c SHA256SUMS --ignore-missing --quiet)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

upload() {
  local file="$1" key="$2" content_type="$3"
  npx wrangler r2 object put "$bucket/$prefix/$key" \
    --file "$file" \
    --content-type "$content_type" \
    --cache-control "$cache_control" \
    --remote
}

upload "$source_dir/ensemble.json" "ensemble.json" "application/json"

for model in convnext-base-224 convnext-small-288 convnext-small-224; do
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
