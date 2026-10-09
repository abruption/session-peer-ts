<div align="center">

# session-peer (TypeScript)

[![npm 버전](https://img.shields.io/npm/v/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 주간 다운로드](https://img.shields.io/npm/dw/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![npm 월간 다운로드](https://img.shields.io/npm/dm/session-peer?logo=npm)](https://www.npmjs.com/package/session-peer)
[![CI](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/abruption/session-peer-ts/actions/workflows/ci.yml)
[![Node 지원](https://img.shields.io/node/v/session-peer?logo=node.js)](https://www.npmjs.com/package/session-peer)
[![MIT 라이선스](https://img.shields.io/npm/l/session-peer)](LICENSE)

<sub>npm 다운로드 통계는 패키지 공개 후에도 반영이 늦을 수 있습니다.</sub>

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

**실행 중인 Claude Code와 Codex 세션을 찾아 로컬 또는 SSH(보안 원격 접속)로 메시지를 전달합니다.**
Python을 설치하지 않아도 Node.js에서 실행되는 TypeScript 클라이언트입니다. 패키지명과 CLI 명령은 모두 `session-peer`입니다.

</div>

<!-- docs-contract: stable-release-source; package=session-peer; bin=session-peer; node=22.13+/24; python-reference=1.0.2 -->

**문서·소스 기준 버전: 0.3.3.** 2026-10-09 KST 준비 시점에는 0.3.3이 미발행이었고 공개 npm `latest`는 **0.3.2**, `preview`는 `0.1.0-preview.1`이었습니다. 아래 0.3.3 npm 예시를 사용하기 전에 레지스트리에서 현재 제공 여부를 확인하세요. 제공되지 않으면 검토한 소스 체크아웃이나 로컬 빌드 산출물을 사용하세요. 빌드와 SSH 양쪽은 같은 검토 버전이 필요하며, 0.3.2와 0.3.3은 서로의 SSH 사전 확인을 거부합니다.

<a id="demo"></a>
## 시연

![TypeScript session-peer 0.2.1로 Codex에서 Claude Code에 보낸 실제 요청과 회신](https://raw.githubusercontent.com/abruption/session-peer-ts/main/docs/assets/session-peer-ts-v0.2.1-roundtrip.gif)

npm 0.2.1을 사용해 실제 로컬 요청을 보내고 명시적인 `ACK DEMO-READY` 회신을 받았습니다. 명령줄 도구(CLI)와 메시지 일부를 다시 구성했으며, 식별자는 가리고 시점 정보는 편집했습니다. 화면 녹화는 아닙니다. 메시지를 제출한 것만으로는 ACK(수신 확인 응답)가 아닙니다.

설치한 뒤 세션을 조회하고, `CLAUDE_PID`를 선택한 세션의 정확한 PID(프로세스 ID)로 바꾸세요.

```sh
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'Please review the API contract and reply.' --dry-run --json
```

`--dry-run`은 메시지를 보내지 않고 요청만 검증합니다. 실제로 전달할 때는 같은
명령에서 `--dry-run`을 빼고 한 번 실행하세요. 수신 확인이 필요하면 메시지에
명시적인 회신을 요청하세요. **`posted` / `queued`는 제출 또는 큐 수락을 뜻할
뿐, 수신 측의 소비(읽기·처리)나 ACK를 확인한 결과가 아닙니다.** `unknown`
(`submitted:null`)은 제출 여부가 불확실하므로 자동 재시도하지 마세요. 회신이
없거나 대상 세션이 종료된 경우에도 자동 재시도하지 마세요. `consumptionConfirmed`는
항상 `false`이며, 실제 회신은 수신 측 TUI(터미널 사용자 인터페이스)에서 직접 확인하세요.

<a id="quick-start"></a>
## 빠른 시작

macOS, Linux, Windows와 **Node 22.x의 22.13 이상 또는 24.x**가 필요합니다.
운영체제와 아키텍처(x64/arm64)에 맞는 네이티브 사전 빌드 의존성도 필요합니다.
Claude Code에는 실행 중인 TUI의 받은 메시지함이, Codex에는 CLI와 메시지를 기록하는
안정된 writer 프로세스가 필요합니다(macOS/Linux에서는 `lsof`와 `ps`도 필요합니다).
SSH를 사용하려면 기존 키와 호스트 신뢰 설정이 있어야 하며, 양쪽에서 **같은 버전의
TypeScript 클라이언트**를 사용해야 합니다. 운영체제별 요구사항은
[사용자 가이드](docs/guide.ko.md#요구사항)를, 비활성 Codex 세션에 메시지를 대기열로
보내는 조건은 [통합 목록 설명](docs/guide.ko.md#unified-listing-in-020)을 참고하세요.

<a id="install"></a>
### 설치

[Python CLI](https://github.com/abruption/session-peer)도 별도로 구현·배포되지만,
`session-peer`라는 같은 명령 이름을 사용합니다. 설치 전에 macOS/Linux에서는 `type -a session-peer`,
PowerShell에서는 `Get-Command session-peer -All`로 PATH(명령 검색 경로)에서 어떤
실행 파일을 찾는지 확인하세요. 사용할 구현을 선택하고 다른 패키지 관리자가 설치한
파일을 `--force`로 덮어쓰지 마세요. 설치와 갱신은 사용자가 npm으로 직접 수행합니다.

**0.3.3 설치:** npm 설치·업데이트 예시를 실행하기 전에 레지스트리 제공 여부와 선택한 릴리스를 확인하세요. 해당 버전이 제공되지 않으면 [검토한 소스 빌드](docs/guide.ko.md#소스에서-빌드)를 사용하세요.

```sh
npm view session-peer@0.3.3 version dist.integrity
npm install --global --ignore-scripts session-peer@0.3.3
session-peer --version
```

예상 결과는 `session-peer 0.3.3 (typescript)`입니다. 별도 경로에 설치하거나,
소스에서 빌드하거나, Windows에서 설치·제거하는 방법은 [사용자 가이드](docs/guide.ko.md#설치)를 참고하세요.

선택 사항인 `sp` 단축 명령은 0.3.0 이상에 포함되며(0.2.1 이하에는 없음) 자동으로
활성화되지 않습니다. [직접 활성화하고 이름 충돌을 확인하는 방법(영문)](docs/shorthand.md)을
참고하세요.

<a id="update"></a>
### 업데이트

npm으로 설치한 클라이언트는 사용자가 직접 npm으로 업데이트합니다. 사용 가능한 배포 태그
(dist-tag)와 대상 버전을 확인한 뒤 해당 버전을 지정해 설치하세요. 아래 예시는 승인·발행 이후 이전 npm 설치본을 0.3.3으로
업데이트합니다. `session-peer` CLI는 업데이트를 설치하지 않습니다. `session-peer
update --check`는 새 버전이 있는지 확인할 뿐입니다.

```sh
npm view session-peer dist-tags
npm install --global --ignore-scripts session-peer@0.3.3
session-peer --version
```

함께 제공되는 스킬은 별도로 설치하고 업데이트해야 합니다. npm 패키지를 설치해도
스킬은 설치되지 않습니다. 고정 커밋을 기준으로 스킬을 설치하는 방법은 사용자
가이드에서 확인하세요.

<!-- Preserve links to the former detailed sections; their contents are in the guide. -->
<a id="주요-기능과-범위"></a>
<a id="020-통합-목록"></a>
<a id="020-cli-사용성"></a>
<a id="요구사항"></a>
<a id="설치"></a>
<a id="소스에서-빌드"></a>
<a id="기존-설치본과-path"></a>
<a id="사용법"></a>
<a id="다른-머신으로-ssh-전송"></a>
<a id="회신"></a>
<a id="성공의-의미"></a>
<a id="개발검증"></a>
<a id="npm-릴리스"></a>
<a id="관련-프로젝트"></a>
<a id="020-읽기-전용-진단"></a>
<a id="에이전트-스킬-명시적-설치"></a>

<a id="docs"></a>
## 문서

- [사용자 가이드](docs/guide.ko.md) — CLI 옵션, 탐색, Codex 홈, SSH, 회신, 여러 설치 방법과 스킬 설정.
- [API 참조(영문)](docs/api.md).
- [호환성·마이그레이션·계획된 기능](PARITY.md).
- [릴리스 검증 기록·플랫폼 검증](VALIDATION.md).
- [개발·기여 안내](CONTRIBUTING.md).
- [릴리스 절차](RELEASING.md).

<a id="license"></a>
## 라이선스

[MIT 라이선스](LICENSE)로 배포합니다.

<a id="support-and-security"></a>
## 지원 및 보안

사용법에 관한 질문과 재현 가능한 버그는 [이슈](https://github.com/abruption/session-peer-ts/issues)에
등록해 주세요. 보안 취약점은 [비공개 신고](https://github.com/abruption/session-peer-ts/security/advisories/new)
또는 [support@abruption.dev](mailto:support@abruption.dev?subject=%5Bsession-peer-ts%5D%20Security)로
알려 주세요. [SECURITY.md](SECURITY.md)를 읽고, 신고할 때 자격 증명·메시지·개인 경로를
가려 주세요.
