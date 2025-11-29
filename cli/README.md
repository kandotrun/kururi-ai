# くるりAI CLI 利用方法

## 前提
- Python 3.12.9
- ルート直下にモデルファイル `models/checkpoint_9.pth` が配置されていること
- 推論にGPUを使う場合は CUDA が利用可能な環境

## セットアップ
```bash
uv venv .venv
source .venv/bin/activate
uv pip install -e cli
```

## 実行
画像の回転クラスを推論します。クラスは `0,1,2,3` がそれぞれ `0°/90°/180°/270°` (反時計回り) を表します。

```bash
uv run python cli/main.py predict --image <path_to_image> \
  [--device cpu|cuda:0] \
  [--checkpoint models/checkpoint_9.pth] \
  [--checkpoint-url https://example.com/checkpoint_9.pth] \
  [--checkpoint-sha256 <hash>] \
  [--download-timeout 1800] \
  [--model-name vit_large_patch16_224] \
  [--save-rotated output.jpg]

# ディレクトリ単位の一括処理
指定ディレクトリ配下の対応拡張子（jpg/jpeg/png/bmp/tif/tiff/webp）を再帰的に処理します。

```bash
uv run python cli/main.py predict \
  --dir <path_to_dir> \
  [--device cpu|cuda:0] \
  [--checkpoint models/checkpoint_9.pth] \
  [--model-name vit_large_patch16_224] \
  [--save-rotated-dir outputs]
```

`--save-rotated-dir` を指定すると、入力ディレクトリからの相対パスで補正画像を保存します。

## モデル自動ダウンロード
- チェックポイントが無い場合、`--checkpoint-url` か環境変数 `KURURI_MODEL_URL` で指定したURLから自動で取得します。
- 整合性を確認する場合は `--checkpoint-sha256` か `KURURI_MODEL_SHA256` を設定してください。
- タイムアウトは `--download-timeout` か `KURURI_MODEL_TIMEOUT`（秒）で変更できます。
- デフォルトURLは `https://github.com/OWNER/REPO/releases/download/v0.1/checkpoint_9.pth` になっているため、公開時に実際のRelease URLへ差し替えてください。

### 環境変数例
```bash
export KURURI_MODEL_URL="https://github.com/<owner>/<repo>/releases/download/v0.1/checkpoint_9.pth"
export KURURI_MODEL_SHA256="<sha256sum>"
```

## Release へのモデル登録手順（例）
1. チェックポイントのハッシュ取得  
   `shasum -a 256 models/checkpoint_9.pth`
2. GitHub Release を作成し、`checkpoint_9.pth` をアセットとしてアップロード。
3. 上記URLとハッシュをREADMEと環境変数例に反映。
```

### 出力例
```
rotation_class=1 angle_ccw=90
class_0: 0.0123
class_1: 0.9431
class_2: 0.0320
class_3: 0.0126
rotated_image_saved=output.jpg
```

`--save-rotated` を指定すると、予測クラス分だけ時計回りに補正した画像を保存します。

## モデルと前処理
- 学習時と同じ ViT 系 (`vit_large_patch16_224`) を使用し、出力クラスは4クラス
- 前処理はAutoCropで短辺224pxにリサイズした後、224x224にクロップし `ToTensor` のみ適用
- チェックポイントに `module.` プレフィックスが含まれていても自動で除去して読み込みます
