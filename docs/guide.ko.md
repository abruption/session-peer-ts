# 사용자 가이드 — session-peer (TypeScript)

[README로 돌아가기](../README.ko.md)

[English](guide.md) | [한국어](guide.ko.md) | [日本語](guide.ja.md) | [简体中文](guide.zh-CN.md)

**문서·소스 기준 버전: 0.3.2.** 0.3.2는 현재 공개된 안정 버전입니다([공개 릴리스·검증 기록](../VALIDATION.md#public-032--2026-10-07-kst)). 버전 고정 npm 명령을 실행하기 전에는 레지스트리나 버전 배지에서 지정한 버전의 공개 여부를 확인하세요. 새 버전을 발행하기 전에는 검토한 소스 체크아웃이나 로컬 빌드 산출물을 사용하세요. 빌드와 SSH 양쪽에는 같은 검토 버전을 사용해야 합니다.

이 가이드는 0.3.2를 다룹니다([0.3.1 신뢰성 수정](../PARITY.md#031-reliability-fixes)). 0.3.0에는 여러 호스트를 통한 SSH 전송, 발신자 정보와 회신 경로, 업데이트 확인, 선택 기능인 `sp` 단축 명령이 추가됐습니다([0.3.0 변경 사항](../PARITY.md#030-remote-usability-and-maintenance)). [0.3.1 공개 릴리스 기록](../VALIDATION.md#public-031--2026-10-04-kst)은 이전 버전의 발행 내역입니다. 아래에서 0.1.0을 언급할 때는 이전 버전을 설명합니다.

## 목차

- [주요 기능과 범위](#주요-기능과-범위)
- [요구사항](#요구사항)
- [빠른 시작](#quick-start)
- [설치](#설치)
- [사용법](#사용법)
- [성공의 의미](#성공의-의미)
- [개발·검증](#개발검증)
- [npm 릴리스](#npm-릴리스)
- [관련 프로젝트](#관련-프로젝트)
- [에이전트 스킬: 명시적 설치](#에이전트-스킬-명시적-설치)


**Claude Code와 Codex에서 실행 중인 세션을 찾아 로컬 또는 SSH(보안 원격 접속)로 메시지를 전달**하는
TypeScript 클라이언트입니다. Python을 설치하지 않아도 Node.js에서 실행됩니다.

패키지와 명령줄 도구(CLI) 이름은 모두 **`session-peer`**입니다. 이 프로젝트는 Relay
중계 서버나 호스팅 서비스를 제공하지 않습니다.

<a id="what-it-does"></a>
## 주요 기능과 범위

- 로컬 Claude/Codex 세션과 알려진 Codex 홈(설정·세션 파일이 있는 디렉터리)을 탐색합니다(0.2.0 기능, 아래 참고).
- `--dry-run`으로 대상을 검증한 뒤 애플리케이션의 기본 받은 메시지함(inbox)이나
  대기열(queue)에 메시지를 한 번 제출합니다. Codex 전송에는 보통 고유하고 안정적으로
  실행 중인 writer(메시지를 기록하는 프로세스)가 필요합니다.
- 원격에 별도로 설치한 같은 버전의 클라이언트를 통해 SSH로 전송
- 회신 경로를 나타내는 Reply-To URI(회신 주소)를 수신 대상으로 지정할 수 있고 JSON(구조화된 데이터 형식) 결과를 제공합니다.
- 모호한 대상이나 소유권을 확인할 수 없는 경우 거부하며, 제출 여부가 불확실하면 자동
  재시도하지 않습니다.

Relay 전송, MCP(모델 컨텍스트 프로토콜), wake/resume(세션 깨우기·재개), Antigravity, 자동 업데이트는 지원하지
않습니다. 지원하지 않는 명령은 명시적으로 실패합니다. 여러 에이전트 작업을 조정하는
범용 오케스트레이터가 아닙니다.

추가 기능 계획은 [버전별 호환성 표와 npm 마이그레이션 가이드](../PARITY.md)에서
관리합니다. 계획된 기능은 현재 제공되는 기능이 아닙니다. Relay 서버나 호스팅 서비스도
이 클라이언트의 범위에 포함되지 않습니다.

<a id="unified-listing-in-020"></a>
### 0.2.0 통합 목록

소스에서 빌드한 뒤 `node dist/cli.js list --json`을 실행하면 Claude와 Codex 세션을 함께
조회하고, `list --agent codex --json`은 알려진 Codex 홈을 조회합니다. 공개 npm **0.1.0**은
에이전트와 Codex 목록용 홈을 명시해야 합니다. 이 가이드의 설치 명령과 명시적인
`list`/`send` 명령 형식은 이전 공개 버전인 0.1.0에서도 사용할 수 있습니다.

기본 탐색 대상은 `~/.codex`, `CODEX_HOME`, macOS Orca 계정의 바로 아래 홈,
JSON 배열 `SESSION_PEER_CODEX_HOMES`입니다. `--codex-home`을 지정하면 Codex 목록을
해당 홈에서만 조회하며, 관련 없는 홈의 목록 탐색 오류에는 영향을 받지 않습니다.
`--agent claude`는
Codex 탐색을 생략합니다. 같은 홈을 가리키는 별칭은 하나로 합치지만 서로 다른 홈의
동일 UUID는 각각 보존합니다. 전송할 때는 각 결과의 `codexHome` 값을 사용하세요.
선택적으로 탐색하는 홈이 없으면 오류가 아니지만, 명시한 홈이 없거나 유효하지 않으면
조회에 성공한 행을 보존한 채 종료 코드 1을 반환합니다. 목록 조회는 메시지를 기록할
프로세스(writer)를 선택하거나 메시지를 제출하지 않습니다.
정렬·진단·`--all`·SSH는 [목록 계약](../PARITY.md#source-unified-listing-contract--16--020)을 참고하세요.
0.2.0 소스에서 Codex로 전송할 때 `--codex-home`을 생략하면, 실행 중이며 하나뿐인
안정된 writer가 있는 홈을 선택합니다. 홈을 명시해도 알려진 다른 후보를 모두 검사합니다.
비활성 세션에 메시지를 대기열로 보내려면 저장된 스레드, 모든 후보가 비활성이라는 확인,
`--codex-home HOME --allow-inactive-codex-home` 옵션이 필요합니다. 이 동작은 세션을
깨우거나 다시 시작하지 않습니다. `--dry-run`은 메시지를 제출하지 않습니다.
JSON에는 정제된 `codexHomeResolution`이 포함되며, 네이티브 응답에 식별자가 있을 때만
`queueId`도 포함됩니다. 둘 다 메시지를 읽거나 처리했음을 확인하지 않습니다.
[홈 선택 계약](../PARITY.md#source-codex-home-selection--17--020)을 참고하세요.
공개 **0.1.0**은 여전히 실행 중인 홈을 명시해야 하며 비활성 세션 허용 옵션이 없습니다.
SSH를 사용할 때는 발신·수신 양쪽에 같은 TypeScript 클라이언트 버전(0.3.2)을 설치해야
합니다.

<a id="cli-usability-in-020"></a>
### 0.2.0 CLI 사용성

0.2.0에서는 `list --help`, `send --help`, `doctor --help`와 명시적인
`--output-format text`를 사용할 수 있습니다. 출력 형식은 계속 지정해야 합니다.
`--json` 또는 `--output-format json|text`를 사용하세요. 구문 오류는 JSON으로,
형식이 올바른 text 요청의 실행 결과와 오류는 텍스트로 출력합니다. SSH 요청은 내부에서
항상 JSON으로 주고받습니다.

`send --to TARGET "message" --json`처럼 메시지 본문을 위치 인자로 전달할 수 있습니다.
이 방식과 `--message`/`-m`은 함께 쓸 수 없습니다. 본문을 생략하거나 `-`로 지정하면
표준 입력(stdin)에서 읽습니다. 옵션처럼 보이는 본문 앞에는 `--`를 두세요. 비어 있거나
공백뿐인 본문은 발신자 머리말을 붙이기 전에 거부합니다.

Claude 이름은 Unicode 14.0.0의 기본 완전 대소문자 접기(full casefold)로 정확히 비교합니다.
유니코드 정규화나 유사 이름 검색은 하지 않으므로 같은 이름이 겹치면 PID를 지정하세요.
이 소스 기능은 이미 발행된 0.1.0 패키지에 소급 적용되지 않습니다.


<a id="requirements"></a>
## 요구사항

macOS, Linux 또는 Windows와 **Node 22.x의 22.13 이상 또는 24.x**가 필요합니다.
Node 26은 지원하지 않습니다. 순수 JavaScript 패키지가 아니므로 운영체제와
아키텍처(x64/arm64)에 맞는 `flock`(프로세스 간 파일 잠금 기능) 네이티브 의존성의 사전 빌드 바이너리가 필요합니다.
Codex로 전송하려면 `codex`가 있어야 하며, macOS/Linux에서는 `lsof`와 `ps`도 필요합니다.
Windows에서는 운영체제 잠금과 Restart Manager(파일을 사용 중인 프로세스를 확인하는 기능)로 소유 프로세스를 확인합니다.
Claude Code에는 받은 메시지함에 접근할 수 있는 실행 중 TUI(터미널 사용자
인터페이스)가 필요합니다. SSH를 사용하려면 OpenSSH, 기존 키와 호스트 신뢰 설정, 그리고
원격과 **같은 버전의 클라이언트**가 필요합니다.

<a id="quick-start"></a>
## 빠른 시작

Node 22.x의 22.13 이상 또는 24.x를 사용하세요. Python CLI도 같은 `session-peer`
명령 이름을 쓰므로, 설치 전에 PATH(명령 검색 경로)에서 어떤 실행 파일을 찾는지
확인하세요. 아래 명령은 사용자가 공개된 0.3.2를 npm으로 설치하는 예입니다.
CLI 자체는 패키지를 설치하거나 업데이트하지 않습니다.

```sh
npm view session-peer@0.3.2 version dist.integrity
npm install --global --ignore-scripts session-peer@0.3.2
session-peer --version  # session-peer 0.3.2 (typescript)
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

예상 결과는 `session-peer 0.3.2 (typescript)`입니다.

1. 세션을 조회하고 `CLAUDE_PID`를 대상으로 선택한 정확한 PID로 바꾸세요.
2. `--dry-run`으로 검증합니다. 이 단계에서는 메시지를 제출하지 않습니다.
3. 실제로 전달할 때는 같은 명령에서 `--dry-run`을 빼고 한 번 실행합니다.
4. ACK(수신 확인 응답)가 중요하면 메시지에 명시적인 회신을 요청하고 수신 측 TUI에서
   응답을 별도로 확인하세요. `posted` / `queued`는 제출 또는 큐 수락만 뜻하며, 메시지
   소비나 ACK를 확인한 결과는 아닙니다. [성공의 의미](#성공의-의미)를 참고하세요.

## 설치

npm 설치 절차는 위의 [빠른 시작](#quick-start)을 참고하세요. 아래에서는 소스 빌드와
기존 설치본을 확인하는 방법을 설명합니다.

<a id="build-from-source"></a>
### 소스에서 빌드

공개된 npm 패키지 대신 검토한 소스를 실행하려면 직접 빌드하세요. 필요하다면 로컬에서
만든 패키지 파일(tarball)도 설치할 수 있습니다.

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# Optional global install: first check which session-peer your PATH selects.
npm install --global --ignore-scripts ./session-peer-0.3.2.tgz
session-peer --version
```

0.3.2에서 예상되는 결과는 `session-peer 0.3.2 (typescript)`입니다. 로컬 빌드
산출물을 선택하려면 `./...tgz` 경로를 그대로 두세요. 이후 버전에 이 명령을 사용할
때는 먼저 체크아웃한 소스의 버전을 확인하세요.

<a id="existing-installations"></a>
### 기존 설치본과 PATH

다른 구현도 `session-peer`를 설치할 수 있습니다. 전후에 `type -a session-peer`와
`command -v session-peer`로 확인하고 PATH에서 하나를 선택하거나
`node /absolute/path/dist/cli.js`처럼 명시적으로 실행하세요. 다른 설치 관리자의 파일을
`--force`로 덮어쓰지 마세요. 이 클라이언트는 Python 패키지·스킬·서비스를 자동으로
설치·제거하거나 재설정하지 않습니다. npm 설치본은 사용자가
`npm uninstall --global session-peer`로 직접 제거한 뒤 PATH를 다시 확인하세요.

Windows PowerShell에서는 `Get-Command session-peer -All`로 기존 설치본을 확인하세요.
Python CLI를 덮어쓰지 않으려면 격리 prefix에 설치·제거할 수 있습니다.

```powershell
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts
npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.3.2.tgz
& "$env:TEMP\session-peer-ts-source\node_modules\.bin\session-peer.cmd" --version
# Later: npm uninstall --prefix "$env:TEMP\session-peer-ts-source" session-peer
```

<a id="use"></a>
## 사용법

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'Please review the API contract.' --dry-run --json
```

실제 전달할 때만 `--dry-run`을 제거합니다. `--message`를 생략하거나 `--message -`를
사용하면 UTF-8 stdin을 읽습니다. `--all`은 오래된·보관된 기록을 목록에 포함할 뿐
전송을 허용하지 않습니다. Claude 대상은 PID, `claude:PID`, 모호하지 않은 Unicode 14.0.0 casefold 이름입니다. 충돌 시 PID를 지정하세요.
Codex 전송에는 전체 UUID가 필요하며 홈은 위의 선택 규칙을 따릅니다. `--codex-bin`으로 실행 파일을 고를 수 있습니다. 출력에는
`--json` 또는 `--output-format json|text`이 필요합니다.

<a id="another-machine-over-ssh"></a>
### 다른 머신으로 SSH 전송

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'Please review the API contract.' --dry-run --json
```

원격에서 기본으로 실행하는 명령은 PATH에 있는 `session-peer`입니다. `--remote-bin`에는
지원되는 Node 실행 파일을 선택하는 래퍼의 절대 경로를 지정할 수 있습니다. 연결 과정에서
TypeScript 구현 표시와 정확한 버전을 확인하고, 다른 구현이면 거부합니다. BatchMode
(대화형 입력 없음)와 StrictHostKeyChecking(알려진 호스트 키만 허용)을 적용하며 새 호스트
키를 승인하거나 원격 런타임을 설치하거나 Python으로 대체 실행하지 않습니다. 메시지는
원격 셸 인자가 아니라 JSON 표준 입력(stdin) 요청으로 전달합니다. 이쪽에서 대상에 접속할
수 있어도 대상에서 이쪽으로 회신할 수 있다는 뜻은 아닙니다. 0.3.0부터 Tailscale(기기 간 가상 사설망 서비스)은
경로 선택에 참고하는 정보로만 사용합니다. [회신](#회신)을 참고하세요.

Windows SSH 대상에는 `--remote-platform win32`를 명시하고, 원격 PATH에 없다면
`--remote-bin 'C:\absolute\path\session-peer.cmd'`를 지정하세요. 이미 인증된 OpenSSH
제어 소켓은 `--host`가 정확히 하나일 때 `--ssh-control-path /local/absolute/socket`으로 선택할 수 있습니다. 이 옵션은 호스트 키
검증을 우회하거나 새 로그인을 허용하지 않습니다. Windows 로컬 Codex 홈은
`C:\Users\...\.codex`처럼 전체 경로를 사용합니다. 기존 Python CLI는 자동 제거·교체하지 않습니다.

<a id="several-hosts-and-connection-options"></a>
### 여러 호스트와 연결 옵션

0.3.0부터(0.2.1 이하에는 없음) 반복 `--host`와 제한된 `--ssh-opt`를 받습니다.

```sh
session-peer list --host alpha --host user@[2001:db8::1] \
  --ssh-opt=-p --ssh-opt=2222 --ssh-opt=-i --ssh-opt="$HOME/.ssh/id_ed25519" --json
```

- `--host`가 하나면 기존처럼 객체 하나를 반환합니다. `--host`를 반복하면 같은 순서의
  JSON 배열을 반환하며, 모든 원소에 `schemaVersion`, `ok`, `host`, `command`가 있습니다.
  한 호스트라도 실패하면 종료 코드는 1입니다. 텍스트 출력은 대상마다 `Host: <host>`
  블록을 출력합니다.
- 모든 호스트와 옵션은 `ssh` 프로세스를 하나라도 시작하기 전에 검증합니다. 값 하나가
  잘못되면 명령 전체를 `submitted:false`로 거부합니다. `--` 앞의 `--host VALUE`와
  `--host=VALUE`를 먼저 모으므로, 이런 값이 둘 이상이면 알 수 없는 옵션이나 값 누락을
  포함한 모든 거부가 호스트마다 원소가 하나씩인 배열로 나옵니다. 그보다 적으면 객체
  하나로 나옵니다.
- 같은 대상을 두 번 지정하면 `duplicate_ssh_host`입니다. 이 검사는 대상 문자열(사용자,
  대소문자 무시 호스트 이름, 정규화한 IPv6)만 비교합니다. 같은 장비를 가리키는 서로 다른
  별칭이나 주소는 감지하지 않습니다.
- `--ssh-jump USER@HOST[:PORT]`(한 번만 지정, POSIX 클라이언트 전용)은 모든 `--host`의 모든 `ssh`
  호출을 점프 호스트 하나를 거쳐 보냅니다. 사용자는 필수이고, IPv6는 괄호가 필요하며
  (`hop@[2001:db8::1]:22`), `%`, `$`, 따옴표, 공백 등 셸 문자는 거부합니다
  (`invalid_ssh_jump`). `-J` 대신 CLI가 고정된 `ProxyCommand`를 만듭니다. 점프 구간의
  `ssh`는 `BatchMode=yes`, `StrictHostKeyChecking=yes`, `UpdateHostKeys=no`,
  `ConnectTimeout=10`, `ConnectionAttempts=1`, `ProxyCommand=none`, `ProxyJump=none`,
  `ControlPath=none`, `ForwardAgent=no`, `ClearAllForwardings=yes`,
  `PermitLocalCommand=no`로 실행되고 `-W [target]:port`로 연결합니다. 바깥쪽 `ssh`에도
  `ControlMaster=no`, `ControlPath=none`, `ProxyUseFdpass=no`를 지정하므로, 설정된 제어
  마스터가 점프 구간을 우회할 수 없습니다. `ProxyCommand`는 로그인 셸(`$SHELL`)로
  실행됩니다. sh, bash, zsh로 검증했으며 그 밖의 로그인 셸(예: fish, csh)은 검증하지
  않았습니다. 점프 호스트에도 known_hosts 항목이 따로 필요합니다. `-4`/`-6`을 포함한
  `--ssh-opt` 값은 대상에만 적용되고 점프 호스트에는 전달되지 않으며, 점프 구간은 그 밖에는 해당 호스트의 SSH 설정을 따릅니다. 점프는 한 단계만
  지원합니다. `--ssh-control-path`와 함께 쓸 수 없고(`conflicting_ssh_jump`), Win32-OpenSSH의
  `ProxyCommand` 처리를 검증하기 전까지 Windows 클라이언트에서는 거부합니다
  (`ssh_jump_unsupported_platform`). 결과에 `sshJump`가 추가됩니다.
- 시간 제한은 유한합니다. POSIX에서는 `ssh`마다 제어 터미널이 없는 새 세션·프로세스 그룹으로 분리해 시작합니다.
  정리는 그 그룹에만 적용되며, `setsid()`로 그룹을 벗어난 하위 프로세스는 범위 밖이고 PID
  검색은 하지 않습니다.
  시간 초과나 출력 한도 초과 시 점프 `ProxyCommand`처럼 출력 파이프를 붙잡은 하위 프로세스를
  포함해 그룹 전체를 종료하고 곧바로 반환합니다. CLI가 Ctrl-C, SIGTERM, SIGHUP을 받아도
  종료 전에 그룹을 함께 종료합니다. Windows에서는 직접 실행한 자식만 종료하므로 하위
  프로세스가 남을 수 있지만, 호출은 기한에 반환합니다. 사전 확인 시간 초과는 거부
  (`ssh_preflight_timeout`), 요청 시간 초과는 `unknown`이며 재시도하지 않습니다.
- 각 대상은 순서대로 사전 확인 한 번과 요청 최대 한 번만 받습니다. 거부되거나
  `unknown`인 호스트가 다음 호스트를 막지 않으며, 재시도하거나 다른 곳으로 다시 보내지
  않습니다. 원소마다 결과를 확인한 뒤 판단하세요.
- `--ssh-opt`는 `-p PORT`, `-l USER`, `-i IDENTITY_FILE`, `-o Port=…`, `-o User=…`,
  `-o IdentityFile=…`, `-o IdentitiesOnly=yes|no`, `-4`, `-6`만 허용합니다.
  `ProxyCommand`, `LocalCommand`, `-F`, `Include`, `-J`/`ProxyJump`,
  `BatchMode`/`StrictHostKeyChecking` 변경을 포함한 나머지는 모두 거부합니다
  (`unsupported_ssh_option`). `-J` 대신 `--ssh-jump`를 쓰세요. OpenSSH 자체의 `-J`
  점프 구간에는 명령줄의 `BatchMode`와 `StrictHostKeyChecking`이 전달되지 않습니다.
- IPv6 리터럴은 괄호 없이(`2001:db8::1`) 또는 괄호로(`[2001:db8::1]`,
  `user@[2001:db8::1]`) 쓸 수 있습니다. 영역 ID(`%`)는 거부합니다.
- 결과에 `sshUser`, `sshUserSource`가 추가됩니다. `USER@HOST`나 `-l USER`이면
  `explicit`, `ssh -G`로 확인하면 `ssh_config_or_local_default`, 확인하지 못하면
  `sshUser:null`과 `unknown`입니다. `-l`과 `USER@HOST`를 함께 쓰면 거부합니다. 명시적인
  사용자가 없으면 호스트마다 로컬 `ssh -G`를 한 번(최대 5초) 실행합니다. 접속하지는
  않지만 ssh(1)·ssh_config(5)에 설명된 대로 일반 `ssh`와 똑같이 SSH 설정을 평가하며,
  `Match exec` 명령도 실행됩니다.
- 신뢰 경계는 두 가지입니다. 허용 목록은 이 CLI가 명령줄로 넘기는 옵션에만 적용됩니다.
  사용자의 `~/.ssh/config`(와 시스템 설정)는 신뢰하는 사용자 설정이며, 그 안의
  `ProxyCommand`, `ProxyJump`, `Match exec` 등은 직접 실행하는 `ssh`와 똑같이 이 CLI가
  시작하는 모든 `ssh`에 적용됩니다.

Python 없이 SSH 대상 머신을 준비하는 방법(버전별 전용 설치 디렉터리, 무결성 검증,
소유권과 롤백 규칙)과 패키지 버전과 분리된 프로토콜 호환성 계약에 대한 설계 제안은
[원격 배포 ADR](design/remote-deployment.md)(ADR: 아키텍처 결정 기록)에 있습니다.
0.4는 아직 발행되지 않았습니다. 위 내용은 다음 버전을 위한 설계 제안으로 공개된
0.3.2에는 포함되지 않았으며, 아직 구현되지 않았습니다.
따라서 위에서 설명한 SSH 양쪽의 동일 버전 요구 사항은 그대로 적용됩니다.

<a id="replies"></a>
### 회신

`session-peer://v1/reply?...` URI를 `--to`로 사용할 수 있습니다. 알 수 없거나 중복된
필드, 안전하지 않은 호스트, 잘못된 인코딩, 명시적 경로와의 충돌은 거부합니다.
상대(peer)의 메타데이터는 권한의 근거가 아니며 Reply-To URI를 셸 명령으로 실행하지
않습니다. 받은 Reply-To는 읽는
사람을 위한 데이터일 뿐이고, 회신을 자동으로 관찰하거나 확인하지 않습니다.

0.3.0부터(0.2.1 이하에는 없음) 발신자 정보와 자동 회신 경로를 추가합니다.

- **발신자.** Claude Code 안에서는 `CLAUDE_CODE_MESSAGING_SOCKET`이 등록된 살아 있는
  세션 정확히 하나와 일치해야 합니다. 그 세션의 고유하고 출력 가능한 이름(아니면 PID)이
  `From: claude:NAME`이 됩니다. Codex 안에서는 유효한 `CODEX_THREAD_ID`(또는
  `CODEX_SESSION_ID`)가 `From: codex:UUID`가 됩니다. 증거가 충돌하거나 중첩되거나
  유효하지 않으면 발신자를 정하지 않고, 이때는 회신 경로도 만들지 않습니다.
  `--no-from`은 From만 생략합니다.
- **자동 Reply-To.** 발신자가 있고 `--no-reply-to`가 없으면, 로컬 전송에는
  `transport=local` URI를 붙입니다. SSH 전송이나 `--reply-to`를 쓰면 `transport=ssh`
  URI를 붙이며, 호스트는 `--reply-to HOST`, `SESSION_PEER_REPLY_HOST`,
  `CC_PEER_REPLY_HOST`, 이 장비의 tailnet(기기 간 가상 사설망) 이름·주소 순으로 정합니다. 사용자가 없는
  호스트에는 현재 사용자를 붙입니다. 호스트를 찾지 못하면 SSH 경로를 붙이지 않습니다.
  `--reply-address URI`는 기존처럼 명시적인 대안입니다. `--reply-to`,
  `--reply-address`, `--no-reply-to`는 함께 쓸 수 없습니다. 모든 URI는 `--to`와 같은
  파서로 검증합니다.
- **JSON.** `replyRoute`는 생성한 경로를 알려 줍니다. 로컬 경로는 `verified`
  (`same_machine_route`), SSH 경로는 `unverified`(`reverse_ssh_not_checked`)입니다.
  `--to`가 URI이면 `addressResolution`에 전송 방식을 기록하고, 로컬로 전달했다면
  `normalizedFrom: "ssh_self"`를 함께 기록합니다.
- **같은 장비.** SSH 회신 URI는 호스트에 현재 OS 사용자가 포함되고 이 장비를 가리키며
  (정확한 `localhost`, 정규 표기 `127.x.y.z`, `::1`, `::ffff:127.x.y.z`, 호스트 이름,
  Tailscale 자기 노드. `127.1`, `0177.0.0.1` 같은 비정규 숫자 표기나 `::7f00:1` 같은
  IPv4 호환 주소는 해당하지 않음), `--host`나 SSH 옵션(`--ssh-jump` 포함)을 주지
  않았을 때만 로컬로 전달합니다. 사용자가 다르거나 없으면 SSH로 남습니다.
- **Tailscale.** `tailscale status --json`(3초 제한)은 경로 힌트로만 씁니다. `Online`이
  불리언 `true`인 피어(MagicDNS 켜짐)는 지정한 SSH 별칭을 그대로 대상으로 쓰고
  `HostName=<MagicDNS 이름>`을 추가합니다. `HostKeyAlias=<원래 이름>`도 추가하지만,
  사용자를 확인하는 같은 `ssh -G` 결과에 SSH 설정의 `HostKeyAlias`가 이미 있으면 그
  값을 유지하고, 확인에 실패하면 아무것도 덮어쓰지 않습니다. 이때 결과의 `host`는
  MagicDNS 이름, `sshHost`는 지정한 별칭입니다. `Online`이 불리언 `false`인 피어(MagicDNS가
  꺼져 있어도)나 모호한 이름은 SSH 전에 거부합니다(`tailscale_peer_offline`,
  `tailscale_destination_ambiguous`). 그 밖의 `Online` 값, MagicDNS 꺼짐, 모르는 이름,
  중지되었거나 없는 Tailscale, `SESSION_PEER_TAILSCALE=off`는 일반 SSH로 처리합니다.
- **회신 경로 점검.** `doctor --check-return-route [--reply-to USER@HOST]`는 진단 대상
  장비(`--host` 대상 또는 현재 장비)에서 `ssh … USER@HOST 'exit 0'`을 실행합니다. batch
  모드, 비밀번호·키보드 대화형 프롬프트 없음, 엄격한 호스트 키, 호스트 키 갱신 없음,
  제어 소켓 없음, 접속 제한 5초를 적용합니다. 8초 제한은 마지막 `ssh` 명령에만
  적용되며, 그 전의 Tailscale 상태(3초)와 `ssh -G`(5초) 조회에는 각자의 제한이 있습니다.
  `exit 0`은 POSIX 셸, cmd.exe, PowerShell에서 모두 아무 일도 하지 않으므로, 회신
  호스트는 이 중 하나를 기본 셸로 쓰는 OpenSSH 서버면 됩니다(픽스처 검증은 POSIX 회신
  호스트만). `returnRoute`는 `verified` 또는 `failed`와 사유(`return_host_unavailable`,
  `return_host_is_receiver`, `ssh_executable_missing`, `authentication_failed`,
  `host_key_failed`, `timeout`, `transport_failed`, `remote_command_failed`)입니다. 로컬
  점검에서는 같은 장비의 현재 사용자를 SSH 없이 로컬 경로로 처리합니다. `--host`를 쓰면
  장비를 가리킬 수 있는 회신 호스트(DNS 없이 판단: `localhost`, `*.localhost`, 정규 표기
  127.0.0.0/8·0.0.0.0/8, `::1`, `::`, 이들의 `::ffff:` 매핑 형태, IPv4 호환 IPv6(`::a.b.c.d`),
  그리고 리졸버마다 해석이 달라지는 모든 비정규 숫자 표기: 앞자리 0, 네 부분 미만, 16진·8진
  부분, 단일 정수, `127.1`·`0177.0.0.1`·`2130706433`·`4294967296` 같은 범위 초과)는 대상이 자기 자신으로 읽으므로 SSH
  전에 거부합니다(`invalid_return_route`). 대상 쪽에서는 대상 자신의 알려진 이름(사용자와
  무관)이거나 증명할 수 없는 숫자 표기인 회신 호스트가 `return_host_is_receiver`로 실패하며
  검증된 로컬 경로로 보고하지 않습니다. 여기서 알려진 이름은 OS 호스트 이름 또는 Tailscale
  자기 노드의 이름·주소와 정확히 일치하는 경우만 뜻하며, 그 밖의 DNS·LAN 별칭은 감지하지
  않습니다. 원격 전송도 루프백이나 비정규 숫자 표기의 회신 호스트를 알리지 않습니다
  (`invalid_reply_host`). 자동 실행이나 재시도는 하지 않으며, 정방향 접속이 된다고 이 점검을
  통과한 것으로 보지 않습니다. 이 CLI가 시작하는 다른 `ssh`와 마찬가지로, 점검과 그
  `ssh -G` 사용자 확인은 점검하는 장비에서 신뢰하는 SSH 설정(`ProxyCommand`, `Match exec`
  포함)을 사용합니다(위의 신뢰 경계 참고). 명령줄 허용 목록은 그 파일에 적용되지 않습니다.

<a id="what-success-means"></a>
## 성공의 의미

| 결과 | 의미 |
| --- | --- |
| `validated`, `submitted:false` | dry-run 검증 통과. 메시지를 제출하지 않음 |
| `posted` / `queued` | 네이티브 받은 메시지함에 기록 / 큐 수락. **소비나 ACK를 확인한 상태가 아님** |
| `refused`, `submitted:false` | 제출 전에 요청을 거부 |
| `unknown`, `submitted:null` | 제출됐을 수도 있어 상태가 불확실함. 자동 재전송 금지 |

제출 후 회신이 없거나 대상이 종료됐다는 사실만으로 소비나 실패를 확정할 수 없습니다. 자동 재전송하지 마세요.

`consumptionConfirmed`는 항상 `false`입니다. 실제 ACK는 수신 측 TUI에서 별도로
확인하며, 큐 결과나 대화 기록(transcript)을 반복 조회해 추정하지 않습니다. 종료 코드는
성공/오류/사용법에
0/1/2를 사용합니다. 오류는 고정 코드로 반환하며 원문 표준 오류(stderr)·메시지를 노출하지 않습니다.
Codex는 커널의 flock, 파일 식별자, 같은 사용자가 소유한 프로세스의 시작 시각을 여러
차례 확인한 뒤 큐에 넣기 직전에 다시 검증합니다. 잠금을 삭제하거나 소유 프로세스에
신호를 보내지 않습니다. 탐색 결과에 포함된 이름·경로·ID는 공유 전에 가리세요.

<a id="development-and-verification"></a>
## 개발·검증

```sh
npm ci --ignore-scripts
npm run build
node scripts/check-repository.mjs
SESSION_PEER_PYTHON_ROOT=/path/to/python-reference npm test
npm run test:package
npm audit
```

Python은 개발 시 TypeScript 구현과 동작이 일치하는지 대조하는 기준 구현(conformance oracle)입니다(v1.0.2 커밋
`47c23713d0a2a3c11ebde6186afd8c43489b8b65`)일 뿐 런타임 의존성이 아닙니다. POSIX 계약 테스트에는
C 컴파일러와 lsof도 필요합니다. CI(지속적 통합)는 세 OS에서 Node 22/24를 사용합니다.
macOS/Linux는 고정된 참조 기준으로 전체 계약·패키지 검사를 실행하고, Windows는
x64에서 빌드·타입 검사, 네이티브 Claude 받은 메시지함·잠금 점유/해제, writer 소유권·재검증
경합, CLI 큐 결과, 격리된 가짜 엔드포인트를 통한 PowerShell/.cmd SSH 프레이밍,
패키지 설치·네이티브 로드·삭제와 취약점 검사(audit)를 확인합니다. 이는 fixture(테스트용 고정 데이터·환경)
검사이며 Windows에서 POSIX(유닉스 계열 운영체제 표준)/Python 참조 스위트를 실행한다는 뜻은 아닙니다.
Windows x64/Node 24에서 실제 TUI로 확인한 ACK는 별도의 일회성 증거입니다. 임시 SQLite·Unix
받은 메시지함·실제 잠금 fixture 검사와 [VALIDATION.md](../VALIDATION.md)의 실제 TUI 증거는
구분합니다. fixture 통과는 ACK가 아닙니다. 패키지 내용·반복 빌드 해시·
새 환경 설치·삭제도 검사합니다. 네이티브 의존성에는 설치 스크립트가 있지만 검증한 사전
빌드 경로는 `--ignore-scripts`를 사용합니다. SQLite를 읽기 전용으로 열어도 WAL(미리 쓰기
로그)의 공유 메모리 관리에 참여할 수 있으므로 스냅샷을 읽는 것은 아닙니다.

[CONTRIBUTING.md](../CONTRIBUTING.md), [RELEASING.md](../RELEASING.md),
[SECURITY.md](../SECURITY.md)를 참고하세요. 이후 릴리스 발행도 수동으로 진행하며 별도
승인이 필요합니다. [MIT 라이선스](../LICENSE)를 따릅니다.

<a id="package-release"></a>
## npm 릴리스

0.3.2는 2026-10-07 KST에, 0.3.1은 2026-10-04 KST에 공개·검증했습니다.
[0.3.2 공개 기록](../VALIDATION.md#public-032--2026-10-07-kst)과
[0.3.1 공개 기록](../VALIDATION.md#public-031--2026-10-04-kst)을 참고하세요.
이전 버전인 0.2.1과 0.2.0도 각각 2026-09-29 KST와 2026-09-28 KST에
공개·검증했습니다. [0.2.1 공개 기록](../VALIDATION.md#public-021--2026-09-29-kst)과
[0.2.0 공개 기록](../VALIDATION.md#public-020--2026-09-28-kst)에서 확인할 수 있습니다.
설치 전에는 정확한 버전과 현재 npm 태그를 확인하세요.

```sh
npm view session-peer@0.3.2 version dist.integrity
npm view session-peer dist-tags
```

변경할 수 없는 0.1.0 아카이브에는 발행 전 README 문구가 남아 있습니다. 이 아카이브는
기능을 버전별로 구분해 설명하며, 날짜별 발행 기록은
[0.1.0 공개 기록](../VALIDATION.md#public-010--2026-09-27-kst)에 있습니다.
릴리스 워크플로는 Trusted Publisher의 OpenID Connect(OIDC) 방식으로 사전 업로드(staging)를 진행하고,
메인테이너의 별도 2단계 인증(2FA) 승인을 받습니다. 사전 업로드만으로는 공개 릴리스가 되지 않습니다.
[RELEASING.md](../RELEASING.md)를 참고하세요.

<a id="related-project"></a>
## 관련 프로젝트

Python 구현인 [session-peer](https://github.com/abruption/session-peer)는 별도로
유지·배포합니다. 선택 기능과 설치법(예: `pipx install session-peer`)은 해당 저장소에서
확인하세요. Python CLI와 이 TypeScript CLI는 서로 다른 구현이지만 명령 이름은 모두
`session-peer`이므로, 위 PATH 안내에 따라 사용할 구현을 선택하세요. 이 클라이언트는
Python 패키지에 의존하지 않으며 모든 기능과 플래그가 서로 호환된다고 보장하지 않습니다.

<a id="read-only-diagnostics-in-020"></a>
### 0.2.0 읽기 전용 진단

```sh
session-peer doctor --json
session-peer doctor --agent codex --codex-home /absolute/home --json
session-peer doctor --host user@host --json
```

공개 npm 0.1.0에는 없는 소스 기능입니다. 진단 성공(`ok:true`, 종료 코드 0)과
에이전트 준비 상태(`ready`, 에이전트·홈별 결과)는 별개입니다. 범위를 제한해 메타데이터와
실행 파일 경로만 검사하며 Codex를 실행하거나 받은 메시지함에
연결하거나 writer 잠금을 획득하거나 메시지를 제출하지 않습니다. Windows에서 받은
메시지함이 준비됐다는 표시는 실행 중인 프로세스가 파이프(named pipe)를 알렸다는 뜻일
뿐, 파이프가 실제로 존재하거나 연결을 받아들인다는 보장은 아닙니다. `capabilities`는
wake/wait/ACK와 소비
확인을 미지원으로 표시합니다. 선택적 TS 스킬 메타데이터 검사도 설치를 하지 않습니다.
[진단 경계](../PARITY.md#source-read-only-doctor--18--020)를 참고하세요. SSH를 사용할 때는
양쪽에 같은 버전의 TypeScript 클라이언트를 설치해야 합니다.
<a id="update-checks-and-notices-030-22"></a>
### 업데이트 확인과 알림 (0.3.0, #22)

```sh
session-peer update --check --json
session-peer update --check --channel preview --output-format text
```

0.3.0에서 추가된 명령이며 0.2.1 이하에는 없습니다. `update --check`는 `session-peer`의 npm
배포 태그(dist-tag)를 한 번 요청합니다(제한 시간 3초, 재시도 없음). 응답에 `current`,
`latest`, `channel`(기본 `latest`, 또는 `preview`), `source: "npm_registry"`,
`status`(`update_available`,
`up_to_date`, `ahead`), `managedBy`, `updateCommand`, `guidance`를 보고합니다.
`updateCommand`는 실행 중인 CLI 경로로 설치 주체를 확인할 수 있을 때 사용자에게 안내합니다.
해당하는 경우는
자체 `session-peer` 실행기가 이 패키지를 가리키는 npm 전역 prefix(기본, Homebrew, nvm,
nvm-windows, fnm. 예: `npm install --global --ignore-scripts session-peer@0.3.2`),
매니페스트에 `session-peer`가 선언된 pnpm·Yarn·Bun 전역 저장소, Volta, npx 캐시입니다.
프로젝트 설치(`npm_project`, `pnpm_project`), 소스 체크아웃(`source`), 그 밖의
경우(`unknown`)에는 `updateCommand: null`과 `guidance` 문장만 돌려주므로, 관련 없는 현재
디렉터리를 변경하는 명령을 안내하지 않습니다. 업데이트는 사용자가 안내된 npm 명령을
직접 실행해야 합니다. 이 기능은 npm 버전만 보고하며 Python `session-peer`
릴리스는 별개의 버전 흐름이라 비교하지 않습니다. 레지스트리 실패는 종료 코드 1과
`registry_timeout`, `registry_unreachable`, `registry_http_error`,
`registry_response_invalid`, `dist_tag_missing` 중 하나로 보고하며 응답 본문은 출력하지
않습니다.

`--check` 없는 `update`는 아무것도 바꾸지 않습니다. `self_update_unsupported`(종료 코드
2)로 거부하고 `managedBy`, `updateCommand`, `guidance`, `checkCommand`를 돌려줍니다.
`update` 자체는 로컬 전용이라 `--host`를 거부하고 SSH를 통해 전달된 원격 요청도
거부합니다. 원격 호스트, Python 설치, 별도로 관리되는 `session-peer-ts` 스킬은 갱신하지 않습니다. 결과에는
로컬 TS 스킬 메타데이터(`skills`, `doctor`와 같은 계약)와 `skillsManagedBy: "separate"`가
포함됩니다.

`list`, `send`, `doctor`의 캐시 기반 알림은 **기본적으로 꺼져 있습니다**. 이 CLI는 주로
에이전트와 스크립트가 실행하므로 요청하지 않은 네트워크 호출을 하지 않아야 하기
때문입니다. `SESSION_PEER_UPDATE_NOTICE=1`로 켜면, 24시간 이내의 캐시가 더 새로운 npm
안정 버전을 가리킬 때 JSON 결과에 `clientUpdate` 객체를 추가하고 텍스트 출력에서는
stderr에 한 줄을 씁니다. 캐시가 없거나 잘못됐거나 만료되면 분리된 갱신 프로세스를 하나
시작하며 명령 결과와 종료 코드를 지연시키거나 바꾸지 않습니다. 갱신에 실패하면 다음
시도까지 1시간 동안 대기합니다. 캐시 쓰기는 한 번에 하나만 허용하며(single-flight), 안전을
확인할 수 없으면 기록하지 않습니다(fail closed). 백그라운드 갱신이든 명시적 확인이든
모든 쓰기는 `npm-update.lock`을 보유한 동안에만, 더 오래된 기록 위에만
이뤄집니다. 자신이 만들지 않은 잠금을 인계받거나 지우는 일은 없습니다. 갱신이 비정상 종료하거나 I/O 오류로 잠금을
해제하지 못해 잠금이 남으면 백그라운드 갱신은 멈추고 `update --check`는
`cache: "skipped_stale_lock"`을 보고합니다. 실행 중인 session-peer 프로세스가 없을 때
`npm-update.lock`을 직접 삭제하세요.

`--no-update-notice`와 `SESSION_PEER_NO_UPDATE_NOTICE=1`은 이 백그라운드 알림과 갱신을
억제합니다. 명시적인 `update --check`는 사용자가 의도한 요청이므로 항상 레지스트리에
접속하며, `latest` 채널에서는 잠금이 비어 있을 때 캐시를 씁니다(`cache`는 `written`,
`skipped_locked`, `skipped_stale_lock`, `skipped_newer`, `failed` 중 하나). 알림은 로컬 클라이언트에 속합니다.
`--host`를 쓰면 클라이언트가 SSH로 받은 결과를 포함한 자신의 최상위 출력에
`clientUpdate`(또는 stderr 한 줄)를 추가합니다. `--host`를 반복해 JSON 배열이 나오면 배열과
각 요소의 형태를 그대로 유지하고 `clientUpdate`를 추가하지 않으며, 텍스트 출력에는 stderr 한
줄을 그대로 씁니다. 호스트 수와 관계없이 호출당 갱신은 최대 한 번입니다. 실패한 단일 호스트 결과(예: 거부된 SSH 사전
확인)에도 알림이 붙을 수 있지만, 구문 오류와 로컬 거부에는 붙지 않으며, 알림은 상태·종료 코드·
재시도 판단을 바꾸지 않습니다. 원격 호스트가 보낸 `clientUpdate`는 버립니다. `--stdio-request` 모드의 수신 측은
캐시를 읽거나 갱신하지 않으며 알림을 만들지 않습니다.

캐시 파일은 `SESSION_PEER_CACHE_DIR`(절대 경로)의 `npm-update.json`이며, 없으면
`$XDG_CACHE_HOME/session-peer`, `~/Library/Caches/session-peer`(macOS),
`~/.cache/session-peer`(Linux), `%LOCALAPPDATA%\session-peer\Cache`(Windows)를 씁니다.
0700 디렉터리에 0600 권한으로 원자적으로 기록하며 공개 버전 정보만 담습니다.
`SESSION_PEER_UPDATE_REGISTRY`로 미러를 지정할 수 있습니다(HTTPS 또는 loopback 전용
HTTP, 자격 증명 불가). npm 설정과 `.npmrc`는 읽지 않습니다.
[업데이트 경계](../PARITY.md#source-update-checks--22)를 참고하세요.

<a id="agent-skill-explicit-installation"></a>
## 에이전트 스킬: 명시적 설치

별도 `session-peer-ts` 동반 스킬은 [동반 PR #14](https://github.com/abruption/session-peer-skill/pull/14)에서 추적합니다. 새 npm 패키지나 스킬 태그를 발행하는 작업은 아닙니다. 공개된 0.1.0 기본 기능을 지원하고, TypeScript 구현 표시를 감지하며, 개발 중인 기능을 사용하기 전에 도움말에서 지원 여부를 확인합니다. Python `session-peer` 스킬은 별도로 유지합니다.

[고정된 스킬 소스](https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts)를 검토한 뒤 에이전트와 설치 범위를 선택하세요.
아래 예시는 **Codex, 현재 프로젝트**를 선택합니다. 해당 프로젝트 디렉터리에서 실행하세요.
Claude Code는 `--agent claude-code`를 사용합니다. 사용자 범위는 add/list/remove 모두에
`--global`을 동일하게 추가하세요. 기존 `session-peer-ts` 사본을 교체하기 전에 로컬 수정 사항을
확인하세요. Codex의 `.agents/skills` 디렉터리는 이 경로를 탐색하는 다른 클라이언트와 공유됩니다.

```sh
npx -y skills@1.7.0 add https://github.com/abruption/session-peer-skill/tree/081cc3c1d16a394bd92824333f4bc61c36951799/session-peer-ts --skill session-peer-ts --agent codex --copy --yes
npx -y skills@1.7.0 list --agent codex --json
npx -y skills@1.7.0 remove session-peer-ts --agent codex --yes
```

고정 버전을 업데이트하려면 다른 정확한 커밋을 검토한 뒤 같은 에이전트와 범위로 `add`를 다시 실행합니다.
스킬 목록을 캐시하는 에이전트는 다시 시작하세요. 런타임과 스킬은 별도로 관리합니다.
npm `--ignore-scripts`로 설치해도 되며, 설치 후 Skills CLI를 호출하는 postinstall 스크립트는 없습니다.
이 스킬 설치는 Python 스킬을 덮어쓰거나 런타임을 설치하지 않습니다.
[호환성과 검증](../PARITY.md#source-ts-skill-guidance--25--020)을 참고하세요.

<a id="optional-sp-shorthand"></a>
## 선택적 sp 단축 이름

선택적 `sp` 단축 이름은 0.3.0 이상에 포함되며(0.2.1 이하에는 없음) 자동으로 켜지지 않습니다.
[명시적 활성화와 이름 충돌 안내(영문)](shorthand.md)를 참고하세요.
