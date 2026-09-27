# Releasing session-peer-ts

No publishing workflow or npm Trusted Publisher has been configured. The package
is private and unpublished. This runbook defines future gates, not publication
approval. Python session-peer and its Relay release train remain separate.

1. Use a `release/<version>` PR. Record the supported Node/OS/architecture matrix,
   limitations, changelog and four-language README updates. Match package.json,
   package-lock.json and the CLI version. Keep runtime changes out of a version-only
   promotion. Publication requires a separately reviewed removal of `private:true`.
2. Require the PR's latest `release gate`, merge through protected main, then
   require main CI for the exact merged commit. Do not bypass protection.
3. Build from that clean commit. Inspect the tarball allowlist (no credentials,
   agent state or evidence), reproduce the artifact, record SHA-256, and test
   install, native flock load, CLI smoke and uninstall on each supported platform.
   Validate authorized local/SSH native ACK evidence separately from CI fixtures.
4. Confirm npm package ownership/name availability, GitHub/npm Trusted Publisher
   mapping, supported OIDC publishing flow and provenance before adding a publish
   workflow. Do not store long-lived npm tokens in files or Actions secrets.
   No install hook may silently download Python, skills or configure services.
5. Create a draft release targeting the exact reviewed commit. A draft, merged
   preparation PR or green CI does not authorize publication. Obtain explicit
   final approval before publishing any tag/release/npm artifact. Preview releases
   use a prerelease version and an explicit non-latest npm dist-tag.
6. Once approved, publish the fixed verified artifact and verify registry integrity,
   provenance, version, dist-tag, clean install and uninstall. Never move a published
   tag or reuse an npm version; an uncertain/partial publish stops promotion.
   Preserve evidence and fix forward with a reviewed new version, never modified
   artifact retries. Global/fleet installation is a separate operational decision.

Until these gates are implemented and approved, use source builds or a locally
packed tarball. The `release gate` CI job is a validation aggregate, not a release.
