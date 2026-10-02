# 사용자 가이드 — session-peer (TypeScript)

[README로 돌아가기](../README.ko.md)

[English](guide.md) | [한국어](guide.ko.md) | [日本語](guide.ja.md) | [简体中文](guide.zh-CN.md)

0.2.1 상세 가이드입니다. 0.2.1은 0.2.0의 안정성·보안 보강 업데이트입니다([변경 사항](../PARITY.md#021-reliability-and-hardening)). 이전 발행 기록은 [0.2.0 공개 릴리스 증거](../VALIDATION.md#public-020--2026-09-28-kst)에 있습니다. 아래 0.1.0 설명은 이전 버전과의 비교입니다.

## 목차

- [주요 기능과 범위](#주요-기능과-범위)
- [요구사항](#요구사항)
- [설치](#설치)
- [사용법](#사용법)
- [성공의 의미](#성공의-의미)
- [개발·검증](#개발검증)
- [npm 릴리스](#npm-릴리스)
- [관련 프로젝트](#관련-프로젝트)
- [에이전트 스킬: 명시적 설치](#에이전트-스킬-명시적-설치)


실행 중인 **Claude Code·Codex 세션에 로컬 또는 SSH로 메시지를 전달**하는
TypeScript 클라이언트입니다. Python 없이 Node.js로 실행합니다.

**0.2.1 사용 안내입니다.** 패키지명은
`session-peer`, CLI 명령어는 **`session-peer`**입니다. Relay 서버나 호스팅
서비스를 제공하는 프로젝트가 아닙니다.

## 주요 기능과 범위

- 로컬 Claude/Codex 세션과 알려진 Codex 홈 탐색 (0.2.0 기능, 아래 참고)
- `--dry-run`으로 대상을 검증한 뒤 네이티브 inbox 또는 queue에 메시지 1회 제출
- 원격에 명시적으로 설치한 같은 버전의 클라이언트로 SSH 전송
- 구조화된 Reply-To URI와 JSON 결과
- 모호한 대상·확인할 수 없는 소유권은 거부하고, 불확실한 제출은 자동 재시도하지 않음

Relay 전송, MCP, wake/resume, Antigravity, 자동 업데이트는 미지원입니다. 미지원 옵션은 명시적으로
거부하며 범용 오케스트레이터를 지향하지 않습니다.

클라이언트 기능 계획은 [버전별 호환성 표와 npm 이주 가이드](../PARITY.md)에서 추적하며, 계획은 현재 지원을 뜻하지 않습니다. Relay 서버·호스팅 서비스 제공은 이 클라이언트의 범위 밖입니다.

### 0.2.0 통합 목록

소스 빌드 후 `node dist/cli.js list --json`은 Claude/Codex를 함께 조회하고,
`list --agent codex --json`은 알려진 홈을 조회합니다. 공개 npm **0.1.0**은 여전히
에이전트와 Codex 목록용 홈을 명시해야 합니다. 0.2.0에서도 명시적 명령 형식을 쓸 수 있습니다.

탐색 범위는 기본 `~/.codex`, `CODEX_HOME`, macOS Orca의 바로 아래 계정 홈,
JSON 배열 `SESSION_PEER_CODEX_HOMES`입니다. `--codex-home`은 Codex 목록을 해당 홈에
고정하고 다른 설정 오류를 우회하며, `--agent claude`는 Codex 탐색을 생략합니다.
동일 홈의 별칭은 합치지만 다른 홈의 동일 UUID는 보존합니다. 전송에는 각 행의
`codexHome`을 사용하세요. 선택적 홈 부재는 오류가 아니지만 명시된 홈의 부재·오류는
성공한 행을 보존하면서 종료 코드 1을 반환합니다. 목록은 writer를 선택하거나 전송하지 않습니다.
정렬·진단·`--all`·SSH는 [목록 계약](../PARITY.md#source-unified-listing-contract--16--020)을 참고하세요.
0.2.0의 Codex 전송은 `--codex-home` 생략 시 유일하고 안정된 live writer 홈을
선택합니다. 명시한 홈도 모든 알려진 경쟁 홈을 검사합니다. 비활성 큐는 저장된 스레드와
모든 후보의 비활성 검증에 더해 `--codex-home HOME --allow-inactive-codex-home`이
필요하며 wake/resume을 수행하지 않습니다. Dry-run은 제출하지 않습니다.
JSON에는 정제된 `codexHomeResolution`과 네이티브 출력에 있을 때만 `queueId`가 추가되며,
둘 다 소비 확인은 아닙니다. [홈 선택 계약](../PARITY.md#source-codex-home-selection--17--020)을 참고하세요.
공개 **0.1.0**은 여전히 명시적 live 홈이 필요하고 비활성 허용 옵션이 없습니다.
SSH 양쪽에는 동일한 0.2.1 빌드를 사용하세요.

### 0.2.0 CLI 사용성

0.2.0는 `list --help`, `send --help`, `doctor --help`, `--output-format text`를 제공합니다.
출력 형식은 계속 명시해야 합니다: `--json` 또는 `--output-format json|text`.
구문 오류는 JSON이며 유효한 text 요청의 실행 결과·오류는 텍스트입니다. SSH
내부 전송은 항상 JSON입니다. `send --to TARGET "message" --json` 위치 인자를
지원하며 `--message`/`-m`과 중복할 수 없습니다. 본문 생략 또는 `-`는 stdin,
옵션처럼 시작하는 위치 본문 앞에는 `--`를 사용합니다. 빈 본문·공백 본문은
발신자 머리말 추가 전에 거부합니다. Claude 이름은 Unicode 14.0.0 기본 full
casefold로 정확히 비교하며 정규화·유사 검색을 하지 않습니다. 충돌 시 PID를
지정하세요. 이미 발행된 0.1.0에는 이 소스 기능이 소급 적용되지 않습니다.


## 요구사항

macOS/Linux/Windows native와 Node **22.x의 22.13 이상 또는 24.x**가 필요합니다. Node 26은
미지원입니다. 네이티브 flock 의존성에 맞는 사전 빌드 바이너리(x64/arm64)가 필요하므로
순수 JavaScript 패키지는 아닙니다. Codex 전송에는 `codex`가 필요하고 macOS/Linux에서는
`lsof`, `ps`도 필요합니다. Windows는 네이티브 잠금과 Restart Manager로 소유자를 확인합니다. 저장된
스레드의 유일하고 안정적인 live writer가 필요합니다. Claude는 접근 가능한 inbox가
있는 실행 중 TUI가 필요합니다. SSH에는 OpenSSH, 기존 키·호스트 신뢰 설정과 원격의
**동일 버전 클라이언트**가 필요합니다.

## 설치

Node 22.x의 22.13 이상 또는 24.x에서 검증된 안정판을 설치합니다.
Python CLI도 같은 명령어를 사용하므로 기존 설치본이 있다면 먼저 PATH를 확인하세요.

```sh
npm install --global --ignore-scripts session-peer@0.2.1
session-peer --version
```

예상 출력은 `session-peer 0.2.1 (typescript)`입니다.

1. `session-peer list --agent claude --json`으로 대상을 찾고 정확한 PID를 선택합니다.
2. `session-peer send --to CLAUDE_PID --message '확인 후 회신해 주세요.' --dry-run --json`으로 제출 없이 검증합니다.
3. 실제 전달할 때 선택한 PID로 같은 명령에서 `--dry-run`을 제거해 한 번 실행합니다.
4. ACK가 필요하면 메시지에 명시적인 회신을 요청하고 수신 TUI의 응답을 별도로 확인합니다. `posted` / `queued`는 제출만 뜻합니다.

### 소스에서 빌드

공개된 npm 패키지 대신 검토한 소스를 실행하려면 빌드하고 필요한 경우
로컬 tarball을 설치합니다.

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# 선택 사항: PATH에서 사용할 구현을 명시적으로 선택한 뒤 전역 설치
npm install --global --ignore-scripts ./session-peer-0.2.1.tgz
session-peer --version
```

설치 명령의 `./...tgz`는 로컬 산출물을 지정하므로 생략하지 마세요.
나중 버전의 소스를 사용할 때는 체크아웃 버전을 먼저 확인하세요.

### 기존 설치본과 PATH

다른 구현도 `session-peer`를 설치할 수 있습니다. 전후에 `type -a session-peer`와
`command -v session-peer`로 확인하고 PATH에서 하나를 선택하거나
`node /절대/경로/dist/cli.js`처럼 명시적으로 실행하세요. 다른 설치 관리자의 파일을
`--force`로 덮어쓰지 마세요. Python 패키지·스킬·서비스는 자동 설치·삭제·설정하지
않습니다. npm 설치본 제거는 `npm uninstall --global session-peer`로 하고 PATH를
다시 확인하세요.

Windows PowerShell에서는 `Get-Command session-peer -All`로 기존 설치본을 확인하세요.
Python CLI를 덮어쓰지 않으려면 격리 prefix에 설치·제거할 수 있습니다.

```powershell
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts
npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.2.1.tgz
& "$env:TEMP\session-peer-ts-source\node_modules\.bin\session-peer.cmd" --version
# 이후 제거: npm uninstall --prefix "$env:TEMP\session-peer-ts-source" session-peer
```

## 사용법

```sh
session-peer list --agent claude --json
session-peer list --agent codex --codex-home "$HOME/.codex" --json
session-peer send --to CLAUDE_PID --message 'API 계약을 검토해 주세요.' --dry-run --json
session-peer send --to codex:THREAD_UUID --codex-home "$HOME/.codex" --message 'API 계약을 검토해 주세요.' --dry-run --json
```

실제 전달할 때만 `--dry-run`을 제거합니다. `--message`를 생략하거나 `--message -`를
사용하면 UTF-8 stdin을 읽습니다. `--all`은 오래된·보관된 기록을 목록에 포함할 뿐
전송을 허용하지 않습니다. Claude 대상은 PID, `claude:PID`, 모호하지 않은 Unicode 14.0.0 casefold 이름입니다. 충돌 시 PID를 지정하세요.
Codex 전송에는 전체 UUID가 필요하며 홈은 위의 선택 규칙을 따릅니다. `--codex-bin`으로 실행 파일을 고를 수 있습니다. 출력에는
`--json` 또는 `--output-format json|text`이 필요합니다.

### 다른 머신으로 SSH 전송

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'API 계약을 검토해 주세요.' --dry-run --json
```

원격 기본 명령은 PATH의 `session-peer`입니다. `--remote-bin` 절대 경로로 지원되는
Node를 선택하는 래퍼를 지정할 수 있습니다. TypeScript 표시와 정확한 버전을 확인하므로
다른 구현을 발견하면 거부합니다. BatchMode·StrictHostKeyChecking을 사용하며 새
호스트 키 승인, 원격 런타임 설치, Python 대체 실행은 하지 않습니다. 메시지는 원격
셸 인자가 아닌 JSON stdin 요청으로 전달합니다. 정방향 접속이 역방향 접속을 보장하지
않습니다. 0.2.1 이후 소스는 Tailscale을 경로 힌트로만 사용합니다. [회신](#회신)을 참고하세요.

Windows SSH 대상에는 `--remote-platform win32`를 명시하고, 원격 PATH에 없다면
`--remote-bin 'C:\절대\경로\session-peer.cmd'`를 지정하세요. 이미 인증된 OpenSSH
제어 소켓은 `--host`가 정확히 하나일 때 `--ssh-control-path /로컬/절대/소켓`으로 선택할 수 있습니다. 이는 호스트 키
검증을 우회하거나 새 로그인을 허용하지 않습니다. Windows 로컬 Codex 홈은
`C:\Users\...\.codex`처럼 전체 경로를 사용합니다. 기존 Python CLI는 자동 제거·교체하지 않습니다.

### 여러 호스트와 연결 옵션

0.2.1 이후 소스(미배포)는 반복 `--host`와 제한된 `--ssh-opt`를 받습니다.

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
- `--ssh-jump USER@HOST[:PORT]`(한 번, POSIX 클라이언트)는 모든 `--host`의 모든 `ssh`
  호출을 점프 호스트 하나를 거쳐 보냅니다. 사용자는 필수이고, IPv6는 괄호가 필요하며
  (`hop@[2001:db8::1]:22`), `%`, `$`, 따옴표, 공백 등 셸 문자는 거부합니다
  (`invalid_ssh_jump`). `-J` 대신 CLI가 고정된 `ProxyCommand`를 만듭니다. 점프 구간의
  `ssh`는 `BatchMode=yes`, `StrictHostKeyChecking=yes`, `UpdateHostKeys=no`,
  `ConnectTimeout=10`, `ConnectionAttempts=1`, `ProxyCommand=none`, `ProxyJump=none`,
  `ControlPath=none`, `ForwardAgent=no`, `ClearAllForwardings=yes`,
  `PermitLocalCommand=no`로 실행되고 `-W [대상]:포트`로 연결합니다. 바깥쪽 `ssh`에도
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

### 회신

`session-peer://v1/reply?...` URI를 `--to`로 사용할 수 있습니다. 알 수 없거나 중복된
필드, 위험한 호스트, 잘못된 인코딩, 명시적 경로와의 충돌은 거부합니다. peer 정보는
권한 근거가 아니며 Reply-To URI를 셸 명령으로 실행하지 않습니다. 받은 Reply-To는 읽는
사람을 위한 데이터일 뿐이고, 회신을 자동으로 관찰하거나 확인하지 않습니다.

0.2.1 이후 소스(미배포)는 발신자 정보와 자동 회신 경로를 추가합니다.

- **발신자.** Claude Code 안에서는 `CLAUDE_CODE_MESSAGING_SOCKET`이 등록된 살아 있는
  세션 정확히 하나와 일치해야 합니다. 그 세션의 고유하고 출력 가능한 이름(아니면 PID)이
  `From: claude:NAME`이 됩니다. Codex 안에서는 유효한 `CODEX_THREAD_ID`(또는
  `CODEX_SESSION_ID`)가 `From: codex:UUID`가 됩니다. 증거가 충돌하거나 중첩되거나
  유효하지 않으면 발신자를 정하지 않고, 이때는 회신 경로도 만들지 않습니다.
  `--no-from`은 From만 생략합니다.
- **자동 Reply-To.** 발신자가 있고 `--no-reply-to`가 없으면, 로컬 전송에는
  `transport=local` URI를 붙입니다. SSH 전송이나 `--reply-to`를 쓰면 `transport=ssh`
  URI를 붙이며, 호스트는 `--reply-to HOST`, `SESSION_PEER_REPLY_HOST`,
  `CC_PEER_REPLY_HOST`, 이 장비의 tailnet 이름·주소 순으로 정합니다. 사용자가 없는
  호스트에는 현재 사용자를 붙입니다. 호스트를 찾지 못하면 SSH 경로를 붙이지 않습니다.
  `--reply-address URI`는 기존처럼 명시적인 대안입니다. `--reply-to`,
  `--reply-address`, `--no-reply-to`는 함께 쓸 수 없습니다. 모든 URI는 `--to`와 같은
  파서로 검증합니다.
- **JSON.** `replyRoute`는 생성한 경로를 알려 줍니다. 로컬 경로는 `verified`
  (`same_machine_route`), SSH 경로는 `unverified`(`reverse_ssh_not_checked`)입니다.
  `--to`가 URI이면 `addressResolution`에 전송 방식을 기록하고, 로컬로 전달했다면
  `normalizedFrom: "ssh_self"`를 함께 기록합니다.
- **같은 장비.** SSH 회신 URI는 호스트에 현재 OS 사용자가 포함되고 이 장비를 가리키며
  (`localhost`, 루프백, 호스트 이름, Tailscale 자기 노드), `--host`나 SSH 옵션(`--ssh-jump` 포함)을 주지
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
  루프백 회신 호스트(`localhost`, `*.localhost`, 그리고 `127.1`, `2130706433`, `0x7f.1`,
  `[::ffff:127.0.0.1]`처럼 어떤 숫자 표기든 127.0.0.0/8, `0.0.0.0`, `::1`, `::` 주소이며, DNS
  없이 값으로 비교)는 대상이 자기 자신으로 읽으므로 SSH
  전에 거부합니다(`invalid_return_route`). 대상 자신의 이름은 사용자와 관계없이 `return_host_is_receiver`로
  실패하며 검증된 로컬 경로로 보고하지 않습니다. 원격 전송도 루프백 회신 호스트를
  알리지 않습니다(`invalid_reply_host`). 자동 실행이나 재시도는 하지 않으며, 정방향 접속이 된다고 이 점검을
  통과한 것으로 보지 않습니다. 이 CLI가 시작하는 다른 `ssh`와 마찬가지로, 점검과 그
  `ssh -G` 사용자 확인은 점검하는 장비에서 신뢰하는 SSH 설정(`ProxyCommand`, `Match exec`
  포함)을 사용합니다(위의 신뢰 경계 참고). 명령줄 허용 목록은 그 파일에 적용되지 않습니다.

## 성공의 의미

| 결과 | 의미 |
| --- | --- |
| `validated`, `submitted:false` | dry-run 검증 통과. 전송하지 않음 |
| `posted` / `queued` | inbox 쓰기 / queue 수락. **소비·ACK 확인 아님** |
| `refused`, `submitted:false` | 제출 전에 거부 |
| `unknown`, `submitted:null` | 제출됐을 수 있음. 자동 재전송 금지 |

제출 후 회신이 없거나 대상이 종료됐다는 사실만으로 소비나 실패를 확정할 수 없습니다. 자동 재전송하지 마세요.

`consumptionConfirmed`는 항상 false입니다. 실제 ACK는 수신 TUI에서 별도로 확인하며
queue 결과나 transcript 폴링으로 추정하지 않습니다. 종료 코드는 성공/오류/사용법에
0/1/2를 사용합니다. 오류는 고정 코드로 반환하며 원문 stderr·메시지를 노출하지 않습니다.
Codex는 실제 OS flock, 파일 식별자, 동일 사용자 소유 프로세스의 시작 시각을 여러 번
검사하고 제출 직전에 다시 검증합니다. 잠금을 삭제하거나 소유 프로세스에 신호를 보내지
않습니다. 탐색 결과의 이름·경로·ID는 공유 전에 익명화하세요.

## 개발·검증

```sh
npm ci --ignore-scripts
npm run build
node scripts/check-repository.mjs
SESSION_PEER_PYTHON_ROOT=/path/to/python-reference npm test
npm run test:package
npm audit
```

Python은 개발용 호환성 기준(v1.0.2 커밋
`47c23713d0a2a3c11ebde6186afd8c43489b8b65`)일 뿐 런타임 의존성이 아닙니다. POSIX 계약 테스트에는
C 컴파일러와 lsof도 필요합니다. CI는 세 OS에서 Node 22/24를 사용합니다.
macOS/Linux는 고정된 참조 기준으로 전체 계약·패키지 검사를 실행하고, Windows는
x64에서 빌드·타입 검사, 네이티브 Claude inbox·점유/해제된 잠금, writer 소유권·제출 직전 경합,
CLI 큐 결과, 격리된 가짜 SSH 대상의 실제 PowerShell/.cmd 프레이밍, 패키지 설치·네이티브 로드·삭제와 audit를 실행합니다.
이는 fixture 검사이며 Windows에서 POSIX/Python 참조 스위트를 실행한다는 뜻은 아닙니다.
Windows x64/Node 24 실기기 ACK는 별도의 일회성 증거입니다. 임시 SQLite·Unix inbox·실제 잠금 fixture와 [VALIDATION.md](../VALIDATION.md)의
실제 TUI 증거는 구분합니다. fixture 통과는 ACK가 아닙니다. 패키지 내용·반복 빌드 해시·
새 환경 설치·삭제도 검사합니다. 네이티브 의존성에는 설치 스크립트가 있지만 검증한 사전
빌드 경로는 `--ignore-scripts`를 사용합니다. SQLite 읽기 전용 접근도 WAL 공유 메모리
처리에 참여할 수 있으므로 스냅샷 읽기는 아닙니다.

[CONTRIBUTING.md](../CONTRIBUTING.md), [RELEASING.md](../RELEASING.md),
[SECURITY.md](../SECURITY.md)를 참고하세요. 이후 릴리스 발행에는 별도 승인이 필요하며
npm 자동 발행은 활성화하지 않았습니다. [MIT 라이선스](../LICENSE)입니다.

## npm 릴리스

0.2.0은 2026-09-28 KST에 공개·검증했습니다. [공개 기록](../VALIDATION.md#public-020--2026-09-28-kst)을
참고하고 설치 전 정확한 버전과 현재 태그를 확인하세요.

```sh
npm view session-peer@0.2.0 version dist.integrity
npm view session-peer dist-tags
```

0.1.0 tarball의 과거 문구 불일치와 검증은 [날짜별 기록](../VALIDATION.md#public-010--2026-09-27-kst)에 보존합니다.
발행은 OIDC staging과 별도 2FA 승인을 거칩니다. Staging 성공은 공개 발행이 아닙니다.
[RELEASING.md](../RELEASING.md)를 참고하세요.

## 관련 프로젝트

[Python session-peer](https://github.com/abruption/session-peer)는 독립적으로 유지·
발행합니다. 선택 기능과 설치법(예: `pipx install session-peer`)은 해당 저장소에서
안내합니다. 명령어가 같은 `session-peer`이므로 위 PATH 안내를 따르세요. 이 클라이언트는
Python 설치에 의존하지 않으며 전체 기능·플래그 호환성을 주장하지 않습니다.

### 0.2.0 읽기 전용 진단

```sh
session-peer doctor --json
session-peer doctor --agent codex --codex-home /absolute/home --json
session-peer doctor --host user@host --json
```

공개 npm 0.1.0에는 없는 소스 기능입니다. 진단 성공(`ok:true`, 종료 코드 0)과
에이전트 준비 상태(`ready`, 에이전트·홈별 결과)는 별개입니다. 정해진 메타데이터와
실행 파일 경로만 검사하며 Codex 실행, inbox 연결, writer 잠금 획득, 메시지 제출을
하지 않습니다. Windows inbox 준비 상태는 살아 있는 프로세스의 pipe 광고를 뜻하며
pipe 존재나 연결 가능성을 보증하지 않습니다. `capabilities`는 wake/wait/ACK와 소비
확인을 미지원으로 표시합니다. 선택적 TS 스킬 메타데이터 검사도 설치를 하지 않습니다.
[진단 경계](../PARITY.md#source-read-only-doctor--18--020)를 참고하세요. SSH 양쪽에 같은
소스 빌드가 필요합니다.
## 에이전트 스킬: 명시적 설치

별도 `session-peer-ts` 스킬은 동반 PR에서 관리되며 새 npm 또는 스킬 태그 발행이 아닙니다. 공개된 0.1.0 기본 기능을 지원하고 TypeScript 구현 표시와 도움말로 개발 기능을 확인합니다. Python `session-peer` 스킬은 별도로 유지합니다.

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

고정 버전 업데이트는 다른 정확한 커밋을 검토한 뒤 같은 에이전트·범위로 `add`를 반복합니다.
목록을 캐시하는 에이전트는 다시 시작하세요. 런타임과 스킬은 독립적으로 관리됩니다.
npm `--ignore-scripts`를 사용할 수 있고 postinstall은 Skills CLI를 호출하지 않습니다.
이 스킬 설치는 Python 스킬을 덮어쓰거나 런타임을 설치하지 않습니다.
[호환성과 검증](../PARITY.md#source-ts-skill-guidance--25--020)을 참고하세요.
