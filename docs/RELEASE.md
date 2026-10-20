# Release v2

The first candidate version is `2.0.0-rc.1`. This checklist does not publish
anything; release publication is a separate action after artifacts and evidence
are ready.

## Current state

Completed locally for `2.0.0-rc.1`:

- Frozen the validation-selected ConvNeXt Tiny checkpoint and four-view setting.
- Evaluated v1, v2 PyTorch and v2 native on the same 78 test sources and four
  discrete rotations.
- Confirmed identical final classes between PyTorch and native ONNX on all 312
  test variants.
- Measured complete new-process latency for two source sizes, a corrected JPEG
  copy, and warm four-view inference on Apple M4 Max.
- Passed Rust formatting, Clippy with warnings denied, seven unit tests, runtime
  smoke tests and a synthetic relocated-runtime check on macOS ARM64.
- Repeated the Rust checks and relocated full-model run in a Linux x86-64
  container under emulation. This establishes emulated functional support, not
  native Linux performance.
- Built explicit-allowlist model, macOS ARM64 and Linux x86-64 archives; verified
  their embedded checksum inventories and ran full-model inference after
  extracting each platform archive into a new directory.

Still required before publishing the prerelease:

- Record the integrated source commit and public CI run links.
- Publish the model and runtime assets, then create GitHub prerelease
  `v2.0.0-rc.1` without replacing the stable v1 default.

## Evidence

- Freeze the selected model and its configuration using validation results.
- Evaluate v1 and v2 on the same held-out groups and labels. Include errors on
  initially upright inputs and uncertainty in the paired comparison.
- State that current labels use the owner's mostly-upright premise and AI visual
  review. Do not call them universally human-verified or infer broad accuracy
  from one private image collection.
- Check held-out PyTorch/ONNX numerical parity and native image-level results.
- Measure fresh-process latency on each claimed target. State OS cache/storage
  conditions. Keep model-resident timings separate.
- Fill the model card with exact aggregate counts, results, runtime versions,
  hardware, file sizes and artifact hashes.

A faster but materially less accurate candidate can be distributed as an
explicitly experimental, opt-in prerelease. Disclose the regression; do not
replace the stable default or claim the combined accuracy/speed goal is met.
A stable replacement needs evidence supporting the chosen accuracy tolerance
and the single-image latency goal. Tolerances must not be chosen afterward to
fit the final test outcome. Uncertain results remain uncertain.

## Code and target checks

- Update the Cargo package and lockfile version together.
- Keep Rust dependencies locked, and run formatting, Clippy and unit tests.
- Run the synthetic ONNX smoke test on Apple Silicon macOS and Linux x86-64.
- Run a real model inference after extracting each complete archive into a new
  directory. Confirm that it resolves only shipped or documented system
  dependencies. Inspect macOS `otool -L`/RPATH and Linux `ldd`/RUNPATH.
- Test supported image formats, EXIF rotations/mirrors, output direction,
  existing-file rejection, directory errors and confidence abstention.
- State the tested macOS minimum and Linux glibc baseline. A source build on one
  version does not prove older platform compatibility.
- Do not claim Core ML, CUDA, MPS, Linux ARM64, Intel macOS, signing or
  notarization unless separately configured and tested.

## Asset contents

Use explicit file lists when assembling archives. Suggested model asset:

```text
kururi-orient-v2.onnx
kururi-orient-v2.onnx.data       when referenced by ONNX
kururi-orient-v2.metadata.json
MODEL_CARD.md
provenance.json
UPSTREAM_MODEL_CARD.md
licenses/Apache-2.0.txt
SHA256SUMS
```

Suggested platform archive:

```text
kururi-native
libonnxruntime...               exact required library name(s)
README.md
LICENSE
THIRD_PARTY_NOTICES.md
licenses/...                   exact bundled dependency license texts
SHA256SUMS
```

The actual archive contents must match the runtime linkage and model references.
Do not discard ONNX external data, shared libraries or their required symlinks.
Include notices from the actual runtime build, including its transitive
third-party notices, rather than a guessed library list.

After freezing native dependencies and refreshing Cargo.lock, collect locally
available Cargo license evidence:

```sh
python3.12 scripts/inventory_cargo_licenses.py \
  --cargo-manifest native/Cargo.toml \
  --output dist/licenses/cargo
```

This uses locked offline metadata for macOS ARM64 and Linux x86-64, checks
cached crate hashes and copies available license/notice texts. Inspect its
manifest for failed target resolution, missing source/text and compound license
expressions. It respects `CARGO_HOME`. The inventory is evidence for the exact
lockfile, not an automatic determination that every applicable notice is present.
Run the inventory again whenever Cargo.toml or Cargo.lock changes.

Do not ship private photos, contact sheets, local manifests, individual
prediction logs, source filenames or machine-specific paths. Check checkpoint
metadata and documentation as well as archive file names. Public benchmark
reports contain aggregate results with no identifying photo content.

## Publication record

Record source commit, tag, model and archive SHA256 values, CI run links,
platform validation results and the actual publication URL. For a candidate,
mark the GitHub release as a prerelease. Do not label an experimental release
as stable by setting it as the latest default release.

Keep local validation, CI validation, complete archive creation, prerelease
publication and stable promotion as separately reported states.
