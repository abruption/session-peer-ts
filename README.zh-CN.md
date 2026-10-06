# session-peer (TypeScript)

[![npm 版本](https://img.shields.io/npm/v/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 每周下载](https://img.shields.io/npm/dw/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 每月下载](https://img.shields.io/npm/dm/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![CI](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml)
[![Node 支持](https://img.shields.io/node/v/session-peer?logo=node.js)](https://www.npmjs.com/package/session-peer)
[![MIT 许可证](https://img.shields.io/npm/l/session-peer)](LICENSE)

<sub>npm 下载统计可能晚于软件包发布才更新。</sub>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

**发现正在运行的 Claude Code 和 Codex 会话，并在本机或通过 SSH 发送消息。**
这是不需要 Python 的 Node.js 客户端。包名与命令名均为 `session-peer`。

## Demo

![TypeScript session-peer 0.2.1 的实际 Codex 与 Claude Code 请求和回复](https://raw.githubusercontent.com/abruption/session-peer-ts/main/docs/assets/session-peer-ts-v0.2.1-roundtrip.gif)

使用 npm 0.2.1 确认了本地请求及明确的 `ACK DEMO-READY` 回复。CLI 与消息摘录经过重新渲染、标识信息匿名化及时间编辑，并非屏幕录像。仅提交不代表 ACK。

安装后列出会话，将 `CLAUDE_PID` 替换为选中的准确 PID：

```sh
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message '请检查 API 契约并回复。' --dry-run --json
```

`--dry-run` 仅验证，不提交。实际发送时移除同一命令中的 `--dry-run`，执行一次。
需要确认时，请明确要求回复。**`posted` / `queued` 仅表示提交，不代表消费或 ACK。**
遇到 `unknown` (`submitted:null`)、没有回复或目标退出时，不要自动重试。
`consumptionConfirmed` 始终为 false，请在接收方 TUI 中确认实际回复。

## Quick Start

需要 macOS/Linux/Windows、**Node 22.x 中的 22.13 及以上或 24.x**，以及匹配的
原生预编译依赖(x64/arm64)。Claude 需要运行中的 TUI inbox；Codex 需要 CLI 和
可验证的 writer(macOS/Linux 还需要 `lsof`、`ps`)。SSH 需要已有密钥、主机信任
以及两端**同版本的 TypeScript 客户端**。平台要求与显式非活动队列提交见详细指南。

### Install

[Python CLI](https://github.com/abruption/session-peer)也使用同名命令。
安装前，macOS/Linux 使用 `type -a session-peer`，PowerShell 使用
`Get-Command session-peer -All` 检查 PATH。选择所需实现，不要用 `--force`
覆盖其他安装管理器的文件。

```sh
npm view session-peer@0.3.1 version dist.integrity
npm install --global --ignore-scripts session-peer@0.3.1
session-peer --version
```

预期输出：`session-peer 0.3.1 (typescript)`。隔离安装、源码构建、Windows 和
卸载步骤见下方详细指南。

可选的 `sp` 简写包含在 0.3.0 及更高版本中（0.2.1 及更早版本没有），不会自动启用。
请参阅[显式启用、冲突与停用(英文)](docs/shorthand.md)。

### Update

使用 npm 更新由 npm 管理的安装。先检查标签并审阅目标版本，再安装指定版本。
下面示例将旧 npm 安装更新至 0.3.1。CLI 不会安装更新，`session-peer update --check` 只做检查。

```sh
npm view session-peer dist-tags
npm install --global --ignore-scripts session-peer@0.3.1
session-peer --version
```

配套技能需单独安装和更新；npm 安装不会安装技能。请参阅指南中固定提交的技能安装步骤。

<!-- Preserve links to the former detailed sections; their contents are in the guide. -->
<a id="功能与边界"></a>
<a id="020-统一列表"></a>
<a id="020-cli-易用性"></a>
<a id="环境要求"></a>
<a id="安装"></a>
<a id="从源码构建"></a>
<a id="与已有安装共存"></a>
<a id="使用"></a>
<a id="跨机器-ssh"></a>
<a id="回复"></a>
<a id="成功含义与安全性"></a>
<a id="开发与验证"></a>
<a id="npm-版本"></a>
<a id="相关项目"></a>
<a id="020-只读诊断"></a>
<a id="显式安装代理技能"></a>

## Docs

- [用户指南](docs/guide.zh-CN.md) — CLI 选项、发现、Codex home、SSH、回复、安装方式和技能设置.
- [API 参考(英文)](docs/api.md).
- [兼容性、迁移和功能计划](PARITY.md).
- [发布证据与平台验证](VALIDATION.md).
- [开发与贡献](CONTRIBUTING.md).
- [发布流程](RELEASING.md).

- [0.4.0 handoff 契约候选（未实现、未冻结）](PARITY.md#handoff-v1-design-candidate--69).

## License

采用 [MIT 许可证](LICENSE)。

## Support and security

使用问题和可复现的缺陷请提交到[议题](https://github.com/abruption/session-peer-ts/issues)。
漏洞请使用[私密报告](https://github.com/abruption/session-peer-ts/security/advisories/new)或
[support@abruption.dev](mailto:support@abruption.dev?subject=%5Bsession-peer-ts%5D%20Security)。
请阅读 [SECURITY.md](SECURITY.md)，并移除凭据、消息内容和个人路径。
