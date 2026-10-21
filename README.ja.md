<div align="center">

# くるりAI

**横向きや逆さまの写真を、くるっと正しい向きに直します。**

写真が横向きや逆さまになっていないかを判定し、どれだけ回せば正しい向きになるかを教えてくれます。正しい向きにしたコピーの保存もできます。<br>
AppleシリコンのMacかLinux（x86-64）のターミナルで使うコマンドで、最初に約700MBのダウンロードが必要です。処理はすべて手元のパソコンの中で完結します。

[![Release](https://img.shields.io/github/v/release/kandotrun/kururi-ai?label=release&color=2B5A4A)](https://github.com/kandotrun/kururi-ai/releases/latest)
[![Native CI](https://github.com/kandotrun/kururi-ai/actions/workflows/native-ci.yml/badge.svg)](https://github.com/kandotrun/kururi-ai/actions/workflows/native-ci.yml)
[![Code license: MIT](https://img.shields.io/badge/code%20license-MIT-2B5A4A)](LICENSE)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-kandotrun%2Fkururi--ai-2B5A4A)](https://deepwiki.com/kandotrun/kururi-ai)

**[ブラウザで試す](https://kandotrun.github.io/kururi-ai/)**&emsp;**[v2.0.0をダウンロード](#ダウンロード)**&emsp;**[クイックスタート](#クイックスタート)**&emsp;[Read in English](README.md)

</div>

## できること

写真を渡すと、**時計回り**に何度回せば正しい向きになるかを、`correction_cw` という値で答えます。

<table>
  <tr>
    <th></th>
    <th>駐車場の車</th>
    <th>倉庫</th>
    <th>手に持ったカメラ</th>
  </tr>
  <tr>
    <th>補正前</th>
    <td align="center"><img src="docs/images/samples/1-before.webp" height="96" alt="横向きになった車の写真"></td>
    <td align="center"><img src="docs/images/samples/3-before.webp" height="96" alt="横向きになった倉庫の写真"></td>
    <td align="center"><img src="docs/images/samples/5-before.webp" height="96" alt="逆さまになったカメラの写真"></td>
  </tr>
  <tr>
    <th>補正後</th>
    <td align="center"><img src="docs/images/samples/1-after.webp" height="96" alt="正しい向きの車の写真"></td>
    <td align="center"><img src="docs/images/samples/3-after.webp" height="96" alt="正しい向きの倉庫の写真"></td>
    <td align="center"><img src="docs/images/samples/5-after.webp" height="96" alt="正しい向きのカメラの写真"></td>
  </tr>
  <tr>
    <th>回す角度</th>
    <td align="center"><code>270</code><br>左に90°</td>
    <td align="center"><code>90</code><br>右に90°</td>
    <td align="center"><code>180</code><br>半回転</td>
  </tr>
</table>

直せるのは90°単位の回転だけです。わずかに傾いた水平線などは直しません。

## v2の改善点

v2はPythonなしで単体で動くコマンドに生まれ変わり、新たに学習した3つのモデルを組み合わせて判定します。v1と同じテスト写真で比べると正解が大きく増え、1200万画素の写真1枚の処理も大幅に速くなりました。

| | v1 | **v2.0.0** |
|---|---:|---:|
| 正しく判定できた件数（704件中） | 626件（88.92%） | **700件（99.43%）** |
| 誤判定の件数 | 78件 | **4件**（94.87%減） |
| 4つの向きすべてで正しく判定できた写真（176枚中） | 141枚（80.11%） | **175枚（99.43%）** |
| 1200万画素の写真1枚の処理時間（Apple M4 Max） | 3.93秒 | **0.42秒**（約9.4倍速） |

<sub>テストには学習に使っていない非公開の写真176枚を使い、それぞれを0°、90°、180°、270°に回した計704件で判定しました。v1とv2にはまったく同じ画像を入力しています。この写真群での結果であり、どんな写真でも同じ精度になるという意味ではありません。速度の測定条件やほかの指標は<a href="#v1とv2の詳しい比較">v1とv2の詳しい比較</a>にあります。</sub>

## ダウンロード

[GitHub Releases v2.0.0](https://github.com/kandotrun/kururi-ai/releases/tag/v2.0.0) から、**2つのファイル**をダウンロードします。お使いのパソコン用のプログラムと、共通のAIモデルです。

| お使いのパソコン | 1. プログラム | 2. モデル（共通） |
|---|---|---|
| AppleシリコンのMac | [`kururi-ai-v2.0.0-macos-arm64.tar.gz`](https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/kururi-ai-v2.0.0-macos-arm64.tar.gz)（10MB） | [`kururi-ai-v2.0.0-model.tar.gz`](https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/kururi-ai-v2.0.0-model.tar.gz)（693MB） |
| Linux x86-64 | [`kururi-ai-v2.0.0-linux-x86_64.tar.gz`](https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/kururi-ai-v2.0.0-linux-x86_64.tar.gz)（12MB） | 上と同じモデル |

お使いのMacがわからないときは、アップルメニュー >「このMacについて」を開きます。「チップ」に「Apple M…」と表示されれば、AppleシリコンのMacです。

Pythonは不要です。Intel Mac、Windows、ARM版Linux向けのビルド済みプログラムはありません。[`SHA256SUMS`](https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/SHA256SUMS) に、すべての配布ファイルのチェックサムが載っています。

> [!TIP]
> まずは気軽に試してみたいなら、インストール不要の[ブラウザデモ](#ブラウザデモ)をどうぞ。

## クイックスタート

**1. ダウンロード**：新しいフォルダに2つのファイルを保存します。Linuxでは `macos-arm64` を `linux-x86_64` に読み替えてください。

```sh
mkdir ~/kururi && cd ~/kururi
curl -LO https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/kururi-ai-v2.0.0-macos-arm64.tar.gz
curl -LO https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/kururi-ai-v2.0.0-model.tar.gz
```

<details>
<summary>任意：展開する前にファイルが壊れていないか確認する</summary>

```sh
curl -LO https://github.com/kandotrun/kururi-ai/releases/download/v2.0.0/SHA256SUMS
shasum -a 256 -c --ignore-missing SHA256SUMS
```

Linuxでは `sha256sum -c --ignore-missing SHA256SUMS` を使います。プログラムのアーカイブにも同じ名前の `SHA256SUMS` が入っていて、展開すると上書きされるため、確認は展開する前に行ってください。

</details>

**2. 展開**：2つのアーカイブを同じフォルダで展開します。

```sh
tar -xzf kururi-ai-v2.0.0-macos-arm64.tar.gz
tar -xzf kururi-ai-v2.0.0-model.tar.gz
```

これで、実行用の `kururi`、本体の `kururi-native` とONNX Runtimeライブラリ、`models/` フォルダが同じフォルダにそろいます。移動するときは、ばらばらにせずフォルダごと動かしてください。以降のコマンドはこのフォルダの中で実行します。次にターミナルを開いたときは `cd ~/kururi` で戻れます。

> [!NOTE]
> **ブラウザでダウンロードした場合**は、2つの `.tar.gz` ファイルを `~/kururi` に移してから、そこで2つの `tar` コマンドを実行してください。ブラウザがすでに展開していた場合は、`models` フォルダが `kururi` と同じ場所にあるようにしてください。
>
> macOS版のプログラムは、Apple Developer IDでの署名とAppleの公証（notarization）を受けていません。`curl` でダウンロードした場合は問題ありません。`kururi-native` について「開発元を検証できない」などの警告が出たときは、`kururi` があるフォルダで次のコマンドを一度だけ実行し、ダウンロード時に付いた隔離の印（quarantine属性）を外してください：`xattr -dr com.apple.quarantine .`

**3. 向きを調べる**：`~/Pictures/photo.jpg` はお手元の写真に置き換えてください。`./kururi predict --image `（最後に空白）まで入力し、Finderから写真をターミナルのウィンドウにドラッグすると、パスが入力されます。名前に空白がある写真でも使えます。写真を読み込むだけで、ファイルには何も書き込みません。

```sh
./kururi predict --image ~/Pictures/photo.jpg
```

**4. 正しい向きのコピーを保存**：新しいファイル名を指定します。コピーは画像を新しく書き出したファイルで、撮影日時・位置情報・カメラ情報などのEXIFは引き継がれません。元の写真を消す前に[知っておきたいこと](#知っておきたいこと)を読んでください。

```sh
./kururi predict --image ~/Pictures/photo.jpg --output ~/Pictures/photo-upright.jpg
```

## 結果の読み方

結果は1行のJSONで表示されます。答えは `correction_cw` で、ほかはスコアや処理時間、モデルの情報などの詳細です。主な項目を抜き出して見やすく整えると、次のようになります（値は一例です）。

```json
{
  "correction_cw": 90,
  "probabilities": [0.004, 0.987, 0.003, 0.006],
  "accepted": true,
  "saved": false
}
```

| 項目 | 意味 |
|---|---|
| `correction_cw` | 正しい向きにするために**時計回り**に回す角度。`0` は回転不要、`90` は右に90°、`180` は半回転（逆さまの写真）、`270` は左に90° |
| `probabilities` | 回す角度が0°、90°、180°、270°それぞれの場合のスコア（この順） |
| `accepted` | 最も高いスコアが `--min-confidence` に届かないと `false` になり、保存もされません |
| `saved` | 正しい向きのコピーを書き出したら `true` |

くるりAIは、写真アプリで表示されるのと同じ向きで写真を判定します（カメラが記録したEXIFの回転情報を先に反映します）。つまり `correction_cw` は、画面で見たままの写真を基準にした角度です。

答えだけを表示したいときは [jq](https://jqlang.github.io/jq/) を使えます。最近のmacOSには最初から入っていて、Linuxでもパッケージマネージャーで入れられます。

```sh
./kururi predict --image ~/Pictures/photo.jpg | jq .correction_cw
```

## フォルダをまとめて直す

```sh
./kururi predict --dir ~/Pictures/trip --output-dir ~/Pictures/trip-upright
```

- サブフォルダの中も処理し、`--output-dir` の下に同じフォルダ構成で保存します。モデルの読み込みは最初の1回だけなので、1枚ずつ実行するより速く終わります。
- `--output-dir` には、まだ存在しないフォルダを指定します。フォルダはくるりAIが作りますが、その親フォルダはあらかじめ用意しておいてください。
- 最後の写真が終わるまで何も表示されないため、写真が多いと数分止まって見えることがあります。そのまま待ってください。
- JSONの `results` に、写真ごとの結果が `path` 付きで並びます。読めない写真には結果の代わりに `error` が記録されますが、ほかの写真の処理はそのまま続きます。このとき終了コードは `2` になります。
- 読み込むのは、拡張子が `.jpg` `.jpeg` `.png` `.webp` `.tif` `.tiff` `.bmp` のファイルだけです。それ以外のファイル（iPhoneのHEICやカメラのRAWなど）とシンボリックリンクは飛ばし、コピーもしません。これらの拡張子でも中身を読めないファイル（macOSの `._photo.jpg` のようなメタデータファイルなど）は `error` として記録されます。
- `--min-confidence` で保存を見送った写真も、`--output-dir` にはコピーされません。

結果をファイルに残し、回転が必要だった写真と失敗した写真だけを一覧にすると、確認しやすくなります。

```sh
./kururi predict --dir ~/Pictures/trip --output-dir ~/Pictures/trip-upright > trip.json
jq -r '.results[] | select(.error or .correction_cw != 0) | "\(.correction_cw // "error")\t\(.path)"' trip.json
```

## 知っておきたいこと

- **元の写真は変更しません**。`--output` も `--output-dir` も付けなければ、読むだけです。保存先にすでにファイルやフォルダがあると、上書きせず、何も処理しないまま止まります。
- **保存したコピーは、画像を新しく書き出したファイルです**。撮影日時・位置情報・カメラ情報などのEXIFや、カラープロファイルは引き継ぎません。JPEGは品質75で保存するため、元の写真より少し画質が落ちます。WebPは劣化のない可逆圧縮で保存するため、ファイルサイズが大きくなることがあります。保存形式は出力ファイルの拡張子で決まり、`0`（回転不要）と判定された写真も新しく書き出されます。
- **直せるのは90°単位の回転だけです**。わずかな傾きは直しません。
- **対応形式**：JPEG、PNG、WebP、TIFF、BMP。iPhone標準のHEICやRAW（DNG、NEFなど）は読めません。写真アプリの「ファイル」>「書き出す」などで先にJPEGとして書き出すと、正しい表示の向きのまま使えます。`--dir` には書き出した写真を入れた普通のフォルダを指定し、写真ライブラリそのものは指定しないでください。
- **スコアは目安です**。`--min-confidence 0.9` を付けると、最も高いスコアが0.9未満の写真は保存しません（`"accepted": false`）。既定値の `0` ではすべて保存します。
- **元の写真を消す前に、結果を確かめてください**。もともと正しい向きの写真を回してしまうことも、まれにあります。保存したコピーには元のメタデータも残りません。

## オプション

| オプション | 説明 |
|---|---|
| `--image FILE` | 写真を1枚判定します |
| `--dir FOLDER` | フォルダ内の対応する写真をすべて判定します（サブフォルダも含む） |
| `--output FILE` | `--image` と使います。正しい向きのコピーを新しいファイルに保存します |
| `--output-dir FOLDER` | `--dir` と使います。正しい向きのコピーを新しいフォルダに保存します |
| `--min-confidence N` | 最も高いスコアが `N` 未満なら保存しません（0〜1、既定値 `0`） |
| `KURURI_MODEL_DIR=PATH` | 環境変数です。モデルを別のフォルダから読み込みます（既定は `kururi` と同じ場所の `models/`） |

`kururi` では `predict` を省略しても動きます。`kururi` は常に12スレッドで動きます。スレッド数を変えたいときは、[しくみ](#しくみ)にあるように本体の `kururi-native` を直接実行してください。

| 終了コード | 意味 |
|---:|---|
| `0` | 完了（保存を見送った写真があっても `0`） |
| `1` | 標準エラー出力に `Error:` を表示して停止。JSONは出ません（例：`--image` の写真が読めない、保存先がすでにある、`--min-confidence 1.5` のような範囲外の値、`.onnx.data` が無いなどでモデルを読み込めない） |
| `2` | `--dir` の処理は終わったが失敗した写真がある（JSONは出ます）、`kururi` が3つの `.onnx` モデルファイルのどれかを見つけられない、またはオプションが不明・重複・値の欠落・使えない組み合わせ（`--dir` と `--output` など） |

## ブラウザデモ

[kandotrun.github.io/kururi-ai](https://kandotrun.github.io/kururi-ai/) では、約11.9MBの軽量モデル **v2-nano** を、ONNX Runtime Webでブラウザの中だけで動かします。写真はどこにも送信されません。

お試し用なので、たくさんの写真を本格的に直す用途には向きません。

- 補正結果を画面で確認するだけで、ファイルとして保存する機能はありません。
- 軽量なぶん精度は下がります。デモ用モデル向けの小さなテストでの正解率は396件中324件（81.82%）です。テストの条件が違うため、このページの表の数値とは直接比べられません。

手元の写真を直すときはコマンド版を使ってください。デモの詳細は [web/README.md](web/README.md) にあります。

## v1とv2の詳しい比較

| 指標 | v1 | v2.0.0 | 変化 |
|---|---:|---:|---:|
| 正しく判定できた件数 | 626/704（88.92%） | **700/704（99.43%）** | **+74件 / +10.51ポイント** |
| 撮影シーンごとの平均正解率¹ | 83.35% | **99.36%** | **+16.01ポイント** |
| 4つの向きすべてで正しく判定できた写真 | 141/176（80.11%） | **175/176（99.43%）** | **+34枚 / +19.32ポイント** |
| 誤判定の件数 | 78件 | **4件** | **94.87%減** |
| 4032×3024のJPEG写真1枚の処理時間² | 3,932ms | **418.6ms** | **約9.4倍速** |

<sub>¹ 同じ場面で撮った似た写真を1つの「撮影シーン」として78シーンに分け、シーンごとの正解率を平均した値です。似た写真が多いシーンに結果が偏らないようにしています。<br>
² Apple M4 Maxで、写真1枚ごとにプログラムを起動し、モデルの読み込みまで含めて計った時間の中央値です（v1は5回、v2は7回）。v2の95パーセンタイルは461.5msです。v1はPythonでAppleのGPU（MPS）を、v2はRustとONNX RuntimeでCPUの12スレッドを使っています。704件のテストを1つのプロセスでモデルを読み込んだまま実行したときは、1枚あたり185.7ms（中央値）でした。ただしテスト画像は長辺1,024px以下なので、1200万画素の写真の値ではありません。Linux x86-64版は、エミュレーション環境で動作を確認しただけで、速度は測っていません。</sub>

- 写真の種類別では、スクリーンショットが111/176件から**176/176件**に、風景写真が199/208件から**208/208件**になりました。
- 残る誤判定4件は、すべて同じ1枚の接写写真を回したものです。
- 正しく判定できた件数の割合の改善幅（+10.51ポイント）の95%信頼区間は **+5.24〜+17.95ポイント**です（撮影シーン単位の対応のあるブートストラップ）。
- 正しい向きのラベルは暫定的なものです。「元の写真はほとんど正しい向きで保存されている」という写真の所有者の申告に、AIによる独立した画像チェックを加えて決めており、人がすべてを確認したものではありません。

測定方法とすべての数値は [BENCHMARK_REPORT.md](BENCHMARK_REPORT.md) と [MODEL_CARD.md](MODEL_CARD.md) にあります。

## しくみ

くるりAIは、1枚の写真から4つの向きの画像を作り、2つのConvNeXtモデル（224pxのConvNeXt-Baseと288pxのConvNeXt-Small）に、モデルごとに1回のバッチで並行して判定させます。2つのモデルのスコアは、0.5と0.4の重みで足し合わせます。スコアが最も高い2つの向きの差が `0.033333333` より小さい僅差のときだけ、3つ目のモデル（224pxのConvNeXt-Small）を読み込み、重み0.1で判定に加えます。テストでは704件中24件で3つ目のモデルが使われました。

`kururi` は小さなシェルスクリプトで、中では本体の `kururi-native` を次の設定で実行しているだけです。

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

`--threads` などの設定を変えたいときは、`kururi-native` を直接実行します。`--threads` を省略すると、CPUの数（最大12）だけスレッドを使います。各 `.onnx` ファイルの隣には、同じ名前の `.onnx.data` ファイルが必要です。詳しくは [native/README.md](native/README.md) を参照してください。

## ソースからビルドする

最近の安定版Rust（1.96で確認済み）、C/C++のリンカー、ONNX Runtimeライブラリの取得に使うPython 3.12が必要です。macOSとLinuxでビルドできます。リポジトリのルートで実行し、`/path/to/` は[ダウンロード](#ダウンロード)で保存したモデルのアーカイブがあるフォルダに置き換えてください。

```sh
cargo build --release --locked --manifest-path native/Cargo.toml
python3.12 -m venv .venv-native
.venv-native/bin/python -m pip install -r native/requirements-native.txt
.venv-native/bin/python scripts/prepare_native_runtime.py \
  --binary native/target/release/kururi-native \
  --destination dist/native-runtime
cp scripts/kururi dist/native-runtime/
tar -xzf /path/to/kururi-ai-v2.0.0-model.tar.gz -C dist/native-runtime
dist/native-runtime/kururi predict --image samples/sample5.jpg
```

モデルのアーカイブを展開すると `dist/native-runtime/models/` ができます。`prepare_native_runtime.py` は保存先がすでにあると止まるため、やり直すときは先に `dist/native-runtime` を削除してください。この手順のあとはPythonは不要です。

## データと評価

学習・検証・テストには、リポジトリ所有者が持っている非公開の画像（スクリーンショットを含む）を使いました。どの画像もEXIFの回転情報を反映し、長辺が最大1,024pxになるようにしています。同じ元画像や同じ撮影シーンの画像が、学習・検証・テストのうち複数にまたがることはありません。

追加の実験として、Wikimedia Commonsの写真1,120枚とiNaturalistの観察写真1,700枚を集め、合成したUIのスクリーンショット1,000枚も作りました。WikimediaやiNaturalistを加えた候補モデルは、内部バージョンv6〜v9として試しました。毎回使う2つの汎用モデルは、検証データで選んだ内部バージョンv5のモデルで、WikimediaやiNaturalistを使った候補はどの配布モデルにも含まれていません。3つ目のモデル（224pxのConvNeXt-Small）は、非公開の学習用画像に加えて、合成したUIのスクリーンショットのうち958枚も学習に使っています。

元の画像、個人のファイルパス、画像ごとの予測結果は公開しません。集計した結果とモデルの来歴は [MODEL_CARD.md](MODEL_CARD.md) にあります。

## v1から移行する

v2は別のプログラムとして配布しています。[`cli/`](cli/) にあるPython版CLIはv1のままで、今も使えます（[v1の使い方](docs/LEGACY_V1.ja.md)）。そのため、このリポジトリを更新してもv2にはなりません。

| v1（`uv run python cli/main.py predict …`） | v2（`./kururi predict …`） |
|---|---|
| `--image FILE` / `--dir DIR` | 同じ |
| `--save-rotated FILE` | `--output FILE`（新しいファイルに限る） |
| `--save-rotated-dir DIR` | `--output-dir DIR`（新しいフォルダに限る） |
| `--device cpu`、`cuda`、`mps` | 不要（v2はCPUで動きます） |
| `--skip-broken` | 不要（`--dir` では読めない写真があっても処理を続け、JSONに記録します） |
| モデルの自動ダウンロード | なし（最初に一度、モデルのアーカイブを自分でダウンロードします） |
| テキスト出力 `angle_ccw=90` | JSON出力 `"correction_cw": 90` |

v1の `angle_ccw` は名前が間違っていました。v1の保存処理は、実際にはこの数値だけ**時計回り**に回しており、保存された画像は正しい向きでした。v2は、回す向きはv1と同じまま、実態に合った `correction_cw` という名前で値を返します。また、v2はv1と違い、EXIFの向き情報を反映してから判定します。v1とv2のモデルファイルは入れ替えて使えません。

## そのほかの資料

- [MODEL_CARD.md](MODEL_CARD.md)：モデルの来歴、評価、制約
- [BENCHMARK_REPORT.md](BENCHMARK_REPORT.md)：数値の測り方
- [RELEASE_NOTES.md](RELEASE_NOTES.md)：v2.0.0の変更点
- [native/README.md](native/README.md)：Rust製の本体、ONNXへの書き出し、動作確認テスト
- [web/README.md](web/README.md)：ブラウザデモ
- [docs/TRAINING.md](docs/TRAINING.md)：学習と評価のスクリプト
- [docs/RELEASE.md](docs/RELEASE.md)：リリース手順と配布物の構成
- [docs/LEGACY_V1.ja.md](docs/LEGACY_V1.ja.md)：v1のPython版CLI
- [SECURITY.md](SECURITY.md)：脆弱性を非公開で報告する方法
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)：依存関係の更新方針と監査手順

## ライセンスとクレジット

- プロジェクトのコードは [MIT](LICENSE) ライセンスです。
- v2のモデルは、timmのConvNeXt事前学習済み重み（timm側のモデルカードでApache-2.0とされているもの）をもとに作っています。分類部分の置き換え、向き判定のための追加学習、ONNXへの変換、複数モデルの組み合わせは、元の重みへの変更にあたります。詳しくは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を、ブラウザデモについては [web/THIRD_PARTY_NOTICES.md](web/THIRD_PARTY_NOTICES.md) を参照してください。
- v1の向き判定モデルの作者は [新野ユキ / Yuki Arano](https://github.com/ObuchiYuki) です。
