# Repository Guidelines

## Structure
- `cli/`: CLI package (`main.py`, `constants.py`, `download_utils.py`, `model_loader.py`, `prediction.py`, `preprocess.py`, `__init__.py`, `pyproject.toml`).
- `models/`: checkpoints（デフォルトはRelease配布を想定、ローカル配置も可）。
- `samples/`: 入力サンプル画像。`samples/out/` に補正結果を保存する例あり。
- `tests/`: pytest によるユニットテスト。
- `README.md` / `README.ja.md`: 使い方（英/日）、サンプル、モデル配布方法。
- `LICENSE`: MIT。モデル作者 新野ユキ (Yuki Arano) へのクレジット明記。
- `.github/workflows/ci.yml`: black --check と pytest を走らせるCI。

## Setup / Commands
- 推奨環境: Python 3.12.9, `uv` 使用。
- セットアップ:
  ```
  git clone https://github.com/kandotrun/kururi-ai.git
  cd kururi-ai
  uv venv .venv && source .venv/bin/activate
  uv pip install -e cli
  ```
- 開発ツール: `uv pip install -e "cli[dev]"`（black, pytest）。
- フォーマット: `uv run black cli`（CIも実行）。
- テスト: `uv run pytest`.

## Coding rules
- コメントは書かない。
- `Any` は使用しない。
- Python: 型ヒント必須、4スペースインデント、snake_case。
- 既存の実装スタイルに合わせる。過剰な依存追加は避ける。

## Model download
- デフォルトURLはプレースホルダ（`DEFAULT_MODEL_URL`）。公開後に実Release URLとSHA256を設定。
- ユーザーは `--checkpoint-url` / `--checkpoint-sha256` または環境変数 `KURURI_MODEL_URL` / `KURURI_MODEL_SHA256` で上書き。
- 未ダウンロード時に自動取得し、Content-Length と（指定時は）SHA256で検証。

## Usage tips
- 単体: `uv run python cli/main.py predict --image <img> --device cpu`.
- 再帰: `uv run python cli/main.py predict --dir samples --save-rotated-dir samples_out --device cpu`.
- 上書きしたくない場合、`--save-rotated` / `--save-rotated-dir` を付けずに判定のみ出力。

## License / Credit
- MIT License。同梱モデルもMIT扱い。  
- モデル作者: 新野ユキ (Yuki Arano) — Twitter: @yuki_arano, GitHub: ObuchiYuki, 元ツイート: https://x.com/yuki_arano/status/1788051297108902073, iOS App: https://apps.apple.com/jp/app/ai%E3%81%8C%E5%86%99%E7%9C%9F%E3%81%AE%E5%90%91%E3%81%8D%E3%82%92%E4%BF%AE%E6%AD%A3-%E3%81%8F%E3%82%8B%E3%82%8Aai/id6480589907
