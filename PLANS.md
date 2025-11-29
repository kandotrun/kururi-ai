# Electronデスクトップ版 実装計画 (ExecPlan)

## ゴール
- 既存Python CLIの画像回転推定を、Electronベースのデスクトップアプリとして提供する。
- macOSとWindows両対応で、初回起動時にモデルを自動取得し、単一画像・ディレクトリ一括処理を行えるUIを備える。

## 前提・方針
- バックエンドは既存CLIを呼び出す形で最初は実装し、後続でNodeネイティブ統合を検討。
- 配布形態は開発者向け(`npm start`)に加え、`electron-builder`でmacOS(dmg/zip)とWindows(nsis/zip)を生成。
- Pythonは同梱(埋め込みPythonまたはpython-build-standaloneをバンドル)し、ユーザーに別途Pythonインストールを要求しない。
- 依存管理は`npm`または`pnpm`。Python側は同梱環境にpip/uvを事前展開し、CLI実行に利用。

## タスク
1. **環境準備**: `app/`(Electron)ディレクトリ新設、`package.json`作成、ESLint/Prettier設定、TypeScript導入可否判断。
2. **プロセス設計**: メイン/レンダラ分離、IPCチャネル設計。CLI呼び出し用ラッパ(子プロセス/`python -m cli.main`)を決める。
3. **Pythonバンドル戦略**: macOS/Windowsで共通のPython配布方法を選定（埋め込みPython or python-build-standalone）、バージョン固定、ライセンス確認、配置パスと起動スクリプトを決める。
4. **モデル取得統合**: 既存`download_utils.ensure_checkpoint`をCLI経由で呼ぶか、Node側で同等処理を行うかを決め、実装。
5. **UIモック**: 画面遷移無しの単一ウィンドウで、
   - 画像/ディレクトリ選択(ドラッグ&ドロップ対応)
   - 実行ボタンと進捗ログ
   - 出力先選択(上書き/別ディレクトリ)
   - `--skip-broken`相当のトグル
6. **機能実装**: IPC経由で処理開始→NodeがCLIを子プロセス実行→標準出力をレンダラへストリーミング表示。終了コード/エラー処理を実装。
7. **バッチ処理/プレビュー**: 進行中の件数・残数表示。プレビュー(任意)は後続タスクとして分離。
8. **設定保存**: 最近使った入力/出力パス・デバイス選択(cpu/mps/cuda)を`appData`配下に保存。
9. **ビルド/署名準備**: macOS(dmg/zip)とWindows(nsis/zip)向け`electron-builder`設定、アプリアイコン配置。署名/Notarize/コードサイニング証明書はメモだけ残す。
10. **ドキュメント**: READMEに開発手順・実行手順を追加し、日本語版にも追記。リリース手順簡潔に記載。
11. **テスト/CI**: macOS/WindowsのGitHub Actions行を追加し、lint/format、`uv run pytest`、Electronスモーク(`electron-builder --dir`生成→起動確認)を実行。

## リスク・検討事項
- Pythonバンドルのサイズ増: macOS/Windows両向けにPythonを同梱するため配布物が大型化する。
- ライセンス確認: 埋め込みPython/同梱パッケージの配布条件を再確認する必要。
- モデルサイズ配布: Releaseからのダウンロード時間と失敗時リカバリ。
- GPU選択: macOSはmps/cpu、Windowsはcpu/（任意でCUDA/DirectML案内）を明示する。

## 成果物
- `app/`配下のElectronプロジェクト一式
- 動作手順を追記したREADME(英/日)
- CIジョブ( lint / テスト / ビルド検証 )
