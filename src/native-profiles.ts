// Exact native Codex observation profiles. One row is one independently
// verified (host OS, host arch, native version, source commit, artifact) tuple.
// Lookup is by exact `${process.platform}-${process.arch}` and exact version:
// there is no SemVer range, no libc/arch fallback and no cross-platform
// inheritance. A schema, matching version, ordinary queue result or fixture on
// another platform never adds a row. A Linux row additionally requires the
// original writer's executable and retained kernel identity (see #130); none
// is selectable yet.
export type NativeProfile = Readonly<{
  platform: string; version: string; commit: string;
  // initialize.platformOs reported by the queue process (std::env::consts::OS).
  platformOs: 'macos' | 'linux';
  // How the owned app-server PID's opened SQLite descriptors are inspected.
  storageBinding: 'darwin_lsof' | 'linux_procfs';
  // Writer owner evidence required in addition to the lsof/ps generation.
  ownerInspection: 'lsof_ps' | 'lsof_ps_procfs_locks';
  // Whether an SSH destination request may select this row. Darwin keeps the
  // existing 0.4.0 destination behaviour; Linux rows have no SSH-remote
  // observation evidence and stay fail-closed for wire requests.
  sshDestination: boolean;
  // Exact extracted native executable. Historical Darwin rows predate artifact
  // pinning; every newly added row must pin its executable bytes.
  artifact: Readonly<{ target: string; sha256: string }> | null;
}>;
export type NativeProfileQuery = Readonly<{ platform: string; version: string }>;
export type NativeProfileRefusal = 'version_unsupported' | 'platform_unsupported';
const kinds = {
  darwin: { platformOs: 'macos', storageBinding: 'darwin_lsof', ownerInspection: 'lsof_ps', targets: { arm64: 'aarch64-apple-darwin' } },
  linux: { platformOs: 'linux', storageBinding: 'linux_procfs', ownerInspection: 'lsof_ps_procfs_locks',
    targets: { arm64: 'aarch64-unknown-linux-musl', x64: 'x86_64-unknown-linux-musl' } },
} as const;
const historical = new Set(['darwin-arm64/0.160.1', 'darwin-arm64/0.162.1']);
// Validates the whole table, including test-supplied synthetic tables, so a
// malformed or ambiguous row cannot be selected by a looser comparison.
export function validateNativeProfiles(table: readonly NativeProfile[]): readonly NativeProfile[] {
  const keys = new Set<string>();
  for (const row of table) {
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join() !==
        'artifact,commit,ownerInspection,platform,platformOs,sshDestination,storageBinding,version') throw new Error('invalid native profile');
    const [os, arch, extra] = row.platform.split('-'), kind = kinds[os as keyof typeof kinds];
    const target = kind?.targets[arch as keyof typeof kind.targets] as string | undefined;
    if (!kind || !target || extra !== undefined || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(row.version) ||
        !/^[0-9a-f]{40}$/.test(row.commit) || row.platformOs !== kind.platformOs || row.storageBinding !== kind.storageBinding ||
        row.ownerInspection !== kind.ownerInspection || typeof row.sshDestination !== 'boolean' ||
        (os === 'linux' && row.sshDestination)) throw new Error('invalid native profile');
    const key = row.platform + '/' + row.version;
    if (keys.has(key)) throw new Error('ambiguous native profile'); keys.add(key);
    if (row.artifact === null ? !historical.has(key) : Object.keys(row.artifact).sort().join() !== 'sha256,target' ||
        row.artifact.target !== target || !/^[0-9a-f]{64}$/.test(row.artifact.sha256)) throw new Error('invalid native artifact');
  }
  return Object.freeze(table.map(row => Object.freeze({ ...row, artifact: row.artifact && Object.freeze({ ...row.artifact }) })));
}
export const NATIVE_PROFILES: readonly NativeProfile[] = validateNativeProfiles([
  { platform: 'darwin-arm64', version: '0.160.1', commit: 'd27764b82f7118f674371e6d6e76271d9d606edb',
    platformOs: 'macos', storageBinding: 'darwin_lsof', ownerInspection: 'lsof_ps', sshDestination: true, artifact: null },
  { platform: 'darwin-arm64', version: '0.162.1', commit: '092d3acd6bec3e3a14bdc7e7a2810ab628ab759d',
    platformOs: 'macos', storageBinding: 'darwin_lsof', ownerInspection: 'lsof_ps', sshDestination: true, artifact: null },
]);
// Recorded but NOT selectable. Linux arm64 test host, 2026-10-20: upstream
// rust-v0.162.1 musl artifact digest, Linux-generated schema/opt-out evidence
// and one dedicated-thread client-ID injection (linux-observation-native-
// evidence.json). Activation is withheld until the original TUI writer's
// executable is bound to this artifact and the writer's kernel identity is
// retained across send and independent wait (PARITY.md follow-up design).
export const CANDIDATE_PROFILES: readonly NativeProfile[] = validateNativeProfiles([
  { platform: 'linux-arm64', version: '0.162.1', commit: '092d3acd6bec3e3a14bdc7e7a2810ab628ab759d',
    platformOs: 'linux', storageBinding: 'linux_procfs', ownerInspection: 'lsof_ps_procfs_locks', sshDestination: false,
    artifact: { target: 'aarch64-unknown-linux-musl', sha256: '071cbe8d821cf1b02b6d8ba6c8b7991b228fcb8519dcb68a37d31222bb8cabe5' } },
]);
export const currentPlatform = () => `${process.platform}-${process.arch}`;
export function selectNativeProfile(query: NativeProfileQuery, table: readonly NativeProfile[] = NATIVE_PROFILES): NativeProfile | undefined {
  if (!query || typeof query.platform !== 'string' || typeof query.version !== 'string') return undefined;
  return table.find(row => row.platform === query.platform && row.version === query.version);
}
// Version absence is reported before platform absence; neither is downgraded
// to a nearby row. An exact version on another platform is still unsupported.
export function nativeProfileRefusal(query: NativeProfileQuery, table: readonly NativeProfile[] = NATIVE_PROFILES): NativeProfileRefusal | undefined {
  if (selectNativeProfile(query, table)) return undefined;
  return table.some(row => row.version === query?.version) ? 'platform_unsupported' : 'version_unsupported';
}
export const platformProfiled = (platform: string, table: readonly NativeProfile[] = NATIVE_PROFILES) =>
  table.some(row => row.platform === platform);
