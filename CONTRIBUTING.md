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

Python reference commit: `47c23713d0a2a3c11ebde6186afd8c43489b8b65`.
CI checks it out separately. Python is a development oracle, never a runtime
fallback. Match Node 22/24, macOS/Linux and the native dependency requirements.
Keep `package-lock.json` tracked. Do not commit dist, node_modules, local
worktrees, credentials, agent state, transcripts or real test evidence.

## Safety and documentation

Preserve actual flock/owner evidence, ambiguity rejection, pre-submit revalidation,
SSH input/host boundaries and no retry after unknown outcomes. Never infer ACK
from queueing. Fixtures are not real-agent evidence. Live tests require explicit
authorization, dedicated targets and independent observation; CI never uses live
accounts, sessions or credentials. Security reports use SECURITY.md.

Synchronize README.md, README.ko.md, README.ja.md and README.zh-CN.md. Keep runtime
version/support status and install examples consistent. Product/source changes
do not authorize npm publication, production deployment or service restarts.
Dependabot automatic update PRs are not enabled; dependency changes are manual
reviewed PRs with lockfile, audit, native-load and platform tests.
