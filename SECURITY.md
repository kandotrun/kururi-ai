# Security policy

## Supported versions

Security fixes are provided for the latest Kururi AI release on `main`.

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private security advisory
workflow:

https://github.com/kandotrun/kururi-ai/security/advisories/new

Do not open a public issue for an unpatched vulnerability. Include:

- The affected version or commit.
- The command, model file, or web route involved.
- Reproduction steps and required input.
- Impact and any known workaround.

Never attach private photos, credentials, tokens, private keys, or identifiable
file paths. Use synthetic files when possible.

## Dependency controls

- Python, Cargo, npm, and GitHub Actions dependencies are reviewed weekly by
  Dependabot with grouped version updates and immediate security updates.
- GitHub Actions are pinned to reviewed commit SHAs rather than mutable tags.
- Pull requests run GitHub dependency review and fail on high-severity changes.
- A weekly audit checks Python, Rust, and npm dependencies across the CLI,
  native tooling, training environment, and web demo.
- The native runtime uses explicit ONNX metadata validation, no-overwrite output
  paths, atomic staged writes, bounded session metadata, and a fixed runtime API.
- The browser demo performs inference locally and has no upload endpoint.
