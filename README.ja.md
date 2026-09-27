# session-peer (TypeScript)

[![npm バージョン](https://img.shields.io/npm/v/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 週間ダウンロード](https://img.shields.io/npm/dw/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 月間ダウンロード](https://img.shields.io/npm/dm/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![CI](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml)
[![Node 対応](https://img.shields.io/node/v/session-peer?logo=node.js)](https://www.npmjs.com/package/session-peer)
[![MIT ライセンス](https://img.shields.io/npm/l/session-peer)](LICENSE)

<sub>新しいパッケージが npm のダウンロード統計に反映されると、ダウンロードバッジが更新されます。</sub>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

実行中の **Claude Code と Codex セッション**に、ローカルまたは SSH 経由でメッセージを送る TypeScript クライアントです。Node.js で動作し、Python は不要です。

**0.1.0 安定版は npm で公開済みです。**パッケージ名は `session-peer`、CLI コマンドは **`session-peer`**。Relay サーバーやホスティングサービスは提供しません。

## 機能と範囲

- ローカルセッションと、明示的に指定した Codex home の検出。
- `--dry-run` で宛先を確認し、ネイティブ inbox / queue にメッセージを一度だけ提出。Codex は一意かつ安定した live writer が必要です。
- インストール済みの同じクライアントへの SSH 接続、構造化 Reply-To URI、JSON 出力。
- 宛先や所有者が曖昧なら拒否。不確実な提出を自動再送しません。

Relay 通信、MCP、wake/resume、非アクティブ queue、Antigravity、自動更新、暗黙の全エージェント検出、人間向けテキスト出力は未実装です。未対応コマンドは明示的に失敗します。汎用オーケストレーターではありません。

## 必要条件

macOS / Linux / Windows native、Node **22.x の 22.13 以上、または 24.x**。Node 26 は対象外です。ネイティブロック依存には対応する x64/arm64 バイナリが必要で、純 JavaScript パッケージではありません。Codex 送信には `codex` が必要で、macOS/Linux では `lsof`・`ps` も必要です。Windows はネイティブロックと Restart Manager で所有者を確認します。Claude にはアクセス可能な inbox を持つ稼働中 TUI が必要です。SSH は既存の鍵・ホスト信頼と、接続先の**同一バージョン**のクライアントを使います。

## インストール

検証済みの安定版は、Node 22.x の 22.13 以上または 24.x でインストールできます。Python CLI も同じコマンド名を使うため、既存のインストールがあれば先に PATH を確認してください。

```sh
npm install --global --ignore-scripts session-peer@0.1.0
session-peer --version
```

期待値は `session-peer 0.1.0 (typescript)`。まず `session-peer list --agent claude --json` で宛先を探し、送信前に `--dry-run` で確認してください。

### ソースからビルド

公開済みの npm パッケージではなくレビュー済みのソースを使うには、ビルドして必要ならローカル tarball をインストールします。

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# 任意のグローバルインストール前に PATH の既存コマンドを確認
npm install --global --ignore-scripts ./session-peer-0.1.0.tgz
session-peer --version
```

`./...tgz` を省略せず、ローカルの成果物を選択してください。後のバージョンのソースを使う場合は、チェックアウトしたバージョンを先に確認してください。

### 既存インストールとの共存

インストール前後に `type -a session-peer` と `command -v session-peer` を確認します。他の実装も同名コマンドを提供するため、PATH 上の一つを選ぶか `node /absolute/path/dist/cli.js` を使ってください。`--force` で他の管理ツールのファイルを上書きしないでください。Python パッケージ・スキル・サービスを自動変更しません。削除は `npm uninstall --global session-peer` を使い、PATH を再確認します。

Windows PowerShell では `Get-Command session-peer -All` で既存コマンドを確認します。Python CLI を置換せずに試すには、`npm ci --ignore-scripts`、`npm run build`、`npm pack --ignore-scripts` の後、`npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.1.0.tgz` を実行し、`& "$env:TEMP\session-peer-ts-source\node_modules\.bin\session-peer.cmd" --version` で確認します。同じ prefix の `npm uninstall --prefix "$env:TEMP\session-peer-ts-source" session-peer` で削除します。

## 使い方

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'Please review the API contract.' --dry-run --json
```

実際に送るときだけ `--dry-run` を外します。`--message` の省略または `--message -` は UTF-8 stdin を読みます。`--all` は古い / アーカイブ済み記録の一覧用で、送信許可にはなりません。Claude の宛先は PID、`claude:PID`、一意な ASCII 名（大文字小文字を区別しない）。Unicode 名には PID を使います。Codex は完全な UUID と明示した home が必要です。実行ファイルは `--codex-bin` で指定できます。出力には `--json` または `--output-format json` が必要です。

### SSH

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

既定のリモートコマンドは PATH の `session-peer`。絶対パスの `--remote-bin` で対応 Node を使うラッパーも指定できます。TypeScript マーカーと正確なバージョンを確認し、異なる実装は拒否します。BatchMode / StrictHostKeyChecking を使い、新しいホスト鍵の自動受理、リモートランタイムのインストール、Python フォールバックはしません。本文はリモートシェル引数ではなく JSON stdin で渡します。任意の `--ssh-opt`、IPv6 リテラル、Tailscale の正規名補完は非対応です。SSH alias / hostname を使ってください。片方向の接続成功は逆方向の接続を保証しません。

Windows の SSH 宛先では `--remote-platform win32` を指定し、必要に応じて `--remote-bin 'C:\absolute\path\session-peer.cmd'` を使います。既に認証済みの OpenSSH 制御ソケットは `--ssh-control-path /local/absolute/socket` で選択できます。ホスト鍵の確認や新しいログイン権限を回避しません。Windows ローカルの Codex home には完全な `C:\Users\...\.codex` パスを使います。既存の Python CLI は自動削除・置換しません。

### 返信

`session-peer://v1/reply?...` URI を `--to` に指定できます。不明 / 重複フィールド、不正ホスト・エンコード、明示した経路との矛盾は拒否します。`--reply-address URI` は明示的な返信先を付けますが、経路を自動推測・検証しません。新しい返信先なしで返すときは `--no-reply-to`。有効な CODEX_THREAD_ID / CODEX_SESSION_ID は参考用 From 情報になり、`--no-from` で省略できます。不明な送信者は捏造しません。peer 情報は権限ではなく、URI をシェルとして実行しません。

## 成功の意味と安全性

| 結果 | 意味 |
| --- | --- |
| `validated`, `submitted:false` | dry-run 成功。未送信。 |
| `posted` / `queued` | inbox 書き込み / queue 受理。**消費や ACK ではありません**。 |
| `refused`, `submitted:false` | 提出前の拒否。 |
| `unknown`, `submitted:null` | 提出済みの可能性あり。自動再送禁止。 |

`consumptionConfirmed` は常に false。実際の ACK は宛先 TUI で別途確認し、queue や transcript polling から推定しません。終了コード 0/1/2 は成功/エラー/用法エラー。エラーは固定コードで、ネイティブ stderr や本文を返しません。Codex は実際の kernel flock、ファイル同一性、同一ユーザーの所有者開始時刻を複数回調べ、提出直前にも再検証します。lock の削除や所有エージェントへのシグナル送信はしません。一覧の名前・パス・ID は共有前に伏せてください。

## 開発と検証

```sh
npm ci --ignore-scripts
npm run build
node scripts/check-repository.mjs
SESSION_PEER_PYTHON_ROOT=/path/to/python-reference npm test
npm run test:package
npm audit
```

Python は開発時の互換検証基準のみです（v1.0.2、`47c23713d0a2a3c11ebde6186afd8c43489b8b65`）。実行時依存ではありません。POSIX 契約テストには C コンパイラーと lsof も必要です。CI は基準コミットを固定し macOS/Linux/Windows × Node 22/24 を確認します。SQLite・Unix inbox・実 lock の fixture と、専用実 TUI の証拠 [VALIDATION.md](VALIDATION.md) は別です。fixture 成功は ACK ではありません。パッケージ内容、反復 pack ハッシュ、新規インストール、アンインストールも検証します。ネイティブ依存の通常の install script は実行せず、検証した prebuilt 経路は `--ignore-scripts` を使います。SQLite 読み取り専用接続も WAL 共有メモリー管理に関与し得るため、スナップショットではありません。

[CONTRIBUTING.md](CONTRIBUTING.md)、[RELEASING.md](RELEASING.md)、[SECURITY.md](SECURITY.md) を参照してください。今後のリリースの公開には別途承認が必要で、自動 npm 公開はありません。[MIT](LICENSE) ライセンスです。

## npm リリース

公開済みの `session-peer@0.1.0` は、レジストリの整合性・provenance メタデータ・署名・新規インストールとアンインストールの検証に合格しました。`latest` は `0.1.0`、`preview` は `0.1.0-preview.1` を指します。バージョンを指定しないインストールの前に現在のタグを確認してください。

```sh
npm view session-peer dist-tags
```

手動ワークフローは Trusted Publisher OIDC で staging し、保守者が 2FA で承認します。staging 成功は公開完了ではありません。[RELEASING.md](RELEASING.md) を参照してください。

## 関連プロジェクト

[Python session-peer](https://github.com/abruption/session-peer) は独立して保守・リリースされ、任意機能や `pipx install session-peer` などの導入方法はそちらで案内します。同じ `session-peer` コマンドなので上記 PATH の注意が必要です。このクライアントはそのインストールに依存せず、全機能・フラグの同等性を約束しません。
