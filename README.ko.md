# session-peer (TypeScript)

[![npm 버전](https://img.shields.io/npm/v/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 주간 다운로드](https://img.shields.io/npm/dw/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 월간 다운로드](https://img.shields.io/npm/dm/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![CI](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml)
[![Node 지원](https://img.shields.io/node/v/session-peer?logo=node.js)](https://www.npmjs.com/package/session-peer)
[![MIT 라이선스](https://img.shields.io/npm/l/session-peer)](LICENSE)

<sub>npm 다운로드 통계는 패키지 공개보다 늦게 반영될 수 있습니다.</sub>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

실행 중인 **Claude Code·Codex 세션에 로컬 또는 SSH로 메시지를 전달**하는
TypeScript 클라이언트입니다. Python 없이 Node.js로 실행합니다.

**0.1.0 안정판이 npm에 공개됐습니다.** 패키지명은
`session-peer`, CLI 명령어는 **`session-peer`**입니다. Relay 서버나 호스팅
서비스를 제공하는 프로젝트가 아닙니다.

## 주요 기능과 범위

- 로컬 Claude/Codex 세션과 알려진 Codex 홈 탐색 (0.2.0 소스 개발 기능, 아래 참고)
- `--dry-run`으로 대상을 검증한 뒤 네이티브 inbox 또는 queue에 메시지 1회 제출
- 원격에 명시적으로 설치한 같은 버전의 클라이언트로 SSH 전송
- 구조화된 Reply-To URI와 JSON 결과
- 모호한 대상·확인할 수 없는 소유권은 거부하고, 불확실한 제출은 자동 재시도하지 않음

Relay 전송, MCP, wake/resume, Antigravity, 자동 업데이트,
일반 텍스트 출력은 미지원입니다. 미지원 옵션은 명시적으로
거부하며 범용 오케스트레이터를 지향하지 않습니다.

클라이언트 기능 계획은 [버전별 호환성 표와 npm 이주 가이드](PARITY.md)에서 추적하며, 계획은 현재 지원을 뜻하지 않습니다. Relay 서버·호스팅 서비스 제공은 이 클라이언트의 범위 밖입니다.

### 개발 소스의 통합 목록 (0.2.0)

소스 빌드 후 `node dist/cli.js list --json`은 Claude/Codex를 함께 조회하고,
`list --agent codex --json`은 알려진 홈을 조회합니다. 공개 npm **0.1.0**은 여전히
에이전트와 Codex 목록용 홈을 명시해야 하며, 위 시작 예제는 그 버전에도 유효합니다.

탐색 범위는 기본 `~/.codex`, `CODEX_HOME`, macOS Orca의 바로 아래 계정 홈,
JSON 배열 `SESSION_PEER_CODEX_HOMES`입니다. `--codex-home`은 Codex 목록을 해당 홈에
고정하고 다른 설정 오류를 우회하며, `--agent claude`는 Codex 탐색을 생략합니다.
동일 홈의 별칭은 합치지만 다른 홈의 동일 UUID는 보존합니다. 전송에는 각 행의
`codexHome`을 사용하세요. 선택적 홈 부재는 오류가 아니지만 명시된 홈의 부재·오류는
성공한 행을 보존하면서 종료 코드 1을 반환합니다. 목록은 writer를 선택하거나 전송하지 않습니다.
정렬·진단·`--all`·SSH는 [목록 계약](PARITY.md#source-unified-listing-contract--16--020)을 참고하세요.
개발 소스의 Codex 전송은 `--codex-home` 생략 시 유일하고 안정된 live writer 홈을
선택합니다. 명시한 홈도 모든 알려진 경쟁 홈을 검사합니다. 비활성 큐는 저장된 스레드와
모든 후보의 비활성 검증에 더해 `--codex-home HOME --allow-inactive-codex-home`이
필요하며 wake/resume을 수행하지 않습니다. Dry-run은 제출하지 않습니다.
JSON에는 정제된 `codexHomeResolution`과 네이티브 출력에 있을 때만 `queueId`가 추가되며,
둘 다 소비 확인은 아닙니다. [홈 선택 계약](PARITY.md#source-codex-home-selection--17--020)을 참고하세요.
공개 **0.1.0**은 여전히 명시적 live 홈이 필요하고 비활성 허용 옵션이 없습니다.
SSH 양쪽에는 동일한 개발 빌드를 사용하세요.

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
npm install --global --ignore-scripts session-peer@0.1.0
session-peer --version
```

예상 출력은 `session-peer 0.1.0 (typescript)`입니다.

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
npm install --global --ignore-scripts ./session-peer-0.1.0.tgz
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
npm install --prefix "$env:TEMP\session-peer-ts-source" --ignore-scripts .\session-peer-0.1.0.tgz
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
전송을 허용하지 않습니다. Claude 대상은 PID, `claude:PID`, 모호하지 않은 ASCII
이름(대소문자 무시)입니다. Unicode 이름은 PID로 지정하세요. 공개 0.1.0의 Codex 전송에는 전체 UUID와
명시적인 홈이 필요하며 `--codex-bin`으로 실행 파일을 고를 수 있습니다. 출력에는
`--json` 또는 `--output-format json`이 필요합니다.

### 다른 머신으로 SSH 전송

```sh
session-peer send --host user@machine --remote-bin /absolute/path/session-peer \
  --to CLAUDE_PID --message 'API 계약을 검토해 주세요.' --dry-run --json
```

원격 기본 명령은 PATH의 `session-peer`입니다. `--remote-bin` 절대 경로로 지원되는
Node를 선택하는 래퍼를 지정할 수 있습니다. TypeScript 표시와 정확한 버전을 확인하므로
다른 구현을 발견하면 거부합니다. BatchMode·StrictHostKeyChecking을 사용하며 새
호스트 키 승인, 원격 런타임 설치, Python 대체 실행은 하지 않습니다. 메시지는 원격
셸 인자가 아닌 JSON stdin 요청으로 전달합니다. 임의의 `--ssh-opt`, IPv6 리터럴,
Tailscale 정규 이름 보강은 미지원이므로 SSH 별칭·호스트명을 사용하세요. 정방향 접속이
역방향 접속을 보장하지 않습니다.

Windows SSH 대상에는 `--remote-platform win32`를 명시하고, 원격 PATH에 없다면
`--remote-bin 'C:\절대\경로\session-peer.cmd'`를 지정하세요. 이미 인증된 OpenSSH
제어 소켓은 `--ssh-control-path /로컬/절대/소켓`으로 선택할 수 있습니다. 이는 호스트 키
검증을 우회하거나 새 로그인을 허용하지 않습니다. Windows 로컬 Codex 홈은
`C:\Users\...\.codex`처럼 전체 경로를 사용합니다. 기존 Python CLI는 자동 제거·교체하지 않습니다.

### 회신

`session-peer://v1/reply?...` URI를 `--to`로 사용할 수 있습니다. 알 수 없거나 중복된
필드, 위험한 호스트, 잘못된 인코딩, 명시적 경로와의 충돌은 거부합니다.
`--reply-address URI`는 명시적인 회신 주소를 추가할 뿐 자동 추론·검증하지 않습니다.
새 회신 주소를 붙이지 않을 때는 `--no-reply-to`를 사용합니다. 유효한
CODEX_THREAD_ID/CODEX_SESSION_ID는 참고용 From 정보에 사용하고 `--no-from`으로
생략합니다. 모르는 발신자를 만들지 않으며 peer 정보는 권한 근거가 아닙니다. URI를
셸 명령으로 실행하지 않습니다.

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
Windows x64/Node 24 실기기 ACK는 별도의 일회성 증거입니다. 임시 SQLite·Unix inbox·실제 잠금 fixture와 [VALIDATION.md](VALIDATION.md)의
실제 TUI 증거는 구분합니다. fixture 통과는 ACK가 아닙니다. 패키지 내용·반복 빌드 해시·
새 환경 설치·삭제도 검사합니다. 네이티브 의존성에는 설치 스크립트가 있지만 검증한 사전
빌드 경로는 `--ignore-scripts`를 사용합니다. SQLite 읽기 전용 접근도 WAL 공유 메모리
처리에 참여할 수 있으므로 스냅샷 읽기는 아닙니다.

[CONTRIBUTING.md](CONTRIBUTING.md), [RELEASING.md](RELEASING.md),
[SECURITY.md](SECURITY.md)를 참고하세요. 이후 릴리스 발행에는 별도 승인이 필요하며
npm 자동 발행은 활성화하지 않았습니다. [MIT 라이선스](LICENSE)입니다.

## npm 릴리스

공개된 `session-peer@0.1.0`은 레지스트리 무결성·provenance 메타데이터·서명·
새 환경 설치와 제거 검증을 통과했습니다. `latest`는 `0.1.0`, `preview`는
`0.1.0-preview.1`을 가리킵니다. 버전 미지정 설치 전 현재 태그를 확인하세요.

```sh
npm view session-peer dist-tags
```

변경할 수 없는 npm 0.1.0 tarball에는 발행 전 README 문구가 남아 있습니다.
[날짜별 릴리스 기록](VALIDATION.md#public-010--2026-09-27-kst)에 이 불일치를 명시했으며,
현재 GitHub 문서에서 정정했습니다. 패키지 내부 문서는 이후 버전에서 반영됩니다.

수동 발행 워크플로우는 Trusted Publisher OIDC로 staging하고 유지관리자가 2FA로 승인합니다.
staging 성공은 공개 완료가 아닙니다. [RELEASING.md](RELEASING.md)를 참고하세요.

## 관련 프로젝트

[Python session-peer](https://github.com/abruption/session-peer)는 독립적으로 유지·
발행합니다. 선택 기능과 설치법(예: `pipx install session-peer`)은 해당 저장소에서
안내합니다. 명령어가 같은 `session-peer`이므로 위 PATH 안내를 따르세요. 이 클라이언트는
Python 설치에 의존하지 않으며 전체 기능·플래그 호환성을 주장하지 않습니다.
