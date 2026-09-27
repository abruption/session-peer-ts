<!-- Use an English Conventional Commit title, e.g. fix(ssh): reject conflicting reply routes -->
## Summary

<!-- Explain the change and link related issues. Use Closes only for fully resolved issues. -->

## Type
- [ ] feat
- [ ] fix
- [ ] docs
- [ ] chore / refactor / test / perf

## Validation
- [ ] `npm ci --ignore-scripts` and `npm run build`
- [ ] `SESSION_PEER_PYTHON_ROOT=/path/to/pinned/reference npm test`
- [ ] `npm run test:package` and `npm audit`
- [ ] Latest CI `release gate` passes with an up-to-date base
- [ ] Behavior changes include relevant tests; refused/unknown/queued/ACK remain distinct
- [ ] README changes are synchronized in EN/KO/JA/zh-CN
- [ ] No credentials, real messages, session IDs, agent homes or local evidence in the diff

## Tested environments / limitations

<!-- Node, OS, architecture, agent versions; separate fixtures from authorized live ACK tests. -->

## Release impact

<!-- No automatic release/deployment. Call out native dependency, schema or compatibility changes. -->
