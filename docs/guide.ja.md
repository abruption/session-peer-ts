# ユーザーガイド — session-peer (TypeScript)

[README に戻る](../README.ja.md)

[English](guide.md) | [한국어](guide.ko.md) | [日本語](guide.ja.md) | [简体中文](guide.zh-CN.md)

0.2.1 の詳細ガイドです。0.2.1 は 0.2.0 の信頼性・堅牢性向上アップデートです（[変更点](../PARITY.md#021-reliability-and-hardening)）。前回の公開記録は [0.2.0 公開リリースの証拠](../VALIDATION.md#public-020--2026-09-28-kst) にあります。以下の 0.1.0 の説明は旧版との比較です。

## 目次

- [機能と範囲](#機能と範囲)
- [必要条件](#必要条件)
- [インストール](#インストール)
- [使い方](#使い方)
- [成功の意味と安全性](#成功の意味と安全性)
- [開発と検証](#開発と検証)
- [npm リリース](#npm-リリース)
- [関連プロジェクト](#関連プロジェクト)
- [エージェントスキルの明示的な導入](#エージェントスキルの明示的な導入)


実行中の **Claude Code と Codex セッション**に、ローカルまたは SSH 経由でメッセージを送る TypeScript クライアントです。Node.js で動作し、Python は不要です。

**0.2.1 の利用ガイドです。**パッケージ名は `session-peer`、CLI コマンドは **`session-peer`**。Relay サーバーやホスティングサービスは提供しません。

## 機能と範囲

- ローカル Claude/Codex セッションと既知の Codex home の検出（0.2.0 の機能、下記参照）。
- `--dry-run` で宛先を確認し、ネイティブ inbox / queue にメッセージを一度だけ提出。Codex は一意かつ安定した live writer が必要です。
- インストール済みの同じクライアントへの SSH 接続、構造化 Reply-To URI、JSON 出力。
- 宛先や所有者が曖昧なら拒否。不確実な提出を自動再送しません。

Relay 通信、MCP、wake/resume、Antigravity、自動更新は未実装です。未対応コマンドは明示的に失敗します。汎用オーケストレーターではありません。

クライアント機能の計画は [バージョン別互換性表と npm 移行ガイド](../PARITY.md) で追跡します。計画は現在の対応を意味しません。Relay サーバーやホスティングサービスの提供は本クライアントの範囲外です。

### 0.2.0 の統合一覧

ビルド後の `node dist/cli.js list --json` は Claude/Codex をまとめて表示し、`list --agent codex --json` は既知の home を検索します。公開 npm **0.1.0** では引き続き agent と Codex 一覧の home を明示します。0.2.0 でも明示的なコマンド形式を利用できます。

対象は既定の `~/.codex`、`CODEX_HOME`、macOS Orca 直下のアカウント home、JSON 配列 `SESSION_PEER_CODEX_HOMES` のみです。`--codex-home` は Codex 一覧を固定して無関係な設定エラーを回避し、`--agent claude` は Codex 探索を省略します。同じ home の別名は統合し、異なる home の同じ UUID は保持します。送信には各行の `codexHome` を使ってください。任意 home の不在はエラーではなく、明示した home の不在・不正は読み取れた行を保持して終了コード 1 を返します。一覧は writer を選択せず、メッセージを提出しません。[一覧契約](../PARITY.md#source-unified-listing-contract--16--020)に順序・診断・`--all`・SSH を記載しています。0.2.0の Codex 送信は `--codex-home` 省略時に一意で安定した live writer を選択します。明示 home でも既知の競合 home をすべて検査します。非アクティブなキュー送信には保存済みスレッド、全候補の非アクティブ検証、および `--codex-home HOME --allow-inactive-codex-home` が必要で、wake/resume は実行しません。Dry-run は提出しません。JSON に診断 `codexHomeResolution` と、ネイティブ出力にある場合のみ `queueId` を追加しますが、消費確認ではありません。[選択契約](../PARITY.md#source-codex-home-selection--17--020)を参照してください。公開 **0.1.0** には明示 live home が必要で、非アクティブ許可オプションはありません。SSH 両端で同一の0.2.1 ビルドを使ってください。

### 0.2.0 CLI の使いやすさ

0.2.0は `list --help`、`send --help`、`doctor --help`、`--output-format text` を提供します。
出力指定は引き続き必須です: `--json` または `--output-format json|text`。
構文エラーは JSON、有効な text 要求の実行結果・エラーはテキストです。SSH
内部通信は常に JSON です。`send --to TARGET "message" --json` の位置本文に
対応し、`--message`/`-m` との併用は拒否します。本文省略または `-` は stdin、
オプション形式の位置本文には `--` を前置します。空・空白本文は送信者情報の
追加前に拒否します。Claude 名は Unicode 14.0.0 のデフォルト full casefold
による完全一致です。正規化・曖昧検索はせず、衝突時は PID が必要です。
公開済み 0.1.0 にこのソース機能が遡及適用されることはありません。


## 必要条件

macOS / Linux / Windows native、Node **22.x の 22.13 以上、または 24.x**。Node 26 は対象外です。ネイティブロック依存には対応する x64/arm64 バイナリが必要で、純 JavaScript パッケージではありません。Codex 送信には `codex` が必要で、macOS/Linux では `lsof`・`ps` も必要です。Windows はネイティブロックと Restart Manager で所有者を確認します。Claude にはアクセス可能な inbox を持つ稼働中 TUI が必要です。SSH は既存の鍵・ホスト信頼と、接続先の**同一バージョン**のクライアントを使います。

## インストール

検証済みの安定版は、Node 22.x の 22.13 以上または 24.x でインストールできます。Python CLI も同じコマンド名を使うため、既存のインストールがあれば先に PATH を確認してください。

```sh
npm install --global --ignore-scripts session-peer@0.2.1
session-peer --version
```

期待値は `session-peer 0.2.1 (typescript)`。

1. `session-peer list --agent claude --json` で宛先を探し、正確な PID を選びます。
2. `session-peer send --to CLAUDE_PID --message 'Please reply after checking.' --dry-run --json` で提出せずに確認します。
3. 送る場合は選んだ PID を使い、同じコマンドから `--dry-run` を外して一度だけ実行します。
4. ACK が必要なら本文で明示的な返信を依頼し、宛先 TUI の応答を別途確認します。`posted` / `queued` は提出のみを示します。

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
npm install --global --ignore-scripts ./session-peer-0.2.1.tgz
session-peer --version
```

`./...tgz` を省略せず、ローカルの成果物を選択してください。後のバージョンのソースを使う場合は、チェックアウトしたバージョンを先に確認してください。

### 既存インストールとの共存

インストール前後に `type -a session-peer` と `command -v session-peer` を確認します。他の実装も同名コマンドを提供するため、PATH 上の一つを選ぶか `node /absolute/path/dist/cli.js` を使ってください。`--force` で他の管理ツールのファイルを上書きしないでください。Python パッケージ・スキル・サービスを自動変更しません。削除は `npm uninstall --global session-peer` を使い、PATH を再確認します。

Windows PowerShell では `Get-Command session-peer -All` で既存コマンドを確認します。Python CLI を置換せずに試すには、`npm ci --ignore-scripts`、`npm run build`、`npm pack --ignore-scripts` の後、`npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.2.1.tgz` を実行し、`& "$env:TEMP\session-peer-ts-source\node_modules\.bin\session-peer.cmd" --version` で確認します。同じ prefix の `npm uninstall --prefix "$env:TEMP\session-peer-ts-source" session-peer` で削除します。

## 使い方

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'Please review the API contract.' --dry-run --json
```

実際に送るときだけ `--dry-run` を外します。`--message` の省略または `--message -` は UTF-8 stdin を読みます。`--all` は古い / アーカイブ済み記録の一覧用で、送信許可にはなりません。Claude の宛先は PID、`claude:PID`、一意な Unicode 14.0.0 casefold 名です。衝突時は PID を使います。Codex 送信には完全な UUID が必要で、home は上記の選択規則に従います。実行ファイルは `--codex-bin` で指定できます。出力には `--json` または `--output-format json|text` が必要です。

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

提出後に返信がない、または宛先が終了したという事実だけでは、消費や失敗を確定できません。自動再送しないでください。

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

Python は開発時の互換検証基準のみです（v1.0.2、`47c23713d0a2a3c11ebde6186afd8c43489b8b65`）。実行時依存ではありません。POSIX 契約テストには C コンパイラーと lsof も必要です。CI は三つの OS で Node 22/24 を使います。macOS/Linux は固定した基準に対する全契約・パッケージ検査、Windows x64 はビルド・型検査、ネイティブ Claude inbox、保持/未保持ロック、writer 所有権と提出直前の競合、CLI queue 結果、隔離した模擬 SSH 宛先での実 PowerShell/.cmd フレーミング、パッケージのインストール・ネイティブ読込・削除と audit を実行します。これらは fixture 検査で、Windows では POSIX/Python 参照スイートを実行しません。Windows x64/Node 24 の実機 ACK は別の一回限りの証拠です。SQLite・Unix inbox・実 lock の fixture と、専用実 TUI の証拠 [VALIDATION.md](../VALIDATION.md) は別です。fixture 成功は ACK ではありません。パッケージ内容、反復 pack ハッシュ、新規インストール、アンインストールも検証します。ネイティブ依存の通常の install script は実行せず、検証した prebuilt 経路は `--ignore-scripts` を使います。SQLite 読み取り専用接続も WAL 共有メモリー管理に関与し得るため、スナップショットではありません。

[CONTRIBUTING.md](../CONTRIBUTING.md)、[RELEASING.md](../RELEASING.md)、[SECURITY.md](../SECURITY.md) を参照してください。今後のリリースの公開には別途承認が必要で、自動 npm 公開はありません。[MIT](../LICENSE) ライセンスです。

## npm リリース

0.2.0 は 2026-09-28 KST に公開・検証されました。[公開記録](../VALIDATION.md#public-020--2026-09-28-kst)を
参照し、導入前に正確なバージョンと現在のタグを確認してください。

```sh
npm view session-peer@0.2.0 version dist.integrity
npm view session-peer dist-tags
```

0.1.0 tarball の古い記述と検証結果は[日付付き記録](../VALIDATION.md#public-010--2026-09-27-kst)に保存しています。
OIDC staging と別途の 2FA 承認を使用します。Staging 成功は公開完了ではありません。
[RELEASING.md](../RELEASING.md) を参照してください。

## 関連プロジェクト

[Python session-peer](https://github.com/abruption/session-peer) は独立して保守・リリースされ、任意機能や `pipx install session-peer` などの導入方法はそちらで案内します。同じ `session-peer` コマンドなので上記 PATH の注意が必要です。このクライアントはそのインストールに依存せず、全機能・フラグの同等性を約束しません。

### 0.2.0 の読み取り専用診断

```sh
session-peer doctor --json
session-peer doctor --agent codex --codex-home /absolute/home --json
session-peer doctor --host user@host --json
```

公開 npm 0.1.0 には含まれません。診断の成功（`ok:true`、終了コード 0）と
エージェントの準備状態（`ready`、エージェント・home ごとの結果）は別です。
限定されたメタデータと実行ファイルのパスのみを確認し、Codex の実行、inbox 接続、
writer ロック取得、メッセージ送信はしません。Windows では生存プロセスによる
pipe の広告を確認するだけで、pipe の存在や接続可能性は保証しません。
`capabilities` は wake/wait/ACK と消費確認を未対応と明示します。任意の TS スキル
メタデータ検査もインストールを行いません。[診断の境界](../PARITY.md#source-read-only-doctor--18--020)
を参照してください。SSH の両端には同じソースビルドが必要です。
### 更新確認と通知（ソース、#22）

```sh
session-peer update --check --json
session-peer update --check --channel preview --output-format text
```

公開 npm 0.2.1 には含まれません。`update --check` は `session-peer` の npm dist-tag を
1 回だけ取得し（3 秒のタイムアウト、再試行なし）、`current`、`latest`、`channel`（既定は
`latest`、または `preview`）、`source: "npm_registry"`、`status`（`update_available`、
`up_to_date`、`ahead`）、`managedBy`、`updateCommand`、`guidance` を返します。コマンドは、
実行中の CLI のパスからインストールの管理者を確実に特定できた場合にだけ示します。
対象は、自身の `session-peer` ランチャーがこのパッケージを指す npm グローバル prefix
（既定、Homebrew、nvm、nvm-windows、fnm。例：
`npm install --global --ignore-scripts session-peer@0.2.2`）、マニフェストで
`session-peer` を宣言している pnpm・Yarn・Bun のグローバルストア、Volta、npx キャッシュ
です。プロジェクトへのインストール（`npm_project`、`pnpm_project`）、ソースチェック
アウト（`source`）、それ以外（`unknown`）では `updateCommand: null` と `guidance` の文だけを
返すため、無関係なカレントディレクトリを変更するコマンドは出しません。npm のバージョン
だけを扱い、Python 版 `session-peer` のリリースは別の系列なので比較しません。レジストリの
失敗は終了コード 1 と `registry_timeout`、`registry_unreachable`、`registry_http_error`、
`registry_response_invalid`、`dist_tag_missing` のいずれかで報告し、応答本文は出力しません。

`--check` なしの `update` は何も変更しません。`self_update_unsupported`（終了コード 2）で
拒否し、`managedBy`、`updateCommand`、`guidance`、`checkCommand` を返します。`update`
自体はローカル専用で、`--host` も SSH wire 経由の要求も拒否します。リモートホスト、
Python のインストール、別管理の `session-peer-ts` スキルは更新しません。結果にはローカルの
TS スキルメタデータ（`skills`、`doctor` と同じ契約）と `skillsManagedBy: "separate"` が
含まれます。

`list`、`send`、`doctor` のキャッシュ通知は**既定で無効**です。この CLI は主に
エージェントやスクリプトから実行され、要求されていないネットワーク通信をすべきでない
ためです。`SESSION_PEER_UPDATE_NOTICE=1` で有効にすると、24 時間以内のキャッシュが
より新しい npm の安定版を示す場合に、JSON 結果へ `clientUpdate` オブジェクトを追加し、
テキスト出力では stderr に 1 行を出します。キャッシュがない・不正・期限切れの場合は
切り離した更新プロセスを 1 つ起動し、コマンドの結果や終了コードを遅らせたり変えたり
しません。更新に失敗した場合は 1 時間後まで再試行しません。キャッシュの書き込みは単一実行で、
失敗時は閉じる側に倒れます。バックグラウンド更新でも明示的な確認でも、書き込みは
`npm-update.lock` を保持している間だけ、より古い記録に対してだけ行います。自分が作成して
いないロックを引き継いだり削除したりすることはありません。更新が異常終了したり、I/O エラーでロックを解放できなかったりしてロックが残った
場合、バックグラウンド更新は止まり、`update --check` は `cache: "skipped_stale_lock"` を
報告します。session-peer のプロセスが動いていないときに `npm-update.lock` を手動で削除して
ください。

`--no-update-notice` と `SESSION_PEER_NO_UPDATE_NOTICE=1` は、これらのバックグラウンド
通知と更新を抑止します。明示的な `update --check` は意図された要求なので、常に
レジストリに問い合わせ、`latest` チャネルではロックが空いていればキャッシュを書き込みます
（`cache` は `written`、`skipped_locked`、`skipped_stale_lock`、`skipped_newer`、`failed`
のいずれか）。通知はローカルの
クライアントに属します。`--host` を使うと、クライアントは SSH で得た結果を含む自身の
最上位出力に `clientUpdate`（または stderr の 1 行）を追加します。`--stdio-request`
モードの受信側はキャッシュを読まず、更新せず、通知も生成しません。

キャッシュは `SESSION_PEER_CACHE_DIR`（絶対パス）の `npm-update.json` で、未設定なら
`$XDG_CACHE_HOME/session-peer`、`~/Library/Caches/session-peer`（macOS）、
`~/.cache/session-peer`（Linux）、`%LOCALAPPDATA%\session-peer\Cache`（Windows）です。
0700 のディレクトリに 0600 で原子的に書き込み、公開されたバージョン情報だけを保存します。
`SESSION_PEER_UPDATE_REGISTRY` でミラーを指定できます（HTTPS、または loopback のみ HTTP。
認証情報は不可）。npm の設定や `.npmrc` は読みません。
[更新の境界](../PARITY.md#source-update-checks--22)を参照してください。

## エージェントスキルの明示的な導入

別の `session-peer-ts` スキルを関連 PR で管理します。新しい npm 公開やスキルタグではありません。公開済み 0.1.0 の基本機能に対応し、TypeScript 表示とヘルプで開発機能を確認します。Python の `session-peer` スキルは別に維持します。

[固定したスキルのソース](https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts)を確認してから、エージェントと導入範囲を選択してください。
以下の例は **Codex、現在のプロジェクト** を指定します。そのプロジェクトのディレクトリで実行してください。
Claude Code では `--agent claude-code` を使用します。ユーザー単位の場合は add/list/remove の
すべてに `--global` を付けてください。既存の `session-peer-ts` を置き換える前にローカルの変更を確認してください。
Codex の `.agents/skills` は、このパスを探索する他のクライアントと共有されます。

```sh
npx -y skills@1.7.0 add https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts --skill session-peer-ts --agent codex --copy --yes
npx -y skills@1.7.0 list --agent codex --json
npx -y skills@1.7.0 remove session-peer-ts --agent codex --yes
```

固定バージョンを更新するには、別の正確なコミットを確認し、同じエージェントと範囲で `add` を再実行します。
一覧がキャッシュされている場合はエージェントを再起動してください。ランタイムとスキルは独立して管理されます。
npm `--ignore-scripts` は利用でき、postinstall は Skills CLI を呼び出しません。
このスキルの導入は Python スキルを上書きせず、ランタイムもインストールしません。
[互換性と検証](../PARITY.md#source-ts-skill-guidance--25--020)を参照してください。
