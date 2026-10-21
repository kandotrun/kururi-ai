# くるりAI v2.0.0

画像の補正方向を `0`、`90`、`180`、`270` 度の時計回り角度として推定する
Rust/ONNX CLIです。v2では3つのConvNeXtモデルを統合し、通常は2モデル、
判定が僅差のときだけ3モデル目を使うカスケードにしました。

凍結した非公開テストでは、同じ画素・同じ704回転条件でv1が626/704
（88.92%）、v2が700/704（99.43%）でした。4032×3024 JPEGの新規プロセス
待ち時間は、Apple M4 Maxで中央値418.6 ms、p95 461.5 msです。

## v1からの改善

| 指標 | v1（元モデル） | v2.0.0 | 改善 |
|---|---:|---:|---:|
| 4方向の正解 | 626/704（88.92%） | **700/704（99.43%）** | **+74件 / +10.51ポイント** |
| シーン群マクロ正解率 | 83.35% | **99.36%** | **+16.01ポイント** |
| 4方向すべて正解した写真 | 141/176（80.11%） | **175/176（99.43%）** | **+34枚 / +19.32ポイント** |
| 誤判定 | 78件 | **4件** | **94.87%減** |
| 12MP JPEGの待ち時間 | 3,932 ms | **418.6 ms** | **約9.4倍高速** |

誤判定は78件から4件へ減りました。カテゴリ別では、スクリーンが
111/176から**176/176**、シーンが199/208から**208/208**へ改善しています。
残る4件は同じcloseupの写真から出たものです。

改善幅はシーン群単位のブートストラップで、4方向精度
**+5.24〜+17.95ポイント**（95%区間）です。速度は macOS ARM64の同一画像で
測った参考値で、v1のPython/MPS経路とv2のRust/ONNX CPU経路を比較しています。

## ダウンロード

配布物は [GitHub Releases v2.0.0](https://github.com/kandotrun/kururi-ai/releases/tag/v2.0.0)
にあります。

- [ブラウザで試せるv2-nanoデモ](https://kururi-ai.2-38.com/)
- `kururi-ai-v2.0.0-macos-arm64.tar.gz`
- `kururi-ai-v2.0.0-linux-x86_64.tar.gz`
- `kururi-ai-v2.0.0-model.tar.gz`（3モデル共通）
- `SHA256SUMS`

Webデモは約11.9MBの軽量NanoモデルをONNX Runtime Web/WASMで実行します。
3Dの作業机にWikimedia Commonsの特選写真を数千枚わざと回転させて流し込み、
ブラウザの中で向きを判定して並べ直します。自分の写真もドロップでき、外部へは
送信しません。Nanoは未使用テスト81.82%で、フルv2.0.0の99.43%とは別の
デモ用モデルです。

評価データ、ラベル、速度条件、モデルハッシュ、不確実性と残る制約は
[モデルカード](MODEL_CARD.md)と
[ベンチマークレポート](BENCHMARK_REPORT.md)に記載しています。テストは
176枚・78シーン群で、正解ラベルは所有者の前提とAI目視確認による暫定値です。
一般的な写真すべてで99.43%になるという意味ではありません。

## 配布物の使い方

ランタイム側に`kururi-native`、`kururi`、ONNX Runtime共有ライブラリを、
モデル側に3つの`.onnx`と同名の`.onnx.data`を置きます。配布物を同じ親
ディレクトリへ展開した場合、`kururi`が標準構成を自動指定します。

```sh
./kururi predict --image /path/to/photo.jpg
```

モデルディレクトリが実行ファイル隣の`models/`でない場合:

```sh
KURURI_MODEL_DIR=/path/to/models \
  ./kururi predict --image /path/to/photo.jpg
```

補正画像を新しいファイルへ保存:

```sh
./kururi predict \
  --image /path/to/photo.jpg \
  --output /path/to/corrected.jpg
```

モデル読込を再利用してディレクトリを処理:

```sh
./kururi predict \
  --dir /path/to/photos \
  --output-dir /path/to/new-output-directory
```

既存ファイルや既存出力ディレクトリは上書きしません。ディレクトリ内の
シンボリックリンクはたどりません。個別画像のエラーはJSON結果に残り、
1件でも失敗した場合の終了コードは`2`です。

対応形式はJPEG、PNG、WebP、TIFF、BMPです。HEIC、DNG、NEFなどのRAWは
現在ネイティブデコードできません。変換する場合も元のEXIFの向きを失わないで
ください。

## ソースからのビルド

Rust 1.96以降、C/C++リンカー、Python 3.12が必要です。ONNX Runtimeを取得して
実行ファイルの隣へ配置します。

```sh
cargo build --release --locked --manifest-path native/Cargo.toml
python3.12 -m venv .venv-native
.venv-native/bin/python -m pip install -r native/requirements-native.txt
.venv-native/bin/python scripts/prepare_native_runtime.py \
  --binary native/target/release/kururi-native \
  --destination dist/native-runtime
```

配布モデルを`dist/native-runtime/models/`へ置くと、
`dist/native-runtime/kururi`をそのまま使えます。配置後の推論にPythonは不要です。

直接バイナリを呼ぶ場合の標準構成:

```sh
./kururi-native predict \
  --model models/convnext-base-224.onnx --model-weight 0.5 \
  --model models/convnext-small-288.onnx --model-weight 0.4 \
  --fallback-model models/convnext-small-224.onnx \
  --fallback-weight 0.1 \
  --fallback-margin 0.033333333 \
  --parallel-models \
  --threads 12 \
  --image /path/to/photo.jpg
```

## 入出力

最初にEXIFの向きを画素へ適用します。`correction_cw`は、その表示状態の画素に
適用する時計回りの補正角です。保存時も同じ方向へ回転します。

保存結果は元解像度の画素から再エンコードされ、元のEXIF/ICCメタデータは
引き継ぎません。JPEG保存は非可逆で、現在の品質は75です。出力を指定しなければ
入力画像は読み取り専用です。

`--min-confidence`はsoftmax最大確率が閾値未満の画像を保存せず、判定保留に
できます。既定値は`0`です。確率校正は行っていないため、高確率でも正解を
保証しません。

標準構成は4方向入力を各モデルの1バッチとして推論します。2つの一般モデルは
並列実行し、上位2クラスの確率差が`0.033333333`未満のときだけ、Small-224を
読み込んで追加推論します。

## データと評価

方向判定の学習・検証・テストには、owner提供の非公開写真を使いました。EXIFを
適用したRGB画素を最大辺1,024へ正規化し、学習と評価の前に元画像・シーン群単位で
分割しています。

追加調査として、Wikimedia Commons 1,120枚、iNaturalist 1,700枚、
合成UI 1,000枚も収集し、v6-v9の候補を学習・比較しました。最終リリースは
検証データで選ばれたv5系3モデルの統合で、Wikimedia/iNaturalist候補は最終重みに
含まれません。合成UI 958枚はSmall-224モデルの学習に使われています。

公開元画像、個人写真、ファイルパス付き評価記録、画像ごとの予測は配布しません。
詳細は[MODEL_CARD.md](MODEL_CARD.md)を参照してください。

## v1との互換性

従来のPython CLIとViTモデルは[v1の使い方](docs/LEGACY_V1.ja.md)に残しています。
v1の`angle_ccw`は保存処理の回転方向を正しく表していなかったため、v2では
`correction_cw`を使用します。v1とv2の重みだけを入れ替えることはできません。

## ライセンス

プロジェクトコードはMITです。v2モデルはApache-2.0を宣言するtimm ConvNeXt
事前学習重みの派生で、向き分類用の変更とONNX変換を行っています。
[第三者のライセンスとクレジット](THIRD_PARTY_NOTICES.md)を参照してください。

従来のv1向き判定モデルの作者は
[新野ユキ / Yuki Arano](https://github.com/ObuchiYuki)です。

[English](README.md)
