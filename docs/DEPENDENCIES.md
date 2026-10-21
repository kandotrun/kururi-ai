# Dependency policy

## Current security floor

The CLI lock resolves these minimum security versions:

| Package | Version |
|---|---:|
| PyTorch | 2.14.1 |
| Torchvision | 0.29.1 |
| timm | 1.0.30 |
| Pillow | 13.0.0 |
| AnyIO | 4.15.1 |
| filelock | 4.2.4 |
| fsspec | 2026.9.0 |
| idna | 3.20 |
| setuptools | 84.2.1 |

`cli/pyproject.toml` records lower bounds that prevent known vulnerable
versions from returning through lock regeneration.

The web package resolves Vite 7.3.7 and ONNX Runtime Web 1.23.2 with zero npm
audit findings. The native runtime lock has no matching RustSec advisories.

## Automated controls

- Dependabot checks uv, Cargo, npm, and GitHub Actions weekly.
- Minor and patch version updates are grouped per ecosystem to limit review
  noise.
- Security updates are not grouped or delayed by the weekly schedule.
- Pull requests run GitHub Dependency Review and fail at high severity.
- A weekly scheduled workflow runs `pip-audit`, `npm audit`, and RustSec Audit.
- GitHub Actions are pinned to reviewed commit SHAs, and the workflow token is
  read-only unless a deployment job explicitly needs Pages permissions.
- Scheduled audit tooling is version-pinned so the audit job does not execute an
  arbitrary latest release.

## Local verification

```sh
cd cli
uv lock --check
uv export --frozen --no-dev --format requirements-txt --no-hashes \
  --output-file /tmp/kururi-requirements.txt
uvx --python 3.12 pip-audit -r /tmp/kururi-requirements.txt \
  --no-deps --disable-pip --progress-spinner off

cd ../web
npm audit --audit-level=low

cd ..
cargo audit --file native/Cargo.lock
```

Run the full test matrix after any dependency update:

```sh
cd cli
uv sync --extra dev --frozen
uv pip install --python .venv/bin/python -e .
.venv/bin/python -m pytest -q ../tests
uv run --frozen black --check .

cd ../web
npm ci
npm test
npm run build

cd ..
cargo test --manifest-path native/Cargo.toml --locked
```
