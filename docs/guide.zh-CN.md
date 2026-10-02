# 用户指南 — session-peer (TypeScript)

[返回 README](../README.zh-CN.md)

[English](guide.md) | [한국어](guide.ko.md) | [日本語](guide.ja.md) | [简体中文](guide.zh-CN.md)

这是 0.2.1 详细指南。0.2.1 是 0.2.0 的可靠性与加固更新（[变更](../PARITY.md#021-reliability-and-hardening)）。上一次发布记录见 [0.2.0 公开发布证据](../VALIDATION.md#public-020--2026-09-28-kst)；下文 0.1.0 的说明用于旧版本对比。

## 目录

- [功能与边界](#功能与边界)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [成功含义与安全性](#成功含义与安全性)
- [开发与验证](#开发与验证)
- [npm 版本](#npm-版本)
- [相关项目](#相关项目)
- [显式安装代理技能](#显式安装代理技能)


向正在运行的 **Claude Code 和 Codex 会话**发送消息，支持本机和跨机器 SSH。这是运行于 Node.js 的 TypeScript 客户端，不需要 Python。

**这是 0.2.1 使用指南。**包名为 `session-peer`，CLI 命令为 **`session-peer`**。本项目不提供 Relay 服务器或托管服务。

## 功能与边界

- 发现本机 Claude/Codex 会话与已知 Codex home（面向 0.2.0 的功能，见下文）。
- 先用 `--dry-run` 验证目标，再向原生 inbox / queue 提交一次消息。Codex 要求唯一且稳定的活跃 writer。
- 通过 SSH 调用远端已安装的同版本客户端，支持结构化 Reply-To URI 和 JSON 输出。
- 目标或进程归属不明确时拒绝操作；不会自动重试结果不确定的提交。

未实现 Relay 传输、MCP、wake/resume、Antigravity、自动更新。不支持的命令会明确失败；这不是通用编排器。

客户端功能计划见 [版本化兼容性表与 npm 迁移指南](../PARITY.md)；计划不代表当前支持。提供 Relay 服务器或托管服务不属于本客户端范围。

### 0.2.0 统一列表

构建后，`node dist/cli.js list --json` 合并列出 Claude/Codex，`list --agent codex --json` 查找已知 home。公开 npm **0.1.0** 仍要求显式 agent，以及 Codex 列表所需的 home；0.2.0 也支持显式命令格式。

范围仅限默认 `~/.codex`、`CODEX_HOME`、macOS Orca 下的直接账户 home，以及 JSON 数组 `SESSION_PEER_CODEX_HOMES`。`--codex-home` 固定 Codex 列表并绕过无关配置错误；`--agent claude` 完全跳过 Codex 探索。同一 home 的别名合并，不同 home 的相同 UUID 保留。发送时使用每行的 `codexHome`。可选 home 缺失不是错误；显式 home 缺失或无效会保留成功读取的行，并返回退出码 1。列表不会选择 writer 或提交消息。[列表契约](../PARITY.md#source-unified-listing-contract--16--020)说明排序、诊断、`--all` 和 SSH 行为。0.2.0的 Codex 发送在省略 `--codex-home` 时选择唯一且稳定的 live writer；显式 home 仍会检查所有已知竞争 home。非活动队列提交需要已保存的线程、所有候选均确认非活动，以及 `--codex-home HOME --allow-inactive-codex-home`，不会执行 wake/resume。Dry-run 不提交。JSON 新增诊断 `codexHomeResolution`，且仅在原生输出提供时包含 `queueId`；两者均不代表消费确认。请参阅[选择契约](../PARITY.md#source-codex-home-selection--17--020)。公开 **0.1.0** 仍需要显式 live home，且没有非活动许可选项。SSH 两端请使用同一0.2.1 构建。

### 0.2.0 CLI 易用性

0.2.0新增 `list --help`、`send --help`、`doctor --help` 和 `--output-format text`。
仍须明确选择输出格式：`--json` 或 `--output-format json|text`。解析错误
使用 JSON；有效 text 请求的操作结果和错误使用文本。SSH 内部始终传输 JSON。
支持 `send --to TARGET "message" --json` 位置正文，不可同时使用
`--message`/`-m`。省略正文或使用 `-` 从 stdin 读取；选项形式的位置正文
前须加 `--`。空或纯空白正文在添加发件人信息前被拒绝。Claude 名称使用
Unicode 14.0.0 默认 full casefold 精确匹配，不进行规范化或模糊匹配；
冲突时须指定 PID。这些源码功能不会追溯到已经发布的 0.1.0 包。


## 环境要求

macOS、Linux 或 Windows native；Node **22.x 中的 22.13 及以上，或 24.x**。不支持 Node 26。原生锁依赖需要匹配的 x64/arm64 预编译二进制，本包不是纯 JavaScript 实现。Codex 发送需要 `codex`，macOS/Linux 还需要 `lsof`、`ps`；Windows 使用原生锁和 Restart Manager 验证所有者。Claude 需要运行中的 TUI 及可访问的原生 inbox。SSH 使用已有密钥和主机信任，远端必须安装**同版本**客户端。

## 安装

已验证的稳定版可在 Node 22.x 的 22.13 及以上或 24.x 上安装。Python CLI 也使用同一个命令名；若已有安装，请先检查 PATH。

```sh
npm install --global --ignore-scripts session-peer@0.2.1
session-peer --version
```

预期输出：`session-peer 0.2.1 (typescript)`。

1. 用 `session-peer list --agent claude --json` 查找目标并选择准确 PID。
2. 用 `session-peer send --to CLAUDE_PID --message 'Please reply after checking.' --dry-run --json` 验证，不提交。
3. 确定发送时使用选定 PID，移除同一命令中的 `--dry-run`，只执行一次。
4. 若需要 ACK，在消息中明确请求回复，并单独确认目标 TUI 的响应。`posted` / `queued` 仅表示提交。

### 从源码构建

若要使用经审查的源码而非公开的 npm 包，请构建源码，并按需安装本地 tarball：

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# 可选：全局安装前先检查 PATH 选择的现有命令
npm install --global --ignore-scripts ./session-peer-0.2.1.tgz
session-peer --version
```

保留 `./...tgz` 路径以选择本地产物。使用后续版本的源码时，请先确认检出的版本。

### 与已有安装共存

安装前后用 `type -a session-peer` 和 `command -v session-peer` 检查实际执行项。其他实现也可能提供同名命令；请选择 PATH 上的一种，或显式运行 `node /absolute/path/dist/cli.js`。不要用 `--force` 覆盖其他管理器的文件。本包不会自动安装、删除或调整 Python 包、技能或服务。卸载使用 `npm uninstall --global session-peer`，随后再次检查 PATH。

在 Windows PowerShell 中用 `Get-Command session-peer -All` 检查已有命令。为了不替换 Python CLI，可先执行 `npm ci --ignore-scripts`、`npm run build`、`npm pack --ignore-scripts`，再用 `npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.2.1.tgz` 安装到隔离目录。以 `& "$env:TEMP\session-peer-ts-source\node_modules\.bin\session-peer.cmd" --version` 验证，并可用 `npm uninstall --prefix "$env:TEMP\session-peer-ts-source" session-peer` 卸载。

## 使用

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'Please review the API contract.' --dry-run --json
```

只有确定要投递时才移除 `--dry-run`。省略 `--message` 或使用 `--message -` 会读取 UTF-8 stdin。`--all` 仅让列表包含陈旧 / 已归档记录，不授予发送权限。Claude 支持 PID、`claude:PID` 或唯一的 Unicode 14.0.0 casefold 名称；冲突时使用 PID。Codex 发送需要完整 UUID，home 遵循上述选择规则；`--codex-bin` 可指定可执行文件。输出必须选择 `--json` 或 `--output-format json|text`。

### 跨机器 SSH

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

默认远程命令是 PATH 中的 `session-peer`。绝对路径 `--remote-bin` 也可选择使用受支持 Node 的包装器。握手检查 TypeScript 标记及精确版本，不同实现会被拒绝。SSH 使用 BatchMode 和 StrictHostKeyChecking，不自动接受新主机密钥、不安装远程运行时，也不会退回 Python。消息通过 JSON stdin 传输，不放进远程 shell 参数。不支持 Tailscale 规范名补全。正向访问不意味着反向访问已配置。

对于 Windows SSH 目标，请指定 `--remote-platform win32`；若远端 PATH 中没有命令，再使用 `--remote-bin 'C:\absolute\path\session-peer.cmd'`。仅有一个 `--host` 时，可用 `--ssh-control-path /local/absolute/socket` 选择已认证的 OpenSSH 控制套接字；这不会跳过主机密钥验证或授予新登录。Windows 本机的 Codex home 使用完整 `C:\Users\...\.codex` 路径。已有 Python CLI 不会被自动删除或替换。

### 多主机与连接选项

0.2.1 之后的源码（未发布）接受重复的 `--host` 和受限的 `--ssh-opt`：

```sh
session-peer list --host alpha --host user@[2001:db8::1] \
  --ssh-opt=-p --ssh-opt=2222 --ssh-opt=-i --ssh-opt="$HOME/.ssh/id_ed25519" --json
```

- 只有一个 `--host` 时与以前一样返回单个对象。重复 `--host` 时按相同顺序返回 JSON 数组，每个元素都有 `schemaVersion`、`ok`、`host` 和 `command`。任一主机失败时退出码为 1。文本输出为每个目标打印一个 `Host: <host>` 块。
- 在启动任何 `ssh` 进程之前校验所有主机和选项。只要有一个值无效，就拒绝整个命令并返回 `submitted:false`。`--` 之前的 `--host VALUE` 和 `--host=VALUE` 会先被收集，因此当它们有两个或更多时，任何拒绝（包括未知选项或缺少值）都会输出为每个主机一个元素的数组；少于两个时输出单个对象。
- 重复指定同一目标会返回 `duplicate_ssh_host`。该检查只比较目标文本（用户、不区分大小写的主机名、规范化的 IPv6），无法识别指向同一台机器的不同别名或地址。
- 类型化的跳板机路由仍未完成（#20）。`-J`/`ProxyJump` 出于安全考虑被拒绝，详见下文。
- 每个目标按顺序只进行一次预检和最多一次请求。被拒绝或 `unknown` 的主机不会阻止下一个主机，也不会重试或改发到其他目标。请逐个检查元素后再采取行动。
- `--ssh-opt` 只接受 `-p PORT`、`-l USER`、`-i IDENTITY_FILE`、`-o Port=…`、`-o User=…`、`-o IdentityFile=…`、`-o IdentitiesOnly=yes|no`、`-4` 和 `-6`。其他选项一律拒绝（`unsupported_ssh_option`），包括 `ProxyCommand`、`LocalCommand`、`-F`、`Include`、`-J`/`ProxyJump` 以及对 `BatchMode`/`StrictHostKeyChecking` 的修改。跳板机请在 `~/.ssh/config` 中配置，并为该主机设置 `BatchMode yes` 和 `StrictHostKeyChecking yes`；命令行设置不会传递到跳板连接。
- IPv6 字面量可以不带方括号（`2001:db8::1`），也可以带方括号（`[2001:db8::1]`、`user@[2001:db8::1]`）；区域 ID（`%`）会被拒绝。
- 结果新增 `sshUser` 和 `sshUserSource`：`USER@HOST` 或 `-l USER` 为 `explicit`；通过 `ssh -G` 得到的为 `ssh_config_or_local_default`；无法确定时为 `sshUser:null` 和 `unknown`。同时使用 `-l` 和 `USER@HOST` 会被拒绝。没有显式用户时，会为每个主机在本地运行一次 `ssh -G`（最长 5 秒）。它不建立连接，但如 ssh(1) 和 ssh_config(5) 所述，会像普通 `ssh` 一样解析 SSH 配置，包括执行 `Match exec` 命令。
- 存在两条信任边界。允许列表只约束本 CLI 在命令行上传递的选项。你自己的 `~/.ssh/config`（以及系统配置）属于受信任的用户配置，其中的 `ProxyCommand`、`ProxyJump`、`Match exec` 等设置，会像你自己运行 `ssh` 时一样，作用于本 CLI 启动的每个 `ssh`。

### 回复

可将 `session-peer://v1/reply?...` URI 用作 `--to`。未知 / 重复字段、不安全主机、错误编码及与显式路由的冲突都会被拒绝。`--reply-address URI` 添加显式回信地址，不自动推断或验证回程。回复时不附加新地址可用 `--no-reply-to`。有效的 CODEX_THREAD_ID / CODEX_SESSION_ID 可提供参考性 From 信息，`--no-from` 可省略；不会虚构未知发送者。peer 元数据不是授权，Reply-To URI 也不会作为 shell 文本执行。

## 成功含义与安全性

| 结果 | 含义 |
| --- | --- |
| `validated`, `submitted:false` | dry-run 检查通过，尚未发送。 |
| `posted` / `queued` | inbox 已写入 / queue 已接受，**不是消费确认或 ACK**。 |
| `refused`, `submitted:false` | 提交前被拒绝。 |
| `unknown`, `submitted:null` | 可能已经提交，不要自动重发。 |

提交后没有回复或目标退出，都不能单独证明消息已消费或失败。不要自动重发。

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

Python 只用作开发时的兼容性基准（v1.0.2，`47c23713d0a2a3c11ebde6186afd8c43489b8b65`），不是运行时依赖。POSIX 契约测试还需要 C 编译器和 lsof。CI 在三种 OS 上使用 Node 22/24。macOS/Linux 对固定基准执行完整契约与包检查；Windows x64 执行构建、类型检查、原生 Claude inbox、持有/空闲锁、writer 归属与提交前竞争、CLI 队列结果、隔离模拟 SSH 目标的实际 PowerShell/.cmd 帧处理、包安装/原生加载/卸载及 audit。这些属于 fixture 检查；Windows 不运行 POSIX/Python 参考测试套件。Windows x64/Node 24 实机 ACK 是单独的一次性证据。临时 SQLite、Unix inbox、真实锁 fixture 与 [VALIDATION.md](../VALIDATION.md) 中专用真实 TUI 的证据分开记录；fixture 通过不是 ACK。包测试检查文件清单、重复打包哈希、全新安装与卸载。原生依赖通常有安装脚本，已验证的预编译路径使用 `--ignore-scripts`。SQLite 只读连接仍可能参与 WAL 共享内存管理，不能视为快照。

参见 [CONTRIBUTING.md](../CONTRIBUTING.md)、[RELEASING.md](../RELEASING.md) 和 [SECURITY.md](../SECURITY.md)。后续版本的发布需单独批准，未启用自动 npm 发布。采用 [MIT](../LICENSE) 许可证。

## npm 版本

0.2.0 已于 2026-09-28 KST 公开并验证。请参阅[公开记录](../VALIDATION.md#public-020--2026-09-28-kst)，
安装前核对准确版本与当前标签。

```sh
npm view session-peer@0.2.0 version dist.integrity
npm view session-peer dist-tags
```

0.1.0 tarball 的历史措辞差异和验证保留在[日期记录](../VALIDATION.md#public-010--2026-09-27-kst)。
发布使用 OIDC staging 和单独的 2FA 批准。Staging 成功不等于公开发布。
请参阅 [RELEASING.md](../RELEASING.md)。

## 相关项目

[Python session-peer](https://github.com/abruption/session-peer) 独立维护和发布，其可选功能与安装指南（例如 `pipx install session-peer`）见该项目。同样使用 `session-peer` 命令，请注意上述 PATH 规则。本客户端不依赖该安装，也不承诺功能和参数完全对等。

### 0.2.0 只读诊断

```sh
session-peer doctor --json
session-peer doctor --agent codex --codex-home /absolute/home --json
session-peer doctor --host user@host --json
```

公开 npm 0.1.0 不包含此命令。诊断成功（`ok:true`、退出码 0）与代理就绪状态
（`ready`、各代理和 home 的结果）分开报告。只检查限定的元数据和可执行文件路径，
不会执行 Codex、连接 inbox、获取 writer 锁或提交消息。Windows 就绪状态只表示
存活进程公布了 pipe，并不证明 pipe 存在或可以连接。`capabilities` 明确将
wake/wait/ACK 和消费确认标为不支持。可选的 TS 技能元数据检查也不会安装任何内容。
参见[诊断边界](../PARITY.md#source-read-only-doctor--18--020)。SSH 两端需要相同的源码构建。
## 显式安装代理技能

独立的 `session-peer-ts` 技能在配套 PR 中管理，不代表新 npm 或技能标签发布。它支持已发布的 0.1.0 基础功能，通过 TypeScript 标识和帮助检查开发功能。Python 的 `session-peer` 技能仍独立保留。

先检查[固定提交的技能源码](https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts)，再选择代理和安装范围。
以下示例选择 **Codex、当前项目**；请在该项目目录中运行。
Claude Code 使用 `--agent claude-code`。用户范围安装应在 add/list/remove 中一致添加 `--global`。
批准替换已有的 `session-peer-ts` 副本前，请检查本地修改。
Codex 的 `.agents/skills` 目录与其他扫描该路径的客户端共享。

```sh
npx -y skills@1.7.0 add https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts --skill session-peer-ts --agent codex --copy --yes
npx -y skills@1.7.0 list --agent codex --json
npx -y skills@1.7.0 remove session-peer-ts --agent codex --yes
```

更新固定版本时，请检查另一个准确的提交，然后以相同代理和范围重新运行 `add`。
如果代理缓存了技能目录，请重启代理。运行时和技能独立管理：npm `--ignore-scripts` 可正常使用，
postinstall 不会调用 Skills CLI，安装此技能不会覆盖 Python 技能或安装运行时。
参见[兼容性和验证](../PARITY.md#source-ts-skill-guidance--25--020)。
