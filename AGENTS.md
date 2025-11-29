# Repository Guidelines

## プロジェクト構成とモジュール配置
- ルートには概要 `README.md` と本ガイドを配置します。  
- CLI 実装は `cli/main.py`、設定は `cli/pyproject.toml`（Python 3.12.9）。  
- 将来のモデル資産は `models/` 配下にサブディレクトリを切って整理してください。  
- ドキュメント追加時は `cli/README.md` か新設の `docs/` にまとめ、配置規則を明記します。  

## ビルド・テスト・開発コマンド
- 仮想環境: `uv venv .venv && source .venv/bin/activate` を標準とし、環境はリポジトリ直下に統一。  
- 依存インストール: `uv pip install -e cli`。依存追加が必要なときは `cd cli && uv add <package>` で `pyproject.toml` を更新。  
- 実行: `uv run python cli/main.py` で CLI を起動。  
- パッケージビルド: `cd cli && uv run python -m build`。成果物は `cli/dist/`。  
- 静的チェック/整形は PEP8 準拠で `uv run ruff check cli` と `uv run ruff format cli` を実行。コミット前に必ず通す。  

## コーディングスタイルと命名規約
- Python は 4 スペースインデント、`snake_case` 関数・変数、モジュール名は小文字。  
- 型ヒントを積極採用し、`Any` は避けて具体的な型を指定する。  
- 原則コメントを書かず、コードから意図が読める構造・命名を優先する。  
- React を書く場合は `useEffect` 多用を避け、シグナル化・カスタムフック分割を先に検討する。  

## 開発フローとブランチ運用
- `main` は常にデプロイ可能な状態を保ち、作業は `feature/<topic>` または `fix/<issue>` で行う。  
- タスク開始時に最新 `main` を取り込み、終盤でリベースして差分を最小化する。  
- 小さな単位で PR を作成し、レビューサイクルを短く保つことで仕様ズレを早期に発見する。  

## テスト方針
- 現状テストは未配置。追加時は `tests/` を作り、ファイル名は `test_*.py`。  
- フレームワークは `pytest` を推奨。実行は `pytest` だけで完結するようフィクスチャ・設定を揃える。  
- 新規機能は少なくとも正常系と主要エッジケースを 1 本ずつ追加し、失敗再現テストを先に書くことを推奨。  

## コミットと Pull Request ガイドライン
- コミットメッセージは短い日本語または絵文字 + 英語要約を推奨（例: `uvプロジェクト作成`, `🚀: first commit`）。50 文字以内を目安。  
- 1 コミット 1 トピックを守り、不要ファイルや生成物を含めない。  
- PR には目的、主要変更点、動作確認コマンドと結果、関連 Issue/タスク番号を列挙。UI 変更やログ出力変更はスクリーンショットや抜粋を添付。  
- レビュー前に `ruff`・`pytest` を通し、差分が最小であることを再確認する。  

## セキュリティと設定
- シークレットや API キーは `.env` などに置き Git にはコミットしない。共有は秘密管理ツール経由で行う。  
- ローカル環境は `.venv` を標準とし、依存追加後は `uv pip freeze > requirements.txt` でメンバー間の再現性を確保する。  
- OS/シェルに依存するコマンドを記述する場合は代替案を併記し、コントリビューターが macOS/Linux 双方で実行できることを確認する。  
- `.env.example` を用意して必須キー名だけ共有し、本番値は各自で安全に注入する。  

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

