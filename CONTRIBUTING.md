# Contributing

This repository follows the PR-based workflow of
[session-peer](https://github.com/abruption/session-peer), adapted for Node.

## Branches and commits

- `main` is the integration branch. All changes go through a short-lived branch
  and PR: `feat/<issue>-topic`, `fix/<issue>-topic`, `docs/topic`,
  `chore/topic`, or `release/<version>` for release preparation.
- No permanent develop branch. Create `release/X.Y.x` maintenance branches only
  when a supported backport line is explicitly approved; do not copy Python's
  `release/0.9.x` or merge it into this repository.
- New local worktrees belong under `.worktree/`. Preserve unrelated dirty work.
- English Conventional Commit titles: `feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`, `perf:`, `ci:`, `build:` or `revert:` (optional scope).
- Prefer squash merge with a Conventional Commit PR title. Rebase merge is
  allowed only for a clean conventional history. Protected main requires linear
  history, so do not create merge commits on main. Never force-push or delete main.
- Update the PR branch against main, rerun checks and resolve discussions before
  merging. Main requires the latest aggregate `release gate`. A green old SHA is
  not sufficient. Reviews are encouraged; the reference repo requires a PR but
  zero mandatory approving reviews, which is retained here for solo maintenance.
- Remote branches are cleaned manually after verifying merge and preserving any
  unmerged work; automatic branch deletion remains off, matching the reference.

## Local verification

```sh
npm ci --ignore-scripts
npm run build
node scripts/check-repository.mjs
SESSION_PEER_PYTHON_ROOT=/path/to/python-v1.0.2 npm test
npm run test:package
npm audit
```

Tests live in `test/*.ts`. `npm test` builds declarations, runs strict test
type-checking, then executes the tests with Node's type-stripping flag (including
on Node 22.13). Release/repository automation remains JavaScript.
`npm run test:package` checks that the packed declarations resolve from a
separate TypeScript consumer. The package root exposes only pure protocol helpers
(`VERSION`, `VERSION_LINE`, `reply`, `envelope`); importing it does not run the CLI.
The npm TypeScript indicator requires publishing these declarations in a new
version; it does not retroactively alter `0.1.0-preview.0`.

Python reference commit: `47c23713d0a2a3c11ebde6186afd8c43489b8b65`.
CI checks it out separately. Python is a development oracle, never a runtime
fallback. Match Node 22/24, macOS/Linux and the native dependency requirements.
Windows CI separately runs `npm run test:windows` and `npm run test:package`
on x64 Node 22/24. The Windows fixture compiles with the runner's .NET Framework
C# compiler and uses real locks/processes plus an isolated fake SSH endpoint
that invokes actual PowerShell; no live sessions or network destinations.
Keep `package-lock.json` tracked. Do not commit dist, node_modules, local
worktrees, credentials, agent state, transcripts or real test evidence.

## Safety and documentation

Preserve actual flock/owner evidence, ambiguity rejection, pre-submit revalidation,
SSH input/host boundaries and no retry after unknown outcomes. Never infer ACK
from queueing. Fixtures are not real-agent evidence. Live tests require explicit
authorization, dedicated targets and independent observation; CI never uses live
accounts, sessions or credentials. Security reports use SECURITY.md.
CodeQL default setup scans JavaScript/TypeScript and GitHub Actions; triage each
code-scanning alert with a fix PR or a documented dismissal reason.

Synchronize README.md, README.ko.md, README.ja.md and README.zh-CN.md. Update PARITY.md with feature/command/env/output changes, source baseline,
transport limits, evidence date and the relevant issue acceptance tests. Keep runtime
version/support status and install examples consistent. Product/source changes
do not authorize npm publication, production deployment or service restarts.
CI exercises release packaging without publishing. The manual publishing
workflow has separate confirmation and environment-approval gates; see
RELEASING.md before dispatching it. Never add publish credentials to PR tests.
Dependabot automatic update PRs are not enabled; dependency changes are manual
reviewed PRs with lockfile, audit, native-load and platform tests.
Dependabot vulnerability alerts are enabled, and `.github/workflows/audit.yml`
runs `npm audit` and `npm audit signatures` weekly (and on manual dispatch) so
new advisories surface between commits. Triage an alert with a manual PR.
