# session-peer (TypeScript)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

<!-- docs-contract: preview-candidate; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

실행 중인 **Claude Code·Codex 세션에 로컬 또는 SSH로 메시지를 전달**하는
TypeScript 클라이언트입니다. Python 없이 Node.js로 실행합니다.

**프리뷰 릴리스 후보이며 발행에는 별도 승인이 필요합니다.** 패키지명은
`session-peer`, CLI 명령어는 **`session-peer`**입니다. Relay 서버나 호스팅
서비스를 제공하는 프로젝트가 아닙니다.

## 주요 기능과 범위

- 로컬 세션과 명시적으로 선택한 Codex 홈 탐색
- `--dry-run`으로 대상을 검증한 뒤 네이티브 inbox 또는 queue에 메시지 1회 제출
- 원격에 명시적으로 설치한 같은 버전의 클라이언트로 SSH 전송
- 구조화된 Reply-To URI와 JSON 결과
- 모호한 대상·확인할 수 없는 소유권은 거부하고, 불확실한 제출은 자동 재시도하지 않음

Windows, Relay 전송, MCP, wake/resume, 비활성 세션 queue, Antigravity, 자동 업데이트,
암묵적인 전체 에이전트 탐색, 일반 텍스트 출력은 미지원입니다. 미지원 옵션은 명시적으로
거부하며 범용 오케스트레이터를 지향하지 않습니다.

## 요구사항

macOS/Linux와 Node **22.x의 22.13 이상 또는 24.x**가 필요합니다. Node 26은
미지원입니다. 네이티브 flock 의존성에 맞는 사전 빌드 바이너리(x64/arm64)가 필요하므로
순수 JavaScript 패키지는 아닙니다. Codex 전송에는 `codex`, `lsof`, `ps`와 저장된
스레드의 유일하고 안정적인 live writer가 필요합니다. Claude는 접근 가능한 inbox가
있는 실행 중 TUI가 필요합니다. SSH에는 OpenSSH, 기존 키·호스트 신뢰 설정과 원격의
**동일 버전 클라이언트**가 필요합니다.

## 설치

공식 npm 릴리스에서 소유권·출처가 확인되기 전에는 레지스트리의
`npm install -g session-peer`나 `npx session-peer`를 실행하지 마세요.
현재는 검토한 소스를 빌드하고, 필요할 때 로컬 tarball을 설치합니다.

```sh
git clone https://github.com/abruption/session-peer-ts.git
cd session-peer-ts
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
npm pack --ignore-scripts
# 선택 사항: PATH에서 사용할 구현을 명시적으로 선택한 뒤 전역 설치
npm install --global --ignore-scripts ./session-peer-0.1.0-preview.0.tgz
session-peer --version
```

예상 출력은 `session-peer 0.1.0-preview.0 (typescript)`입니다. 설치 명령의
`./...tgz`는 검증되지 않은 레지스트리 패키지가 아닌 로컬 산출물을 지정하므로 생략하지
마세요. 별도 승인된 npm 발행 이후에도 패키지명은 `session-peer`, 명령은
`session-peer`로 유지하며 해당 릴리스의 버전·dist-tag 안내를 따릅니다.

### 기존 설치본과 PATH

다른 구현도 `session-peer`를 설치할 수 있습니다. 전후에 `type -a session-peer`와
`command -v session-peer`로 확인하고 PATH에서 하나를 선택하거나
`node /절대/경로/dist/cli.js`처럼 명시적으로 실행하세요. 다른 설치 관리자의 파일을
`--force`로 덮어쓰지 마세요. Python 패키지·스킬·서비스는 자동 설치·삭제·설정하지
않습니다. npm 설치본 제거는 `npm uninstall --global session-peer`로 하고 PATH를
다시 확인하세요.

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
이름(대소문자 무시)입니다. Unicode 이름은 PID로 지정하세요. Codex에는 전체 UUID와
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
`47c23713d0a2a3c11ebde6186afd8c43489b8b65`)일 뿐 런타임 의존성이 아닙니다. 테스트에는
C 컴파일러와 lsof도 필요합니다. CI는 참조 커밋을 고정하고 macOS/Linux × Node 22/24를
검사합니다. 임시 SQLite·Unix inbox·실제 잠금 fixture와 [VALIDATION.md](VALIDATION.md)의
실제 TUI 증거는 구분합니다. fixture 통과는 ACK가 아닙니다. 패키지 내용·반복 빌드 해시·
새 환경 설치·삭제도 검사합니다. 네이티브 의존성에는 설치 스크립트가 있지만 검증한 사전
빌드 경로는 `--ignore-scripts`를 사용합니다. SQLite 읽기 전용 접근도 WAL 공유 메모리
처리에 참여할 수 있으므로 스냅샷 읽기는 아닙니다.

[CONTRIBUTING.md](CONTRIBUTING.md), [RELEASING.md](RELEASING.md),
[SECURITY.md](SECURITY.md)를 참고하세요. 발행에는 별도 승인이 필요하며 npm 자동
발행은 활성화하지 않았습니다. [MIT 라이선스](LICENSE)입니다.

## npm 발행 후 설치

공식 릴리스와 레지스트리 무결성·provenance 검증이 완료된 뒤에만 아래 정확한
프리뷰 버전을 설치하세요. 안정판 `latest` 채널이 아닙니다. 공개 전에는 위의
로컬 tarball 설치를 사용합니다.

```sh
npm install --global --ignore-scripts session-peer@0.1.0-preview.0
session-peer --version
```

수동 발행 워크플로우는 최초 1회만 단기 bootstrap 토큰을 사용합니다. 이후에는
Trusted Publisher OIDC로 staging하고 유지관리자가 2FA로 승인합니다.
staging 성공은 공개 완료가 아닙니다. [RELEASING.md](RELEASING.md)를 참고하세요.

## 관련 프로젝트

[Python session-peer](https://github.com/abruption/session-peer)는 독립적으로 유지·
발행합니다. 선택 기능과 설치법(예: `pipx install session-peer`)은 해당 저장소에서
안내합니다. 명령어가 같은 `session-peer`이므로 위 PATH 안내를 따르세요. 이 클라이언트는
Python 설치에 의존하지 않으며 전체 기능·플래그 호환성을 주장하지 않습니다.
