# session-peer (TypeScript)

[![npm バージョン](https://img.shields.io/npm/v/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 週間ダウンロード](https://img.shields.io/npm/dw/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 月間ダウンロード](https://img.shields.io/npm/dm/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![CI](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml)
[![Node 対応](https://img.shields.io/node/v/session-peer?logo=node.js)](https://www.npmjs.com/package/session-peer)
[![MIT ライセンス](https://img.shields.io/npm/l/session-peer)](LICENSE)

<sub>npm のダウンロード統計はパッケージ公開より遅れて反映される場合があります。</sub>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

**実行中の Claude Code・Codex セッションを見つけ、ローカルまたは SSH でメッセージを送信します。**
Python 不要の Node.js クライアントです。パッケージ名とコマンド名は `session-peer` です。

## Demo

![TypeScript session-peer 0.2.1 による実際の Codex・Claude Code 間の要求と返信](https://raw.githubusercontent.com/abruption/session-peer-ts/main/docs/assets/session-peer-ts-v0.2.1-roundtrip.gif)

npm 0.2.1 でローカルの要求と明示的な `ACK DEMO-READY` の返信を確認しました。CLI・メッセージの抜粋を識別情報の除去とタイミング編集後に再描画したもので、画面録画ではありません。提出だけでは ACK を意味しません。

インストール後、一覧から選んだ正確な PID に `CLAUDE_PID` を置き換えます:

```sh
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'API の契約を確認して返信してください。' --dry-run --json
```

`--dry-run` は送信せずに検証します。実際に送るときは同じコマンドから
`--dry-run` を外して一度実行してください。確認が必要なら明示的に返信を求めます。
**`posted` / `queued` は提出を示し、消費や ACK の確認ではありません。** `unknown`
(`submitted:null`)、返信がないこと、対象の終了を理由に自動再送しないでください。
`consumptionConfirmed` は常に false です。返信は受信側 TUI で確認します。

## Quick Start

macOS/Linux/Windows、**Node 22.x の 22.13 以降または 24.x**、対応する
ネイティブ事前ビルド依存関係(x64/arm64)が必要です。Claude は実行中 TUI の inbox、
Codex は CLI と検証可能な writer が必要です(macOS/Linux は `lsof`・`ps` も必要)。
SSH は既存の鍵・ホスト信頼設定と両端の**同じバージョンの TypeScript クライアント**を
必要とします。各 OS の条件と非アクティブなキューへの明示的提出はガイドを参照してください。

### Install

[Python CLI](https://github.com/abruption/session-peer)も同じコマンド名を使います。
インストール前に macOS/Linux では `type -a session-peer`、PowerShell では
`Get-Command session-peer -All` で PATH を確認してください。利用する実装を選び、
別の管理ツールのファイルを `--force` で上書きしないでください。

```sh
npm view session-peer@0.3.1 version dist.integrity
npm install --global --ignore-scripts session-peer@0.3.1
session-peer --version
```

期待する出力: `session-peer 0.3.1 (typescript)`。分離インストール・ソースビルド・
Windows・削除の手順は以下の詳細ガイドを参照してください。

任意の `sp` 短縮名は 0.3.0 以降に含まれ（0.2.1 以前にはありません）、自動では有効になりません。
[明示的な有効化・衝突・解除(英語)](docs/shorthand.md)を参照してください。

### Update

npm で導入したクライアントは npm で更新します。タグと対象バージョンを確認してから
正確なバージョンを指定してください。以下は古い npm 版を 0.3.1 に更新する例です。
CLI は更新をインストールせず、`session-peer update --check` は確認のみ行います。

```sh
npm view session-peer dist-tags
npm install --global --ignore-scripts session-peer@0.3.1
session-peer --version
```

連携スキルの導入・更新は別に行います。npm インストールはスキルを導入しません。
ガイドの固定コミットに基づくスキル導入手順を確認してください。

<!-- Preserve links to the former detailed sections; their contents are in the guide. -->
<a id="機能と範囲"></a>
<a id="020-の統合一覧"></a>
<a id="020-cli-の使いやすさ"></a>
<a id="必要条件"></a>
<a id="インストール"></a>
<a id="ソースからビルド"></a>
<a id="既存インストールとの共存"></a>
<a id="使い方"></a>
<a id="ssh"></a>
<a id="返信"></a>
<a id="成功の意味と安全性"></a>
<a id="開発と検証"></a>
<a id="npm-リリース"></a>
<a id="関連プロジェクト"></a>
<a id="020-の読み取り専用診断"></a>
<a id="エージェントスキルの明示的な導入"></a>

## Docs

- [ユーザーガイド](docs/guide.ja.md) — CLI オプション、探索、Codex home、SSH、返信、導入方法とスキル設定.
- [API リファレンス(英語)](docs/api.md).
- [互換性・移行・機能計画](PARITY.md).
- [リリース証拠・プラットフォーム検証](VALIDATION.md).
- [開発・貢献](CONTRIBUTING.md).
- [リリース手順](RELEASING.md).

## License

[MIT ライセンス](LICENSE)で公開しています。

## Support and security

利用上の質問と再現可能な不具合は[イシュー](https://github.com/abruption/session-peer-ts/issues)へ。
脆弱性は[非公開報告](https://github.com/abruption/session-peer-ts/security/advisories/new)または
[support@abruption.dev](mailto:support@abruption.dev?subject=%5Bsession-peer-ts%5D%20Security)へ送ってください。
[SECURITY.md](SECURITY.md)を確認し、認証情報・メッセージ・個人のパスを除去してください。
