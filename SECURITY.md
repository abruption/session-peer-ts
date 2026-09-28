# Security policy

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/abruption/session-peer-ts/security/advisories/new),
not public issues, PRs or comments. Alternatively email
[support@abruption.dev](mailto:support@abruption.dev?subject=%5Bsession-peer-ts%5D%20Security)
with `[session-peer-ts] Security`. Email is private contact, not an end-to-end
encrypted submission mechanism. Start with a redacted description only.

Include commit/version, install method, OS, architecture, Node and native agent
versions on each endpoint, affected command, attacker access, impact and a minimal
reproduction using dummy sessions/paths/messages. Remove credentials, tokens,
keys, message content, session IDs and personal hosts/paths. Do not attach agent
homes, SQLite DBs, transcripts, browser profiles or .env files. Rotate exposed
secrets with their provider; deleting a comment does not revoke a secret.

Review is manual and best-effort, with no response or fix deadline. The project is
a published npm client, with 0.2.0 release evidence in [VALIDATION.md](VALIDATION.md#public-020--2026-09-28-kst).
Reports on published versions and source commits are welcome; no maintenance
window or backport promise exists. English and Korean reports are welcome. Disclosure
is coordinated with the reporter; private reports are not automatically public.
