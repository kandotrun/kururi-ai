# くるりAI v2

画像を正しい向きにするための、0・90・180・270度の補正角を推定するCLIです。
v2候補ではRust製CLIとONNXモデルを使います。モデルはImageNetで事前学習された
画像分類モデルに、画像の向き判定を追加学習したものです。検証データで選んだ
候補は`convnext_tiny.fb_in22k_ft_in1k`です。MobileNetV4は比較候補で、この
リリース成果物には含めません。

**現在は実験用`v2.0.0-rc.1`候補です。** 凍結した78枚のテスト写真では、4方向を
合わせたv1の正解は298/312、v2は292/312でした。ベンチマークしたMacではv2の
4方向推論が大幅に速い一方、精度の点推定は下回っています。v1を安定版として残し、
使用前に[モデルカード](MODEL_CARD.md)の限界を確認してください。

## ビルドと実行

推論にはCPU版ONNX Runtimeを使います。ソースからのビルドにはRustとC/C++リンカー、
ランタイムの取得にはPython 3.12が必要です。モデルの`.onnx`ファイルと、存在する
場合は外部データファイルを同じディレクトリに置いてください。

```sh
cargo build --release --locked --manifest-path native/Cargo.toml
python3.12 -m venv .venv-native
.venv-native/bin/python -m pip install -r native/requirements-native.txt
.venv-native/bin/python scripts/prepare_native_runtime.py \
  --binary native/target/release/kururi-native \
  --destination dist/native-runtime
./dist/native-runtime/kururi-native predict \
  --model models/kururi-orient-v2.onnx \
  --image /path/to/photo.jpg
```

モデルにはv2の前処理とクラス順を示すメタデータが必要です。学習元と配布ファイルの
ハッシュはモデルカードとメタデータで確認できます。学習に使った非公開の画像は
リポジトリに含めません。

補正画像を新しいパスへ保存する場合:

```sh
./dist/native-runtime/kururi-native predict \
  --model models/kururi-orient-v2.onnx \
  --image /path/to/photo.jpg \
  --output /path/to/corrected.jpg
```

モデルを読み込んだままディレクトリを処理する場合:

```sh
./dist/native-runtime/kururi-native predict \
  --model models/kururi-orient-v2.onnx \
  --dir /path/to/photos \
  --output-dir /path/to/new-output-directory
```

対応形式はJPEG、PNG、WebP、TIFF、BMPです。ディレクトリ内のシンボリックリンクは
たどりません。既存の出力ファイルや出力ディレクトリは上書きしません。画像ごとの
エラーは結果に残し、ディレクトリ処理で1件でも失敗した場合は終了コード2を返します。
HEIC、DNG、NEFなどのRAW形式はこのバイナリではデコードしません。対応画像へ変換する
段階でも、元のEXIFの向きを失わないようにしてください。

実行ファイルはONNX Runtimeの共有ライブラリを読み込みます。上の補助スクリプトは
実行ファイル、ランタイムとそのライセンスを新しいディレクトリへ配置します。
これは最終的なリリース梱包とは別の工程です。ランタイムは実行ファイルの隣に保持
してください。配置後のネイティブCLIの実行にはPythonは不要です。
`--runtime-library`または`ORT_DYLIB_PATH`で読み込むライブラリを指定することも
できます。最終配布物にはプロジェクトとCargo依存ライブラリのライセンスも必要です。

## 補正角と保存の扱い

最初にEXIFの向きを適用します。結果の`correction_cw`は、その表示状態の画素に
適用する**時計回りの補正角**です。値は`0`、`90`、`180`、`270`のいずれかで、
画像の保存時にも同じ方向へ回転します。

保存結果は元の解像度で回転後の画素から再エンコードされます。推論用のRGB変換は
保存用の画素を置き換えません。元のEXIFやICCメタデータは引き継ぎません。
JPEG保存は無劣化ではありません。出力指定がなければ入力画像の読み取りのみを
行います。
現在のJPEG保存品質は75です。

`--min-confidence`を指定すると、softmaxスコアが閾値未満の画像を判定保留にし、
補正画像を保存しません。既定値は`0`で、すべての予測を採用します。スコアの確率校正は
行っていないため、高い値でも正解を保証するものではありません。

## 速度と精度の評価

1枚を処理するときの待ち時間は、CLIのプロセス起動から終了までを外側で測定します。
出力中の`internal_total_ms`にはプロセス起動、動的ライブラリの読み込み、
JSON出力、プロセス終了の時間が入りません。`--runs`で繰り返す測定は読み込み済み
モデルと同じ入力を再利用するため、単発コマンドの待ち時間とは区別します。

現在のRust候補はCPU推論のみです。Core ML、MPS、CUDAは有効にしていません。
性能を比較する際の機種、画像形式、テスト件数、測定条件は
[モデルカード](MODEL_CARD.md)で確認してください。

選択モデルのメタデータは4方向推論を推奨します。入力テンソルを4方向に回転して
それぞれ推論し、補正方向を揃えた確率を平均します。`--views 1`の明示指定は実験用で、
このチェックポイントのテスト精度は66.0%でした。`--threads`を省略した場合は、
利用可能なCPU数を使用し、上限を8にします。

学習と評価の手順は[docs/TRAINING.md](docs/TRAINING.md)、配布の確認事項は
[docs/RELEASE.md](docs/RELEASE.md)に記載しています。

## v1との互換性

従来のPython CLIとViTモデルは別途残します。
[v1の使い方](docs/LEGACY_V1.ja.md)を参照してください。v1の`angle_ccw`という
出力名は実際の保存時の回転方向と一致していなかったため、v2では明確な
`correction_cw`へ変更します。EXIFの適用とモデルの前処理も異なります。
v1とv2の重みだけを入れ替えて使うことはできません。

## ライセンスとクレジット

このプロジェクトのコードはMITです。v2モデルはApache-2.0の事前学習済み重みから
追加学習しており、配布時には適用されるライセンスとクレジットを同梱します。
コードのライセンスが、モデルや依存ライブラリのライセンスを置き換えるわけでは
ありません。[第三者のライセンスとクレジット](THIRD_PARTY_NOTICES.md)を参照してください。

従来のv1向き判定モデルの作者は[新野ユキ / Yuki Arano](https://github.com/ObuchiYuki)
です。v1へのクレジットは保持し、v2の学習内容と限界はモデルカードに分けて記載します。

[English](README.md)
