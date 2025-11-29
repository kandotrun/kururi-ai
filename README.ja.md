# くるりAI CLI

ViTモデルで画像の回転角を判定するCLIです。CPU / CUDA / Apple MPSで動作し、チェックポイントはGitHub Releaseから初回自動ダウンロードできます。単一ファイルまたはディレクトリ再帰処理に対応し、補正画像の保存も行えます。

## 特徴
- 初回実行時にモデルが無ければ自動ダウンロード（URL・sha256は引数または環境変数で設定可能）
- 単一画像とディレクトリ一括処理の両対応
- 補正済み画像の保存オプションあり
- Pythonのみで完結し、型付き・最小依存

## 必要環境
- Python 3.12.9
- PyTorch, TorchVision, timm, Pillow（`uv pip install -e cli` で導入）

## セットアップ
```bash
cd /Users/kan/UGREEN-NAS/DEVELOP/kandotrun/kururi-ai
uv venv .venv
source .venv/bin/activate
uv pip install -e cli
```

## モデル自動ダウンロード
- `models/checkpoint.pth` が無い場合、指定URLから取得します。
```bash
export KURURI_MODEL_URL="https://github.com/<owner>/<repo>/releases/download/v0.1/checkpoint.pth"
export KURURI_MODEL_SHA256="<sha256sum>"
export KURURI_MODEL_TIMEOUT=1800   # 任意
```
- デフォルトURLはプレースホルダ `https://github.com/OWNER/REPO/releases/download/v0.1/checkpoint.pth` なので、公開後に実URLへ置き換えてください。

## 使い方
単一画像:
```bash
uv run python cli/main.py predict \
  --image /path/to/image.jpg \
  --device cpu \
  --model-name vit_large_patch16_224 \
  --save-rotated /path/to/fixed.jpg
```

ディレクトリ再帰処理:
```bash
uv run python cli/main.py predict \
  --dir /path/to/images \
  --save-rotated-dir outputs \
  --device cpu \
  --model-name vit_large_patch16_224
```
対応拡張子: jpg, jpeg, png, bmp, tif, tiff, webp。

### チェックポイント関連オプション
- `--checkpoint` 保存先パス（既定 `models/checkpoint.pth`）
- `--checkpoint-url` ダウンロードURL
- `--checkpoint-sha256` 整合性検証用ハッシュ
- `--download-timeout` タイムアウト秒（既定 1800 または `KURURI_MODEL_TIMEOUT`）

## GitHub Release への登録手順
1. ハッシュ取得: `shasum -a 256 models/checkpoint.pth`
2. Releaseを作成し、アセットとして `checkpoint.pth` をアップロード。
3. READMEと環境変数例、コード内のデフォルトURLを実URLとsha256に更新。

## ライセンス
- コードと同梱モデルは MIT ライセンスで提供します。`LICENSE` を参照してください。
