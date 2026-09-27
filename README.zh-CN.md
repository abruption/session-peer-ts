# session-peer (TypeScript)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: preview-candidate; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

向正在运行的 **Claude Code 和 Codex 会话**发送消息，支持本机和跨机器 SSH。这是运行于 Node.js 的 TypeScript 客户端，不需要 Python。

**预览发布候选，正式上传需另行批准。**包名为 `session-peer`，CLI 命令为 **`session-peer`**。本项目不提供 Relay 服务器或托管服务。

## 功能与边界

- 发现本机会话以及显式指定的 Codex home。
- 先用 `--dry-run` 验证目标，再向原生 inbox / queue 提交一次消息。Codex 要求唯一且稳定的活跃 writer。
- 通过 SSH 调用远端已安装的同版本客户端，支持结构化 Reply-To URI 和 JSON 输出。
- 目标或进程归属不明确时拒绝操作；不会自动重试结果不确定的提交。

未实现 Relay 传输、MCP、wake/resume、非活跃会话排队、Antigravity、自动更新、隐式多代理发现及面向人的文本输出。不支持的命令会明确失败；这不是通用编排器。

## 环境要求

macOS、Linux 或 Windows native；Node **22.x 中的 22.13 及以上，或 24.x**。不支持 Node 26。原生锁依赖需要匹配的 x64/arm64 预编译二进制，本包不是纯 JavaScript 实现。Codex 发送需要 `codex`，macOS/Linux 还需要 `lsof`、`ps`；Windows 使用原生锁和 Restart Manager 验证所有者。Claude 需要运行中的 TUI 及可访问的原生 inbox。SSH 使用已有密钥和主机信任，远端必须安装**同版本**客户端。

## 安装

在正式 npm 发布确认包归属和来源之前，**不要**运行注册表安装 `npm install -g session-peer` 或 `npx session-peer`。目前请构建经审查的源码，并按需安装本地 tarball：

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# 可选：全局安装前先检查 PATH 选择的现有命令
npm install --global --ignore-scripts ./session-peer-0.1.0-preview.0.tgz
session-peer --version
```

预期输出：`session-peer 0.1.0-preview.0 (typescript)`。保留 `./...tgz` 路径，确保安装的是本地构建产物，而非未验证的注册表包。将来另行批准 npm 发布后，包名和命令名仍如上所示，请按该次发布的版本 / dist-tag 安装。

### 与已有安装共存

安装前后用 `type -a session-peer` 和 `command -v session-peer` 检查实际执行项。其他实现也可能提供同名命令；请选择 PATH 上的一种，或显式运行 `node /absolute/path/dist/cli.js`。不要用 `--force` 覆盖其他管理器的文件。本包不会自动安装、删除或调整 Python 包、技能或服务。卸载使用 `npm uninstall --global session-peer`，随后再次检查 PATH。

在 Windows PowerShell 中用 `Get-Command session-peer -All` 检查已有命令。为了不替换 Python CLI，可先执行 `npm ci --ignore-scripts`、`npm run build`、`npm pack --ignore-scripts`，再用 `npm install --prefix "$env:TEMP\session-peer-ts-preview" --ignore-scripts .\session-peer-0.1.0-preview.0.tgz` 安装到隔离目录。以 `& "$env:TEMP\session-peer-ts-preview\node_modules\.bin\session-peer.cmd" --version` 验证，并可用 `npm uninstall --prefix "$env:TEMP\session-peer-ts-preview" session-peer` 卸载。

## 使用

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'Please review the API contract.' --dry-run --json
```

只有确定要投递时才移除 `--dry-run`。省略 `--message` 或使用 `--message -` 会读取 UTF-8 stdin。`--all` 仅让列表包含陈旧 / 已归档记录，不授予发送权限。Claude 支持 PID、`claude:PID` 或唯一的 ASCII 名称（不区分大小写）；Unicode 名称请改用 PID。Codex 需要完整 UUID 和显式 home；`--codex-bin` 可指定可执行文件。输出必须选择 `--json` 或 `--output-format json`。

### 跨机器 SSH

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

默认远程命令是 PATH 中的 `session-peer`。绝对路径 `--remote-bin` 也可选择使用受支持 Node 的包装器。握手检查 TypeScript 标记及精确版本，不同实现会被拒绝。SSH 使用 BatchMode 和 StrictHostKeyChecking，不自动接受新主机密钥、不安装远程运行时，也不会退回 Python。消息通过 JSON stdin 传输，不放进远程 shell 参数。不支持任意 `--ssh-opt`、IPv6 字面量或 Tailscale 规范名补全，请使用 SSH 别名 / 主机名。正向访问不意味着反向访问已配置。

对于 Windows SSH 目标，请指定 `--remote-platform win32`；若远端 PATH 中没有命令，再使用 `--remote-bin 'C:\absolute\path\session-peer.cmd'`。可用 `--ssh-control-path /local/absolute/socket` 选择已认证的 OpenSSH 控制套接字；这不会跳过主机密钥验证或授予新登录。Windows 本机的 Codex home 使用完整 `C:\Users\...\.codex` 路径。已有 Python CLI 不会被自动删除或替换。

### 回复

可将 `session-peer://v1/reply?...` URI 用作 `--to`。未知 / 重复字段、不安全主机、错误编码及与显式路由的冲突都会被拒绝。`--reply-address URI` 添加显式回信地址，不自动推断或验证回程。回复时不附加新地址可用 `--no-reply-to`。有效的 CODEX_THREAD_ID / CODEX_SESSION_ID 可提供参考性 From 信息，`--no-from` 可省略；不会虚构未知发送者。peer 元数据不是授权，Reply-To URI 也不会作为 shell 文本执行。

## 成功含义与安全性

| 结果 | 含义 |
| --- | --- |
| `validated`, `submitted:false` | dry-run 检查通过，尚未发送。 |
| `posted` / `queued` | inbox 已写入 / queue 已接受，**不是消费确认或 ACK**。 |
| `refused`, `submitted:false` | 提交前被拒绝。 |
| `unknown`, `submitted:null` | 可能已经提交，不要自动重发。 |

`consumptionConfirmed` 始终为 false。必须在目标 TUI 中另行确认实际 ACK，不可由排队或轮询 transcript 推断。退出码 0/1/2 分别表示成功/错误/用法错误。错误只返回固定代码，不返回原生 stderr 或消息内容。Codex 使用真实内核 flock、文件身份和同用户进程开始时间进行多次核验，排队前再次检查。不删除 lock，也不向拥有它的代理进程发送信号。发现结果仍包含本地名称、路径、ID，分享前请脱敏。

## 开发与验证

```sh
npm ci --ignore-scripts
npm run build
node scripts/check-repository.mjs
SESSION_PEER_PYTHON_ROOT=/path/to/python-reference npm test
npm run test:package
npm audit
```

Python 只用作开发时的兼容性基准（v1.0.2，`47c23713d0a2a3c11ebde6186afd8c43489b8b65`），不是运行时依赖。POSIX 契约测试还需要 C 编译器和 lsof。CI 固定基准提交，覆盖 macOS/Linux/Windows × Node 22/24。临时 SQLite、Unix inbox、真实锁 fixture 与 [VALIDATION.md](VALIDATION.md) 中专用真实 TUI 的证据分开记录；fixture 通过不是 ACK。包测试检查文件清单、重复打包哈希、全新安装与卸载。原生依赖通常有安装脚本，已验证的预编译路径使用 `--ignore-scripts`。SQLite 只读连接仍可能参与 WAL 共享内存管理，不能视为快照。

参见 [CONTRIBUTING.md](CONTRIBUTING.md)、[RELEASING.md](RELEASING.md) 和 [SECURITY.md](SECURITY.md)。发布需单独批准，未启用自动 npm 发布。采用 [MIT](LICENSE) 许可证。

## npm 发布后的安装

仅在官方发布以及注册表完整性、provenance 验证完成后，安装以下精确预览版本。它不是稳定版 `latest`。公开前继续使用上述本地 tarball 安装。

```sh
npm install --global --ignore-scripts session-peer@0.1.0-preview.0
session-peer --version
```

手动工作流仅在首次发布时使用短期 bootstrap 令牌。以后通过 Trusted Publisher OIDC 上传至 staging，由维护者使用 2FA 批准。staging 成功不代表已经公开发布。参见 [RELEASING.md](RELEASING.md)。

## 相关项目

[Python session-peer](https://github.com/abruption/session-peer) 独立维护和发布，其可选功能与安装指南（例如 `pipx install session-peer`）见该项目。同样使用 `session-peer` 命令，请注意上述 PATH 规则。本客户端不依赖该安装，也不承诺功能和参数完全对等。
