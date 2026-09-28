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

**실행 중인 Claude Code·Codex 세션을 찾고 로컬 또는 SSH로 메시지를 전달합니다.**
Python 없이 Node.js로 실행하는 클라이언트입니다. 패키지와 명령 이름은 `session-peer`입니다.

## Demo

설치 후 세션을 조회하고, 선택한 정확한 PID로 `CLAUDE_PID`를 바꾸세요:

```sh
session-peer list --agent claude --json
session-peer send --to CLAUDE_PID --message 'API 계약을 검토하고 회신해 주세요.' --dry-run --json
```

`--dry-run`은 제출 없이 검증합니다. 실제 전달할 때는 같은 명령에서
`--dry-run`을 제거해 한 번 실행하세요. 확인이 필요하면 명시적인 회신을 요청하세요.
**`posted` / `queued`는 제출이며 소비·ACK 확인이 아닙니다.** `unknown`
(`submitted:null`), 회신 부재 또는 대상 종료를 이유로 자동 재시도하지 마세요.
`consumptionConfirmed`는 항상 false이며, 실제 회신은 수신 TUI에서 확인합니다.

## Quick Start

macOS/Linux/Windows, **Node 22.x의 22.13 이상 또는 24.x**, 플랫폼에 맞는
네이티브 사전 빌드 의존성(x64/arm64)이 필요합니다. Claude는 실행 중 TUI의 inbox,
Codex는 CLI와 검증 가능한 writer가 필요합니다(macOS/Linux는 `lsof`·`ps`도 필요).
SSH에는 기존 키·호스트 신뢰 설정과 양쪽의 **동일 버전 TypeScript 클라이언트**가
필요합니다. 플랫폼 요구사항과 명시적 비활성 큐 제출은 상세 가이드를 참고하세요.

### Install

[Python CLI](https://github.com/abruption/session-peer)도 같은 명령을 사용합니다.
설치 전 macOS/Linux는 `type -a session-peer`, PowerShell은
`Get-Command session-peer -All`로 PATH를 확인하세요. 사용할 구현을 선택하고
다른 설치 관리자의 파일을 `--force`로 덮어쓰지 마세요.

```sh
npm install --global --ignore-scripts session-peer@0.2.0
session-peer --version
```

예상 출력: `session-peer 0.2.0 (typescript)`. 격리 설치·소스 빌드·Windows·제거
방법은 아래 상세 가이드에서 확인할 수 있습니다.

### Update

npm으로 설치한 클라이언트는 npm으로 갱신합니다. 태그와 대상 버전을 검토한 뒤
정확한 버전을 설치하세요. 아래 예시는 이전 npm 설치본을 0.2.0으로 갱신합니다.
CLI 자체 업데이트 명령은 없습니다.

```sh
npm view session-peer dist-tags
npm install --global --ignore-scripts session-peer@0.2.0
session-peer --version
```

동반 스킬의 설치·업데이트는 별도입니다. npm 설치가 스킬을 설치하지 않습니다.
상세 가이드의 고정 커밋 기반 스킬 설치 안내를 확인하세요.

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

## Docs

- [사용자 가이드](docs/guide.ko.md) — CLI 옵션, 탐색, Codex 홈, SSH, 회신, 설치 변형과 스킬 설정.
- [API 참조(영문)](docs/api.md).
- [호환성·이주·기능 계획](PARITY.md).
- [릴리스 증거·플랫폼 검증](VALIDATION.md).
- [개발·기여 안내](CONTRIBUTING.md).
- [릴리스 절차](RELEASING.md).

## License

[MIT 라이선스](LICENSE)를 따릅니다.

## Support and security

사용 질문과 재현 가능한 버그는 [이슈](https://github.com/abruption/session-peer-ts/issues)로 알려 주세요.
취약점은 [비공개 신고](https://github.com/abruption/session-peer-ts/security/advisories/new) 또는
[support@abruption.dev](mailto:support@abruption.dev?subject=%5Bsession-peer-ts%5D%20Security)로 보내 주세요.
[SECURITY.md](SECURITY.md)를 확인하고 자격증명·메시지·개인 경로는 제거하세요.
