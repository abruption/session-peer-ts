The current-version inventory is `scripts/current-version-fields.json`. Package metadata is the source: `package.json.version` selects the version; both root version fields in `package-lock.json` must already agree. The updater does not change package metadata or decide which release is approved.

Run `npm run version:check` to check for drift without writes, or `npm run version:update` after updating package metadata through the usual npm workflow. Both commands accept no destination paths. `scripts/check-repository.mjs` also runs the same non-mutating check in CI; its existing metadata, language, link and anchor checks remain in force.

Each inventory entry has exactly `file` and `templates`. Each template has exactly `line` and a positive `occurrences` count:

```json
{
  "file": "src/protocol.ts",
  "templates": [
    { "line": "export const VERSION = '{{version}}';", "occurrences": 1 }
  ]
}
```

A template describes one complete, authored line. Only `{{version}}` spans vary; every other character remains literal, including translated text and unrelated versions on that line. Multiple placeholders on the same line select multiple current-version spans. Repeated identical lines require their exact count. Missing, extra or overlapping matches fail before any file is written. When editing an inventoried line, update its template in the same change. Review every newly selected span; adding a version to a document does not automatically make it current.

The closed file set is the runtime `VERSION` declaration, four READMEs, four guides, the API reference, the shorthand reference and PARITY. The inventory explicitly selects the current source descriptions, current installation/update commands, tarball filenames, expected banners and SSH version examples within those documents. PARITY's current summary is selected separately from its dated records. The runtime declaration is the only managed slot in `src/protocol.ts`. Every managed file must appear exactly once in the inventory; the updater rejects unknown paths and symlinks, including parent directory symlinks. It validates the complete plan before writing. A subsequent filesystem write failure can still leave a partial update; rerun the check to inspect the result.

The inventory classification is explicit rather than inferred from every
version-looking string. At baseline source `90481b148584926ea328ed956327f3050d9be9cb`
there were 131 occurrences of 0.5.1 across 14 Markdown files; that audit count
includes evidence and policy and is not an update list. This inventory selects
105 current lines (115 version spans) across 11 Markdown files plus protocol.ts:

| Area | Update rule |
| --- | --- |
| Four READMEs and four guides | Current source display, install/update examples, banners and selected SSH version examples only |
| API and shorthand references | Current package/source examples only; native protocol/feature introduction versions remain literal |
| PARITY | Only `Current source/package version: **{{version}}**.`; dated comparison sources and release evidence stay fixed |
| Runtime protocol | Only the exact exported VERSION declaration |
| VALIDATION, RELEASING and skill compatibility design | Manually reviewed dated evidence, publication policy and finite compatibility history; never generated |
| SECURITY | Manually reviewed reporting/support policy, not a package-version display (no 0.5.1 literal at that baseline) |
| Native/Python/skill pins and fixtures | Independent immutable contracts, not current package metadata |

Some owned lines describe source capabilities as well as a version. Updating
the number does not revalidate the capability: reviewers must inspect those
claims whenever behavior changes. The updater intentionally preserves every
other authored character; it cannot decide whether a feature remains supported.

Everything outside these explicit spans remains authored content. In particular, dated preparation/publication evidence in PARITY and VALIDATION, historical release descriptions and anchors, source hashes, release policy, finite skill compatibility rows, independent skill/native/Python versions and pin files are not generated. A version update does not approve new compatibility, qualification, publication or installation pins. Current prose that describes a capability must still be reviewed when behavior changes.

`test/current-version.test.ts` exercises the real inventory against isolated copies: read-only checks, a synthetic next patch, byte-idempotence, preserved historical records and independent pins, malformed/overlapping slots, unknown paths, symlinks and validation before writes. Build and package acceptance also require a separate isolated synthetic-version run: update package and lock metadata in the copied tree, run the updater and repository checker, build, then run `npm run test:package`. Keep production release policies and finite compatibility tables unchanged in that experiment. Record the commands actually run and their results in the change's validation evidence; unit fixtures alone are not evidence of a successful synthetic build or package smoke.
