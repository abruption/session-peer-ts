// Darwin/Linux-local fixtures for scripts/deployment-harness.mjs (#23). They
// exercise the harness state machine on private temp prefixes with a tree
// assembled from this checkout and a local ssh stand-in. They are not
// destination evidence: no OpenSSH, no remote account and no published tarball.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Out = Record<string, any>;
const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, 'scripts/deployment-harness.mjs');
const skip = process.platform === 'win32' ? 'POSIX harness; the Windows procedure is documented in the ADR' : false;
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const lockIntegrity = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')).packages;
const packageVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version as string;

function h(args: string[], env: NodeJS.ProcessEnv = process.env, cwd?: string): { code: number | null; out: Out } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60000, env, cwd });
  return { code: result.status, out: result.stdout.trim() ? JSON.parse(result.stdout) : { stderr: result.stderr } };
}
function ok(args: string[]) { const r = h(args); assert.equal(r.out.ok, true, JSON.stringify(r.out)); assert.equal(r.code, 0); return r.out; }
function refused(args: string[], error: string) { const r = h(args); assert.equal(r.out.error, error, JSON.stringify(r.out)); assert.equal(r.code, 1); return r.out; }

function world(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(process.env.TASK_TEMP ?? tmpdir(), 'codex-deploy-harness-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const prefix = join(base, 'prefix'), opDir = join(base, 'operator'), journal = join(opDir, 'journal.jsonl');
  const tree = join(base, 'tree'), home = join(base, 'remote-home'), bin = join(base, 'bin');
  for (const dir of [opDir, home, bin]) mkdirSync(dir, { mode: 0o700 });
  mkdirSync(join(tree, 'node_modules/session-peer'), { recursive: true });
  cpSync(join(repo, 'dist'), join(tree, 'node_modules/session-peer/dist'), { recursive: true });
  cpSync(join(repo, 'package.json'), join(tree, 'node_modules/session-peer/package.json'));
  for (const name of ['fs-ext-extra-prebuilt', 'nan', 'smol-toml']) cpSync(join(repo, 'node_modules', name), join(tree, 'node_modules', name), { recursive: true });
  // Launch tracer: every execution of an installed launcher appends a line.
  const launchLog = join(base, 'launches.log');
  renameSync(join(tree, 'node_modules/session-peer/dist/cli.js'), join(tree, 'node_modules/session-peer/dist/cli-real.js'));
  writeFileSync(join(tree, 'node_modules/session-peer/dist/cli.js'),
    `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(launchLog)}, 'launch\\n');\nawait import('./cli-real.js');\n`);
  const launches = () => existsSync(launchLog) ? readFileSync(launchLog, 'utf8').split('\n').filter(Boolean).length : 0;
  const integrity = join(base, 'lock-integrity.json');
  writeFileSync(integrity, JSON.stringify(Object.fromEntries(['fs-ext-extra-prebuilt', 'nan', 'smol-toml']
    .map(name => [name, lockIntegrity[`node_modules/${name}`].integrity]))));
  // Local ssh stand-in: drops options and runs the remote command with an
  // isolated HOME, so discovery never reads this account's agent state.
  const remoteEnv = { PATH: '/usr/bin:/bin', HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: '', SESSION_PEER_CODEX_HOMES: '[]', SESSION_PEER_TAILSCALE: 'off' };
  writeFileSync(join(bin, 'ssh'), `#!${process.execPath}\nconst a=process.argv.slice(2);if(a.includes('-G')){console.log('user fixture-user');process.exit(0);}` +
    `let input='';try{input=require('node:fs').readFileSync(0);}catch{}const r=require('node:child_process').spawnSync('/bin/sh',['-c',a.at(-1)],{input,env:${JSON.stringify(remoteEnv)}});` +
    'process.stdout.write(r.stdout);process.exit(r.status??1);', { mode: 0o700 });
  ok(['dest', 'init-prefix', '--prefix', prefix, '--execute']);
  const prefixId = JSON.parse(readFileSync(join(prefix, '.session-peer-ts-harness.json'), 'utf8')).prefixId as string;
  const identityFile = join(base, 'identity.json');
  const identity = ok(['dest', 'identity', '--version', JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
    '--package-sha256', sha('prepared-tree fixture'), '--lock-integrity', integrity]);
  writeFileSync(identityFile, JSON.stringify(identity));
  const label = ok(['op', 'init', '--journal', journal, '--dest-alias', 'fixture-dest', '--dest-host', 'dest.example', '--execute']).operatorLabel as string;
  const P = ['--prefix', prefix], J = ['--journal', journal];
  const file = (name: string, value: unknown) => { const path = join(base, `${name}-${Math.random().toString(16).slice(2)}.json`); writeFileSync(path, JSON.stringify(value)); return path; };
  const record = (run: string, event: string, value?: unknown, target?: string, extra: string[] = []) =>
    ok(['op', 'record', ...J, '--run', run, '--event', event, '--execute', ...(value ? ['--file', file(event, value)] : []), ...(target ? ['--target', target] : []), ...extra]);
  const begin = () => ok(['op', 'begin', ...J, '--execute']).runId as string;
  const stage = (run: string) => ok(['dest', 'stage', ...P, '--run', run, '--identity', identityFile, '--from-tree', tree, '--execute']).staging as string;
  const lock = (run: string) => record(run, 'lock_acquired', ok(['dest', 'lock', ...P, '--run', run, '--operator-label', label, '--execute']));
  const remoteBin = () => join(prefix, 'data/session-peer-ts', name, 'session-peer');
  const cli = (args: string[], target = remoteBin()) => {
    const result = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args, '--host', 'dest.example', '--remote-bin', target, '--json'],
      { encoding: 'utf8', timeout: 60000, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: opDir, SESSION_PEER_TAILSCALE: 'off', CLAUDE_CONFIG_DIR: join(opDir, '.claude'), SESSION_PEER_CODEX_HOMES: '[]' } });
    return JSON.parse(result.stdout);
  };
  // Destination verification, then operator doctor and dry-run over the stand-in.
  const checks = (run: string) => {
    record(run, 'verified', ok(['dest', 'verify', ...P, '--name', name, '--run', run, '--execute']));
    record(run, 'operator_doctor', cli(['doctor']), name, ['--remote-bin', remoteBin()]);
    record(run, 'operator_dry_run', cli(['send', '--to', '999999', '--message', 'synthetic deployment check', '--dry-run']), name, ['--remote-bin', remoteBin()]);
    return file('statement', ok(['op', 'statement', ...J, '--kind', 'operator-checks-passed', '--run', run, '--target', name]));
  };
  const finish = (run: string) => {
    record(run, 'receipt_published', ok(['dest', 'receipt', ...P, '--run', run, '--name', name, '--statement', checks(run), '--execute']));
    record(run, 'lock_released', ok(['dest', 'unlock', ...P, '--run', run, '--execute']));
  };
  const activate = (run: string, staging = stage(run)) => record(run, 'activated', ok(['dest', 'activate', ...P, '--run', run, '--staging', staging, '--execute']));
  const provision = () => { const run = begin(); lock(run); activate(run); finish(run); return run; };
  const name = identity.name as string;
  const root = join(prefix, 'data/session-peer-ts');
  const state = () => (ok(['dest', 'inspect', ...P]).installs as Out[]).find(install => install.name === name)?.state;
  return { base, prefix, root, journal, label, name, P, J, file, record, begin, stage, lock, activate, checks, finish, provision, state, bin, identityFile, launches, tree, remoteBin, cli, prefixId };
}

test('harness refuses non-dedicated prefixes and defaults to dry runs', { skip }, t => {
  const w = world(t);
  refused(['dest', 'inspect', '--prefix', 'relative/prefix'], 'prefix_not_absolute');
  refused(['dest', 'inspect', '--prefix', w.base], 'prefix_not_dedicated');
  symlinkSync(w.prefix, join(w.base, 'link'));
  refused(['dest', 'inspect', '--prefix', join(w.base, 'link')], 'prefix_not_canonical');
  refused(['dest', 'init-prefix', '--prefix', w.prefix, '--execute'], 'prefix_exists');
  const shared = join(w.base, 'shared'); mkdirSync(shared); chmodSync(shared, 0o775);
  refused(['dest', 'init-prefix', '--prefix', join(shared, 'p'), '--execute'], 'untrusted_path');
  const planned = join(w.base, 'planned');
  assert.equal(ok(['dest', 'init-prefix', '--prefix', planned]).dryRun, true);
  assert.equal(existsSync(planned), false);
  const run = w.begin();
  const staged = ok(['dest', 'stage', ...w.P, '--run', run, '--identity', join(w.base, 'identity.json'), '--from-tree', join(w.base, 'tree')]);
  assert.equal(staged.dryRun, true);
  assert.deepEqual(readdirSync(w.root), []);
  assert.equal(h(['dest', 'lock', ...w.P, '--run', run, '--operator-label', w.label]).out.dryRun, true);
  assert.equal(existsSync(join(w.root, '.activate.lock')), false);
  assert.equal(h(['dest', 'nope']).code, 2);
});

test('operator checks precede the receipt, which precedes unlock and caller switching', { skip }, t => {
  const w = world(t);
  // Another manager's executable on PATH must stay byte-identical.
  const other = join(w.base, 'other-manager'); mkdirSync(other, { mode: 0o700 });
  writeFileSync(join(other, 'session-peer'), '#!/bin/sh\necho "session-peer 1.0.2"\n', { mode: 0o700 });
  const env = { ...process.env, PATH: `${other}:/usr/bin:/bin` };
  const inventory = w.file('inventory', h(['dest', 'path-inventory'], env).out);
  const run = w.begin();
  w.lock(run);
  const staging = w.stage(run);
  assert.equal(ok(['dest', 'probe', ...w.P, '--name', staging, '--execute']).nativeLock, 'loaded');
  w.activate(run, staging);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'unreceipted_activation');
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--execute'], 'statement_missing');
  w.record(run, 'verified', ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']));
  refused(['op', 'statement', ...w.J, '--kind', 'operator-checks-passed', '--run', run, '--target', w.name], 'operator_checks_incomplete');
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'operator_doctor', '--target', w.name, '--file', w.file('bad', { ok: false }), '--execute'], 'operator_check_failed');
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'callers_switched', '--target', w.name, '--prefix-id', w.prefixId, '--execute'], 'switch_before_receipt');
  const statement = w.checks(run);
  const receipt = ok(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute']);
  assert.equal(receipt.receipt.runId, run); assert.equal(receipt.recovery, false);
  w.record(run, 'receipt_published', receipt);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'callers_switched', '--target', w.name, '--prefix-id', w.prefixId, '--execute'], 'switch_before_unlock');
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  w.record(run, 'callers_switched', undefined, w.name, ['--prefix-id', w.prefixId]);
  assert.equal(w.state(), 'owned_receipted');
  // A second run of the same identity reuses the receipt and changes nothing.
  const again = w.begin(); w.lock(again);
  const kept = w.stage(again);
  const second = ok(['dest', 'activate', ...w.P, '--run', again, '--staging', kept, '--execute']);
  assert.equal(second.outcome, 'already_provisioned');
  // This run's staging is removed only by the explicit, destructive discard step.
  assert.equal(second.stagingRetained, kept); assert.equal(existsSync(join(w.root, kept)), true);
  assert.equal(ok(['dest', 'discard-staging', ...w.P, '--run', again, '--staging', kept, '--execute']).dryRun, true);
  assert.equal(existsSync(join(w.root, kept)), true);
  ok(['dest', 'discard-staging', ...w.P, '--run', again, '--staging', kept, '--execute', '--confirm-destructive']);
  assert.equal(existsSync(join(w.root, kept)), false);
  assert.equal(h(['dest', 'path-inventory', '--compare', inventory], env).out.unchanged, true);
});

test('an unreceipted target is re-verified only by a new run under a fresh lock', { skip }, t => {
  const w = world(t);
  const dead = w.begin();
  w.lock(dead); w.activate(dead);
  // The first run "dies" after activation: no receipt, lock still held.
  const recovery = w.begin();
  assert.equal(refused(['dest', 'lock', ...w.P, '--run', recovery, '--operator-label', w.label, '--execute'], 'lock_held').autoStale, false);
  refused(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', dead], 'run_not_ended');
  w.record(dead, 'run_ended');
  const ended = w.file('ended', ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', dead]));
  refused(['dest', 'break-lock', ...w.P, '--statement', w.file('wrong', { ...JSON.parse(readFileSync(ended, 'utf8')), runId: recovery })], 'statement_mismatch');
  assert.equal(ok(['dest', 'break-lock', ...w.P, '--statement', ended, '--execute']).dryRun, true);
  w.record(recovery, 'lock_broken', ok(['dest', 'break-lock', ...w.P, '--statement', ended, '--execute', '--confirm-destructive']));
  assert.equal(w.state(), 'owned_no_receipt');
  w.lock(recovery);
  refused(['dest', 'activate', ...w.P, '--run', recovery, '--staging', w.stage(recovery), '--execute'], 'target_not_absent');
  refused(['dest', 'rollback', ...w.P, '--run', recovery, '--name', w.name, '--execute', '--confirm-destructive'], 'rollback_unconfirmed');
  refused(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', recovery, '--target', `${w.name.slice(0, -16)}0000000000000000`], 'target_unknown_to_journal');
  const receipt = ok(['dest', 'receipt', ...w.P, '--run', recovery, '--name', w.name, '--statement', w.checks(recovery), '--execute']);
  // The receipt copies the activating run's marker runId, not the recovery run's.
  assert.equal(receipt.receipt.runId, dead); assert.equal(receipt.recovery, true);
  w.record(recovery, 'receipt_published', receipt);
  w.record(recovery, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', recovery, '--execute']));
  assert.equal(w.state(), 'owned_receipted');
});

test('rollback needs the same run or positive journal confirmation that no caller uses the target', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  // Same run, step 9 never ran: rollback needs no statement.
  assert.equal(ok(['dest', 'rollback', ...w.P, '--run', run, '--name', w.name, '--execute', '--confirm-destructive']).sameRun, true);
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  const dead = w.begin(); w.lock(dead); w.activate(dead);
  w.record(dead, 'run_ended');
  const recovery = w.begin();
  w.record(recovery, 'lock_broken', ok(['dest', 'break-lock', ...w.P, '--statement', w.file('ended', ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', dead])), '--execute', '--confirm-destructive']));
  w.lock(recovery);
  const noCaller = w.file('no-caller', ok(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', recovery, '--target', w.name]));
  assert.equal(ok(['dest', 'rollback', ...w.P, '--run', recovery, '--name', w.name, '--statement', noCaller, '--execute']).dryRun, true);
  assert.equal(ok(['dest', 'rollback', ...w.P, '--run', recovery, '--name', w.name, '--statement', noCaller, '--execute', '--confirm-destructive']).sameRun, false);
  assert.equal(existsSync(join(w.root, w.name)), false);
  assert.deepEqual(readdirSync(w.root).filter(entry => entry.includes('.failed-')), []);
  w.record(recovery, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', recovery, '--execute']));
  // A configured caller blocks the no-caller statement until it is switched back.
  w.provision();
  w.record(w.begin(), 'callers_switched', undefined, w.name, ['--prefix-id', w.prefixId]);
  const retire = w.begin(); w.lock(retire);
  refused(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', retire, '--target', w.name], 'configured_for_caller');
  refused(['dest', 'retire', ...w.P, '--run', retire, '--name', w.name, '--execute', '--confirm-destructive'], 'configured_for_caller_or_unconfirmed');
  w.record(retire, 'callers_unswitched', undefined, w.name, ['--prefix-id', w.prefixId]);
  ok(['dest', 'retire', ...w.P, '--run', retire, '--name', w.name, '--execute', '--confirm-destructive', '--statement',
    w.file('no-caller', ok(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', retire, '--target', w.name]))]);
  assert.equal(existsSync(join(w.root, '.receipts', `${w.name}.json`)), false);
});

test('corrupt, mismatched and orphan receipts are refused and cleaned only explicitly', { skip }, t => {
  const w = world(t);
  w.provision();
  const receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  const original = readFileSync(receiptPath, 'utf8');
  writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(original), runId: 'f'.repeat(32) }));
  assert.equal(w.state(), 'owned_receipt_mismatched');
  const run = w.begin();
  refused(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'remove', '--execute', '--confirm-destructive'], 'lock_not_owned');
  w.lock(run);
  refused(['dest', 'activate', ...w.P, '--run', run, '--staging', w.stage(run), '--execute'], 'target_not_absent');
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', w.checks(run), '--execute'], 'receipt_present');
  assert.equal(ok(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'remove', '--execute']).dryRun, true);
  assert.equal(readFileSync(receiptPath, 'utf8') !== original, true);
  assert.equal(ok(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'remove', '--execute', '--confirm-destructive']).ownership, 'marker');
  writeFileSync(receiptPath, 'not json', { mode: 0o600 });
  assert.equal(w.state(), 'owned_receipt_corrupt');
  ok(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'quarantine', '--execute', '--confirm-destructive']);
  assert.equal(readdirSync(join(w.root, '.receipts-quarantine')).length, 1);
  // Orphan: a receipt whose install directory no longer exists.
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  rmSync(join(w.root, w.name), { recursive: true });
  writeFileSync(receiptPath, original, { mode: 0o600 });
  assert.equal((ok(['dest', 'inspect', ...w.P]).receipts as Out[])[0].state, 'orphan');
  const next = w.begin(); w.lock(next);
  const staging = w.stage(next);
  refused(['dest', 'activate', ...w.P, '--run', next, '--staging', staging, '--execute'], 'orphan_receipt');
  refused(['dest', 'receipt-cleanup', ...w.P, '--run', next, '--name', w.name, '--mode', 'remove', '--execute', '--confirm-destructive'], 'receipt_ownership_unconfirmed');
  const owned = w.file('owned', ok(['op', 'statement', ...w.J, '--kind', 'receipt-owned', '--run', next, '--target', w.name]));
  assert.equal(ok(['dest', 'receipt-cleanup', ...w.P, '--run', next, '--name', w.name, '--mode', 'remove', '--statement', owned, '--execute', '--confirm-destructive']).ownership, 'journal');
  w.activate(next, staging); w.finish(next);
  assert.equal(w.state(), 'owned_receipted');
});

test('.receipts must pass root trust checks and is never followed through a link', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const statement = w.checks(run);
  const receipts = join(w.root, '.receipts');
  mkdirSync(receipts, { mode: 0o755 }); chmodSync(receipts, 0o755);
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'], 'untrusted_path');
  rmSync(receipts, { recursive: true });
  const outside = join(w.base, 'outside'); mkdirSync(outside, { mode: 0o700 });
  symlinkSync(outside, receipts);
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'], 'untrusted_path');
  assert.deepEqual(readdirSync(outside), []);
  rmSync(receipts);
  mkdirSync(receipts, { mode: 0o700 });
  writeFileSync(join(outside, 'target.json'), '{}');
  symlinkSync(join(outside, 'target.json'), join(receipts, `${w.name}.json`));
  assert.equal(w.state(), 'owned_receipt_untrusted_receipt');
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'], 'receipt_present');
  refused(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'remove', '--execute', '--confirm-destructive'], 'untrusted_path');
  assert.equal(readFileSync(join(outside, 'target.json'), 'utf8'), '{}');
});

test('locks with an unknown or unverifiable owner are broken only by explicit override', { skip }, t => {
  const w = world(t);
  const lock = join(w.root, '.activate.lock');
  const run = w.begin();
  for (const owner of [undefined, 'garbage']) {
    mkdirSync(lock, { mode: 0o700 });
    if (owner) writeFileSync(join(lock, 'owner.json'), owner, { mode: 0o600 });
    const held = owner ? 'held_unreadable' : 'held_unowned';
    assert.equal(refused(['dest', 'lock', ...w.P, '--run', run, '--operator-label', w.label, '--execute'], 'lock_held').lock, held);
    refused(['dest', 'break-lock', ...w.P, '--statement', w.file('none', {}), '--execute', '--confirm-destructive'], 'owner_unconfirmable');
    refused(['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--execute', '--confirm-destructive'], 'override_incomplete');
    assert.equal(ok(['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute']).dryRun, true);
    assert.equal(ok(['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive']).override, true);
    assert.equal(existsSync(lock), false);
  }
  // Owned by a run this journal cannot confirm as ended: override only.
  w.provision();
  const live = w.begin(); w.lock(live);
  refused(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', live], 'run_not_ended');
  refused(['dest', 'break-lock', ...w.P, '--execute', '--confirm-destructive'], 'statement_missing');
  ok(['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive']);
  assert.equal(w.state(), 'owned_receipted');
});

test('activation refuses empty, foreign, inconsistent and failing targets', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run);
  const target = join(w.root, w.name);
  const attempt = () => h(['dest', 'activate', ...w.P, '--run', run, '--staging', w.stage(run), '--execute']).out;
  mkdirSync(target, { mode: 0o700 });
  assert.equal(attempt().state, 'empty');
  rmSync(target, { recursive: true }); writeFileSync(target, 'x');
  assert.deepEqual([attempt().state, attempt().reason], ['foreign', 'file']);
  rmSync(target); symlinkSync(w.base, target);
  assert.equal(attempt().reason, 'symlink');
  rmSync(target);
  w.activate(run); w.finish(run);
  const marker = join(target, '.session-peer-owner.json');
  const original = readFileSync(marker, 'utf8');
  writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), identityHash: '0'.repeat(64) }));
  assert.equal(w.state(), 'inconsistent_marker');
  writeFileSync(marker, original);
  writeFileSync(join(target, 'node_modules/session-peer/dist/help.js'), '// edited\n', { flag: 'a' });
  assert.equal(w.state(), 'owned_failed_verification');
  const verify = h(['dest', 'verify', ...w.P, '--name', w.name, '--execute']);
  assert.equal(verify.code, 1); assert.equal(verify.out.checks.manifest, false);
  ok(['dest', 'destroy-prefix', ...w.P, '--execute', '--confirm-destructive']);
  assert.equal(existsSync(w.prefix), false);
});

function listing(dir: string, skip: string[] = []): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).filter(entry => !skip.some(prefix => entry === prefix || entry.startsWith(`${prefix}/`))).sort();
}

test('stage validates the identity file and stays inside the prefix before any write', { skip }, t => {
  const w = world(t);
  const valid = JSON.parse(readFileSync(w.identityFile, 'utf8')).identity;
  const run = w.begin();
  const ids = join(w.base, 'ids'); mkdirSync(ids, { mode: 0o700 });
  const before = listing(w.base, ['ids']);
  const patches: Record<string, unknown>[] = [{ version: '../../../outside' }, { version: '/absolute/outside' }, { version: '0.4.0/../x' },
    { version: 4 }, { sha256: 7 }, { sha256: 'not-a-sha' }, { lockIntegrity: { nan: 'md5-x' } }, { lockIntegrity: [] }, { lockIntegrity: { '../x': valid.lockIntegrity.nan } },
    { package: 'other' }, { extra: true }, { node: 'relative/node' }, { nodeMajor: '24' }, { modules: 137 }, { platform: '../x' }];
  patches.forEach((patch, index) => {
    const file = join(ids, `${index}.json`);
    writeFileSync(file, JSON.stringify({ identity: { ...valid, ...patch } }));
    for (const mode of [[], ['--execute']])
      refused(['dest', 'stage', ...w.P, '--run', run, '--identity', file, '--from-tree', w.tree, ...mode], 'identity_invalid');
  });
  assert.deepEqual(listing(w.base, ['ids']), before);
  assert.deepEqual(readdirSync(w.root), []);
});

test('operator dry-run records only no_reachable_target or a validated dry run', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  w.record(run, 'verified', ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']));
  const base = { ok: false, status: 'refused', submitted: false, consumptionConfirmed: false, host: 'dest.example' };
  for (const error of ['ssh_unreachable', 'ssh_host_key_untrusted', 'ssh_authentication_refused', 'remote_cli_missing', 'remote_version_mismatch',
    'ssh_preflight_failed', 'remote_preparation_unverified', 'invalid_ssh_option'])
    refused(['op', 'record', ...w.J, '--run', run, '--event', 'operator_dry_run', '--target', w.name, '--file', w.file('dry', { ...base, error }), '--execute'], 'operator_check_failed');
  for (const value of [{ ...base, ok: true, status: 'validated', submitted: true }, { ...base, error: 'no_reachable_target', submitted: null },
    { ...base, ok: true, status: 'queued', submitted: true }])
    refused(['op', 'record', ...w.J, '--run', run, '--event', 'operator_dry_run', '--target', w.name, '--file', w.file('dry', value), '--execute'], 'operator_check_failed');
});

test('dry runs and unexecuted checks launch nothing and create no probe files', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run);
  const staging = w.stage(run);
  const stagingDir = join(w.root, staging);
  const mtime = (dir: string) => statSync(dir, { bigint: true }).mtimeNs;
  const before = [w.launches(), mtime(stagingDir)];
  assert.equal(ok(['dest', 'probe', ...w.P, '--name', staging]).dryRun, true);
  assert.equal(ok(['dest', 'activate', ...w.P, '--run', run, '--staging', staging]).dryRun, true);
  assert.deepEqual([w.launches(), mtime(stagingDir)], before);
  w.activate(run, staging);
  assert.ok(w.launches() > before[0]!);
  const target = join(w.root, w.name);
  const after = [w.launches(), mtime(target)];
  const unexecuted = h(['dest', 'verify', ...w.P, '--name', w.name]).out;
  assert.equal(unexecuted.dryRun, true); assert.equal(unexecuted.checks.banner, 'not_run'); assert.equal(unexecuted.checks.manifest, true);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'verified', '--file', w.file('verify', unexecuted), '--execute'], 'result_invalid');
  const statement = w.checks(run);
  const settled = [w.launches(), mtime(target)];
  assert.equal(ok(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement]).dryRun, true);
  assert.deepEqual([w.launches(), mtime(target)], settled);
  assert.notDeepEqual(after, settled);
});

test('operator check records bind the destination host, remote version and named install', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  w.record(run, 'verified', ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']));
  const doctor = { ok: true, diagnosticCompleted: true, implementation: 'typescript', ready: false, version: packageVersion, host: 'dest.example' };
  const record = (value: unknown, extra: string[]) => h(['op', 'record', ...w.J, '--run', run, '--event', 'operator_doctor', '--target', w.name,
    '--file', w.file('doctor', value), '--execute', ...extra]);
  const bin = ['--remote-bin', w.remoteBin()];
  assert.equal(record({ ...doctor, host: 'other.example' }, bin).out.error, 'operator_check_host_mismatch');
  assert.equal(record({ ...doctor, version: '0.3.9' }, bin).out.error, 'operator_check_version_mismatch');
  const other = `${w.name.slice(0, -16)}0000000000000000`;
  assert.equal(record(doctor, ['--remote-bin', join(w.root, other, 'session-peer')]).out.error, 'operator_check_target_mismatch');
  assert.equal(record(doctor, []).code, 2);
  const accepted = record(doctor, bin).out;
  assert.equal(accepted.ok, true); assert.equal(accepted.record.remoteBinAttested, w.remoteBin()); assert.equal(accepted.record.host, 'dest.example');
  // A dry-run result from another destination is refused the same way.
  const dry = { ok: false, error: 'no_reachable_target', status: 'refused', submitted: false, consumptionConfirmed: false, host: 'other.example' };
  assert.equal(h(['op', 'record', ...w.J, '--run', run, '--event', 'operator_dry_run', '--target', w.name, '--file', w.file('dry', dry), '--execute', ...bin]).out.error,
    'operator_check_host_mismatch');
});

test('a verify result is recorded only under the run and lock that produced it', { skip }, t => {
  const w = world(t);
  w.provision();
  const earlier = w.begin(); w.lock(earlier);
  const result = ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', earlier, '--execute']);
  w.record(earlier, 'verified', result);
  w.record(earlier, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', earlier, '--execute']));
  const later = w.begin(); w.lock(later);
  refused(['op', 'record', ...w.J, '--run', later, '--event', 'verified', '--file', w.file('verify', result), '--execute'], 'result_invalid');
  w.record(later, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', later, '--execute']));
  // The same run under a fresh lock cannot reuse its earlier result either.
  w.lock(earlier);
  refused(['op', 'record', ...w.J, '--run', earlier, '--event', 'verified', '--file', w.file('verify', result), '--execute'], 'result_invalid');
  // Without --run a verify result carries no binding and is not recordable.
  const unbound = ok(['dest', 'verify', ...w.P, '--name', w.name, '--execute']);
  refused(['op', 'record', ...w.J, '--run', earlier, '--event', 'verified', '--file', w.file('verify', unbound), '--execute'], 'result_invalid');
});

test('a failed intent write before the rename leaves no install and nothing to release', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run);
  const staging = w.stage(run);
  const lock = join(w.root, '.activate.lock'), target = join(w.root, w.name);
  // The lock directory refuses writes, so the intent write fails before any rename.
  chmodSync(lock, 0o500);
  const failed = h(['dest', 'activate', ...w.P, '--run', run, '--staging', staging, '--execute']);
  chmodSync(lock, 0o700);
  assert.equal(failed.code, 1); assert.equal(failed.out.reason, 'EACCES');
  assert.equal(existsSync(target), false); assert.equal(existsSync(join(w.root, staging)), true);
  assert.deepEqual(readdirSync(lock), ['owner.json']);
  assert.equal(ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']).released, true);
});

// No crash is injected between the rename and a later write: after this
// change nothing is written after the rename, so the state a crash right
// after it leaves is exactly the persisted state of a completed activation.
test('after a completed rename the persisted intent alone blocks unlock', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const lock = join(w.root, '.activate.lock');
  assert.deepEqual(readdirSync(lock).sort(), ['activation.json', 'owner.json']);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'unreceipted_activation');
});

test('a present but invalid activation intent is refused, never treated as absent', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const intent = join(w.root, '.activate.lock', 'activation.json');
  const original = JSON.parse(readFileSync(intent, 'utf8'));
  const { at, ...withoutAt } = original;
  const contents = ['false', '0', '""', 'null', '[]', '{', '{}', JSON.stringify({ ...original, runId: 'f'.repeat(32) }),
    JSON.stringify({ ...original, lockId: '0'.repeat(32) }), JSON.stringify({ ...original, staging: `${w.name.slice(0, -16)}0000000000000000.staging-0000000000000000` }),
    JSON.stringify({ ...original, extra: 1 }), JSON.stringify(withoutAt), JSON.stringify({ ...original, target: 'x' })];
  assert.equal(typeof at, 'string');
  for (const content of contents) {
    writeFileSync(intent, content);
    refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'activation_intent_unreadable');
    refused(['dest', 'activate', ...w.P, '--run', run, '--staging', w.stage(run), '--execute'], 'activation_intent_unreadable');
  }
  rmSync(intent); mkdirSync(intent);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'activation_intent_unreadable');
  rmSync(intent, { recursive: true }); writeFileSync(intent, JSON.stringify(original), { mode: 0o600 });
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'unreceipted_activation');
});

test('results and statements of an earlier lock of the same run, or of another prefix, are refused', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const lockOwner = join(w.root, '.activate.lock', 'owner.json');
  const first = JSON.parse(readFileSync(lockOwner, 'utf8'));
  const statement = w.checks(run);
  const receipt = ok(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute']);
  w.record(run, 'receipt_published', receipt);
  const unlock = ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']);
  w.record(run, 'lock_released', unlock);
  w.lock(run);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'receipt_published', '--file', w.file('receipt', receipt), '--execute'], 'result_invalid');
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'lock_released', '--file', w.file('unlock', unlock), '--execute'], 'result_invalid');
  // Same run re-acquiring at the same timestamp: only the random lockId differs.
  const second = JSON.parse(readFileSync(lockOwner, 'utf8'));
  assert.notEqual(second.lockId, first.lockId);
  writeFileSync(lockOwner, JSON.stringify({ ...second, createdAt: first.createdAt }));
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'], 'statement_mismatch');
  // A verify result produced under a lock on another prefix.
  const other = join(w.base, 'prefix2'), P2 = ['--prefix', other];
  ok(['dest', 'init-prefix', ...P2, '--execute']);
  const elsewhere = w.begin();
  ok(['dest', 'lock', ...P2, '--run', elsewhere, '--operator-label', w.label, '--execute']);
  const staged = ok(['dest', 'stage', ...P2, '--run', elsewhere, '--identity', w.identityFile, '--from-tree', w.tree, '--execute']).staging;
  ok(['dest', 'activate', ...P2, '--run', elsewhere, '--staging', staged, '--execute']);
  const foreign = ok(['dest', 'verify', ...P2, '--name', w.name, '--run', elsewhere, '--execute']);
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  w.lock(elsewhere);
  refused(['op', 'record', ...w.J, '--run', elsewhere, '--event', 'verified', '--file', w.file('verify', foreign), '--execute'], 'result_invalid');
});

test('staging is discarded only by its own run; markerless leftovers need an explicit declaration', { skip }, t => {
  const w = world(t);
  const owner = w.begin(), other = w.begin();
  const staging = w.stage(owner);
  refused(['dest', 'discard-staging', ...w.P, '--run', other, '--staging', staging, '--execute', '--confirm-destructive'], 'staging_not_owned');
  assert.equal(existsSync(join(w.root, staging)), true);
  assert.equal(h(['dest', 'discard-staging', ...w.P, '--staging', staging, '--execute', '--confirm-destructive']).code, 2);
  const leftover = w.stage(owner);
  rmSync(join(w.root, leftover, '.session-peer-owner.json'));
  refused(['dest', 'discard-staging', ...w.P, '--run', owner, '--staging', leftover, '--execute', '--confirm-destructive'], 'staging_not_owned');
  refused(['dest', 'discard-leftover', ...w.P, '--staging', leftover, '--execute', '--confirm-destructive'], 'leftover_not_declared');
  refused(['dest', 'discard-leftover', ...w.P, '--staging', staging, '--declare-abandoned', '--execute', '--confirm-destructive'], 'staging_has_marker');
  assert.equal(ok(['dest', 'discard-leftover', ...w.P, '--staging', leftover, '--declare-abandoned', '--execute']).dryRun, true);
  ok(['dest', 'discard-leftover', ...w.P, '--staging', leftover, '--declare-abandoned', '--execute', '--confirm-destructive']);
  ok(['dest', 'discard-staging', ...w.P, '--run', owner, '--staging', staging, '--execute', '--confirm-destructive']);
  assert.deepEqual(readdirSync(w.root), []);
});

test('an acquisition is recorded once per journal; a replayed one cannot revive an earlier lock', { skip }, t => {
  const w = world(t);
  const first = w.begin();
  const acquired = ok(['dest', 'lock', ...w.P, '--run', first, '--operator-label', w.label, '--execute']);
  w.record(first, 'lock_acquired', acquired);
  const released = ok(['dest', 'unlock', ...w.P, '--run', first, '--execute']);
  w.record(first, 'lock_released', released);
  const second = w.begin(); w.lock(second);
  w.record(second, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', second, '--execute']));
  // Replaying the first acquisition would make its old unlock result current again.
  refused(['op', 'record', ...w.J, '--run', first, '--event', 'lock_acquired', '--file', w.file('lock', acquired), '--execute'], 'acquisition_replayed');
  refused(['op', 'record', ...w.J, '--run', first, '--event', 'lock_released', '--file', w.file('unlock', released), '--execute'], 'lock_not_recorded');
  refused(['op', 'record', ...w.J, '--run', second, '--event', 'lock_acquired', '--file', w.file('lock', acquired), '--execute'], 'result_invalid');
  // Re-recording the current acquisition is not idempotent either: each acquisition is recorded exactly once.
  const third = w.begin();
  const current = ok(['dest', 'lock', ...w.P, '--run', third, '--operator-label', w.label, '--execute']);
  w.record(third, 'lock_acquired', current);
  refused(['op', 'record', ...w.J, '--run', third, '--event', 'lock_acquired', '--file', w.file('lock', current), '--execute'], 'acquisition_replayed');
});

test('only a break of the same prefix and lock closes the current acquisition', { skip }, t => {
  const w = world(t);
  const holder = w.begin(); w.lock(holder);
  // A break on another prefix is an audit record only.
  const other = join(w.base, 'prefix2'), P2 = ['--prefix', other];
  ok(['dest', 'init-prefix', ...P2, '--execute']);
  const elsewhere = w.begin();
  ok(['dest', 'lock', ...P2, '--run', elsewhere, '--operator-label', w.label, '--execute']);
  const foreign = ok(['dest', 'break-lock', ...P2, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive']);
  const foreignRecord = w.record(holder, 'lock_broken', foreign).record;
  // The holder still holds its lock: its lock-bound results stay recordable.
  w.activate(holder);
  assert.equal(foreignRecord.closesLockId, null);
  // A break of a lock already closed (or never recorded here) closes nothing either.
  const stale = w.begin();
  ok(['dest', 'lock', ...P2, '--run', stale, '--operator-label', w.label, '--execute']);
  const staleBreak = ok(['dest', 'break-lock', ...P2, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive']);
  assert.equal(w.record(holder, 'lock_broken', staleBreak).record.closesLockId, null);
  w.record(holder, 'verified', ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', holder, '--execute']));
  // Legitimate recovery: the ended holder's own lock, broken on its prefix.
  w.record(holder, 'run_ended');
  const recovery = w.begin();
  const ended = w.file('ended', ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', holder]));
  const broken = ok(['dest', 'break-lock', ...w.P, '--statement', ended, '--execute', '--confirm-destructive']);
  const closed = w.record(recovery, 'lock_broken', broken).record;
  assert.equal(closed.closesLockId, broken.brokenLockId);
  refused(['op', 'record', ...w.J, '--run', recovery, '--event', 'lock_broken', '--file', w.file('broken', broken), '--execute'], 'break_replayed');
  w.lock(recovery);
});

test('a break recorded first tombstones that acquisition; recording it later is refused', { skip }, t => {
  const w = world(t);
  const late = w.begin();
  // The acquisition result is kept but not recorded; its break is recorded first.
  const acquired = ok(['dest', 'lock', ...w.P, '--run', late, '--operator-label', w.label, '--execute']);
  const recorder = w.begin();
  const broken = ok(['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive']);
  assert.equal(broken.brokenLockId, acquired.lockId);
  assert.equal(w.record(recorder, 'lock_broken', broken).record.closesLockId, null);
  refused(['op', 'record', ...w.J, '--run', late, '--event', 'lock_acquired', '--file', w.file('lock', acquired), '--execute'], 'acquisition_replayed');
  // A break naming the same lockId on another prefix is an unrelated
  // generation (shaped by hand: lockIds are random) and blocks nothing here.
  const other = join(w.base, 'prefix2');
  ok(['dest', 'init-prefix', '--prefix', other, '--execute']);
  const otherPrefixId = JSON.parse(readFileSync(join(other, '.session-peer-ts-harness.json'), 'utf8')).prefixId;
  const fresh = w.begin();
  const current = ok(['dest', 'lock', ...w.P, '--run', fresh, '--operator-label', w.label, '--execute']);
  w.record(recorder, 'lock_broken', { ...broken, prefixId: otherPrefixId, brokenLockId: current.lockId, runId: null });
  w.record(fresh, 'lock_acquired', current);
  w.record(fresh, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', fresh, '--execute']));
});

function snapshot(dir: string) {
  return listing(dir).map(entry => {
    const path = join(dir, entry), stat = statSync(path, { throwIfNoEntry: false });
    return `${entry}:${stat?.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : stat?.isDirectory() ? 'dir' : 'other'}`;
  });
}

test('discard-leftover removes only staging trees with no marker at all', { skip }, t => {
  const w = world(t);
  const run = w.begin();
  const marker = '.session-peer-owner.json';
  const cases: [string, (dir: string) => void][] = [
    ['foreign', dir => writeFileSync(join(dir, marker), JSON.stringify({ manager: 'another manager', markerVersion: 1 }))],
    ['unparsable', dir => writeFileSync(join(dir, marker), 'not json')],
    ['invalid', dir => writeFileSync(join(dir, marker), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, marker), 'utf8')), identity: { version: '../x' } }))],
    ['symlink', dir => { rmSync(join(dir, marker)); symlinkSync(join(w.base, 'lock-integrity.json'), join(dir, marker)); }],
    ['directory', dir => { rmSync(join(dir, marker)); mkdirSync(join(dir, marker)); }]];
  for (const [, damage] of cases) {
    const staging = w.stage(run), dir = join(w.root, staging);
    damage(dir);
    const before = snapshot(dir);
    refused(['dest', 'discard-leftover', ...w.P, '--staging', staging, '--declare-abandoned', '--execute', '--confirm-destructive'], 'staging_has_marker');
    assert.deepEqual(snapshot(dir), before);
  }
  const leftover = w.stage(run);
  rmSync(join(w.root, leftover, marker));
  ok(['dest', 'discard-leftover', ...w.P, '--staging', leftover, '--declare-abandoned', '--execute', '--confirm-destructive']);
  assert.equal(existsSync(join(w.root, leftover)), false);
});

test('the operator dry-run is recorded only after a doctor that follows the latest verify', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const verify = () => w.record(run, 'verified', ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']));
  const bin = ['--remote-bin', w.remoteBin()];
  const dry = w.cli(['send', '--to', '999999', '--message', 'synthetic deployment check', '--dry-run']), doctor = w.cli(['doctor']);
  verify();
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'operator_dry_run', '--target', w.name, '--file', w.file('dry', dry), '--execute', ...bin], 'operator_check_order');
  w.record(run, 'operator_doctor', doctor, w.name, bin);
  // A re-verify makes the earlier doctor stale.
  verify();
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'operator_dry_run', '--target', w.name, '--file', w.file('dry', dry), '--execute', ...bin], 'operator_check_order');
  refused(['op', 'statement', ...w.J, '--kind', 'operator-checks-passed', '--run', run, '--target', w.name], 'operator_checks_incomplete');
  w.record(run, 'operator_doctor', doctor, w.name, bin);
  w.record(run, 'operator_dry_run', dry, w.name, bin);
  assert.equal(ok(['op', 'statement', ...w.J, '--kind', 'operator-checks-passed', '--run', run, '--target', w.name]).kind, 'operator-checks-passed');
});

test('receipt cleanup and retention results are recordable only under the current lock', { skip }, t => {
  const w = world(t);
  w.provision();
  const receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  writeFileSync(receiptPath, 'not json');
  const run = w.begin(); w.lock(run);
  const dryCleanup = ok(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'quarantine', '--execute']);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'receipt_cleaned', '--file', w.file('clean', dryCleanup), '--execute'], 'result_invalid');
  const cleaned = ok(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name, '--mode', 'quarantine', '--execute', '--confirm-destructive']);
  const other = w.begin();
  refused(['op', 'record', ...w.J, '--run', other, '--event', 'receipt_cleaned', '--file', w.file('clean', cleaned), '--execute'], 'result_invalid');
  const entry = w.record(run, 'receipt_cleaned', cleaned).record;
  assert.deepEqual([entry.target, entry.mode, entry.receipt, entry.ownership, entry.lockId], [w.name, 'quarantine', 'corrupt', 'marker', cleaned.lockId]);
  const noCaller = w.file('no-caller', ok(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', run, '--target', w.name]));
  const retired = ok(['dest', 'retire', ...w.P, '--run', run, '--name', w.name, '--statement', noCaller, '--execute', '--confirm-destructive']);
  const retiredEntry = w.record(run, 'retired', retired).record;
  assert.deepEqual([retiredEntry.target, retiredEntry.lockId], [w.name, retired.lockId]);
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  w.lock(run);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'retired', '--file', w.file('retire', retired), '--execute'], 'result_invalid');
  // Unknown event names stay usage errors; nothing is accepted loosely.
  assert.equal(h(['op', 'record', ...w.J, '--run', run, '--event', 'retire', '--file', w.file('retire', retired), '--execute']).code, 2);
});

// Full publication on an extra prefix with the same identity (same install name).
function publishOn(w: ReturnType<typeof world>, prefix: string) {
  const P = ['--prefix', prefix];
  ok(['dest', 'init-prefix', ...P, '--execute']);
  const prefixId = JSON.parse(readFileSync(join(prefix, '.session-peer-ts-harness.json'), 'utf8')).prefixId as string;
  const run = w.begin();
  w.record(run, 'lock_acquired', ok(['dest', 'lock', ...P, '--run', run, '--operator-label', w.label, '--execute']));
  const staging = ok(['dest', 'stage', ...P, '--run', run, '--identity', w.identityFile, '--from-tree', w.tree, '--execute']).staging;
  w.record(run, 'activated', ok(['dest', 'activate', ...P, '--run', run, '--staging', staging, '--execute']));
  w.record(run, 'verified', ok(['dest', 'verify', ...P, '--name', w.name, '--run', run, '--execute']));
  // The operator CLI runs against this prefix's own install wrapper.
  const wrapper = join(prefix, 'data/session-peer-ts', w.name, 'session-peer'), bin = ['--remote-bin', wrapper];
  w.record(run, 'operator_doctor', w.cli(['doctor'], wrapper), w.name, bin);
  w.record(run, 'operator_dry_run', w.cli(['send', '--to', '999999', '--message', 'synthetic deployment check', '--dry-run'], wrapper), w.name, bin);
  const statement = w.file('statement', ok(['op', 'statement', ...w.J, '--kind', 'operator-checks-passed', '--run', run, '--target', w.name]));
  w.record(run, 'receipt_published', ok(['dest', 'receipt', ...P, '--run', run, '--name', w.name, '--statement', statement, '--execute']));
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...P, '--run', run, '--execute']));
  return prefixId;
}

test('caller switches and no-caller/receipt-owned statements are bound to the prefix, not the name alone', { skip }, t => {
  const w = world(t);
  w.provision();
  const second = publishOn(w, join(w.base, 'prefix2'));
  const switcher = w.begin();
  const caller = (event: string, prefixId: string) => h(['op', 'record', ...w.J, '--run', switcher, '--event', event, '--target', w.name, '--prefix-id', prefixId, '--execute']).out;
  assert.equal(caller('callers_switched', w.prefixId).ok, true);
  // An unswitch on the other prefix cannot cancel this prefix's switch.
  assert.equal(caller('callers_unswitched', second).error, 'no_switch_recorded');
  assert.equal(h(['op', 'record', ...w.J, '--run', switcher, '--event', 'callers_switched', '--target', w.name, '--execute']).code, 2);
  assert.equal(caller('callers_switched', 'f'.repeat(32)).error, 'prefix_unknown_to_journal');
  // A prefix whose lock is recorded but where this name was never published.
  const third = join(w.base, 'prefix3');
  ok(['dest', 'init-prefix', '--prefix', third, '--execute']);
  const thirdId = JSON.parse(readFileSync(join(third, '.session-peer-ts-harness.json'), 'utf8')).prefixId;
  const holder = w.begin();
  w.record(holder, 'lock_acquired', ok(['dest', 'lock', '--prefix', third, '--run', holder, '--operator-label', w.label, '--execute']));
  assert.equal(caller('callers_switched', thirdId).error, 'switch_before_receipt');
  refused(['op', 'statement', ...w.J, '--kind', 'receipt-owned', '--run', holder, '--target', w.name], 'receipt_unknown_to_journal');
  refused(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', holder, '--target', w.name], 'target_unknown_to_journal');
  // Under a lock on the first prefix the outstanding switch blocks no-caller; on the second it does not.
  const first = w.begin(); w.lock(first);
  refused(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', first, '--target', w.name], 'configured_for_caller');
  const other = w.begin();
  w.record(other, 'lock_acquired', ok(['dest', 'lock', '--prefix', join(w.base, 'prefix2'), '--run', other, '--operator-label', w.label, '--execute']));
  assert.equal(ok(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', other, '--target', w.name]).prefixId, second);
});

test('verify probes nothing unless every static check passes', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run);
  const staging = w.stage(run);
  w.activate(run, staging);
  // The staging path named by the intent reappears: static check stagingGone fails.
  mkdirSync(join(w.root, staging), { mode: 0o700 });
  const before = w.launches();
  const failed = h(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']).out;
  assert.equal(failed.ok, false); assert.equal(failed.checks.stagingGone, false); assert.equal(failed.checks.banner, 'not_run');
  assert.equal(w.launches(), before);
  rmSync(join(w.root, staging), { recursive: true });
  assert.equal(ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']).checks.banner, true);
  assert.ok(w.launches() > before);
});

test('an explicit override removes only known lock metadata entries, without following links', { skip }, t => {
  const w = world(t);
  const lock = join(w.root, '.activate.lock');
  const outside = join(w.base, 'outside.json'); writeFileSync(outside, 'keep');
  const override = ['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive'];
  for (const make of [() => mkdirSync(join(lock, 'owner.json')), () => symlinkSync(outside, join(lock, 'owner.json')),
    () => { writeFileSync(join(lock, 'owner.json'), 'x'); mkdirSync(join(lock, 'activation.json')); }, () => symlinkSync(outside, join(lock, 'activation.json'))]) {
    mkdirSync(lock, { mode: 0o700 }); make();
    assert.equal(ok(override).override, true);
    assert.equal(existsSync(lock), false); assert.equal(readFileSync(outside, 'utf8'), 'keep');
  }
  for (const make of [() => { mkdirSync(join(lock, 'owner.json')); writeFileSync(join(lock, 'owner.json', 'inner'), 'x'); }, () => writeFileSync(join(lock, 'extra'), 'x')]) {
    mkdirSync(lock, { mode: 0o700 }); make();
    refused(override, 'lock_contents_unexpected');
    assert.equal(existsSync(lock), true);
    rmSync(lock, { recursive: true });
  }
});

test('a receipt whose response was lost is replayed for the same lock without rewriting it', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const statement = w.checks(run);
  const args = ['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'];
  ok(args); // The response is lost: nothing is recorded.
  const receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  const bytes = readFileSync(receiptPath, 'utf8');
  const replay = ok(args);
  assert.equal(replay.replayed, true); assert.equal(readFileSync(receiptPath, 'utf8'), bytes);
  assert.equal(replay.receipt.verifiedAt, JSON.parse(bytes).verifiedAt);
  // A write lost between the publication intent and the receipt is completed with the same bytes.
  rmSync(receiptPath);
  assert.equal(ok(args).replayed, true); assert.equal(readFileSync(receiptPath, 'utf8'), bytes);
  w.record(run, 'receipt_published', replay);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'receipt_published', '--file', w.file('receipt', replay), '--execute'], 'receipt_already_recorded');
  // Changed receipt bytes are not replayed.
  writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(bytes), verifiedAt: 'x' }));
  refused(args, 'receipt_present');
  writeFileSync(receiptPath, bytes);
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  w.record(run, 'callers_switched', undefined, w.name, ['--prefix-id', w.prefixId]);
  // A later lock has no publication of its own: the same proof is stale and nothing is replayed.
  w.lock(run);
  refused(args, 'statement_mismatch');
});

test('after run_ended only a run-ended statement is issued', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  w.checks(run);
  w.record(run, 'run_ended');
  for (const kind of ['operator-checks-passed', 'no-caller', 'receipt-owned'])
    refused(['op', 'statement', ...w.J, '--kind', kind, '--run', run, '--target', w.name], 'run_ended');
  assert.equal(ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', run]).kind, 'run-ended');
});

test('callers switch after the publishing lock was closed by its exact recorded break', { skip }, t => {
  const w = world(t);
  const publisher = w.begin(); w.lock(publisher); w.activate(publisher);
  const statement = w.checks(publisher);
  w.record(publisher, 'receipt_published', ok(['dest', 'receipt', ...w.P, '--run', publisher, '--name', w.name, '--statement', statement, '--execute']));
  w.record(publisher, 'run_ended');
  const recovery = w.begin();
  const switching = () => h(['op', 'record', ...w.J, '--run', recovery, '--event', 'callers_switched', '--target', w.name, '--prefix-id', w.prefixId, '--execute']).out;
  // A break on another prefix closes nothing.
  const other = join(w.base, 'prefix2');
  ok(['dest', 'init-prefix', '--prefix', other, '--execute']);
  const elsewhere = w.begin();
  ok(['dest', 'lock', '--prefix', other, '--run', elsewhere, '--operator-label', w.label, '--execute']);
  w.record(recovery, 'lock_broken', ok(['dest', 'break-lock', '--prefix', other, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive']));
  assert.equal(switching().error, 'switch_before_unlock');
  const ended = w.file('ended', ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', publisher]));
  w.record(recovery, 'lock_broken', ok(['dest', 'break-lock', ...w.P, '--statement', ended, '--execute', '--confirm-destructive']));
  assert.equal(switching().ok, true);
});

test('empty PATH components inventory the current directory', { skip }, t => {
  const w = world(t);
  const cwd = join(w.base, 'cwd'); mkdirSync(cwd, { mode: 0o700 });
  writeFileSync(join(cwd, 'session-peer'), '#!/bin/sh\necho other\n', { mode: 0o700 });
  const digest = sha(readFileSync(join(cwd, 'session-peer')));
  for (const path of [':/usr/bin', '/usr/bin:', '/usr/bin::/bin']) {
    const entries = h(['dest', 'path-inventory'], { ...process.env, PATH: path }, cwd).out.entries as Out[];
    const local = entries.filter(entry => entry.path === './session-peer');
    assert.equal(local.length, 1, path); assert.equal(local[0]!.sha256, digest); assert.equal(local[0]!.realpath, join(cwd, 'session-peer'));
  }
});

test('a matching receipt left by an ended run is adopted under a new lock only with fresh checks', { skip }, t => {
  const w = world(t);
  const lost = w.begin(); w.lock(lost); w.activate(lost);
  const oldStatement = w.checks(lost);
  ok(['dest', 'receipt', ...w.P, '--run', lost, '--name', w.name, '--statement', oldStatement, '--execute']); // response lost
  const receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  const bytes = readFileSync(receiptPath, 'utf8');
  w.record(lost, 'run_ended');
  const recovery = w.begin();
  const ended = w.file('ended', ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', lost]));
  w.record(recovery, 'lock_broken', ok(['dest', 'break-lock', ...w.P, '--statement', ended, '--execute', '--confirm-destructive']));
  w.lock(recovery);
  const adopt = (statement: string) => ['dest', 'receipt', ...w.P, '--run', recovery, '--name', w.name, '--statement', statement, '--adopt-existing', '--execute'];
  refused(adopt(oldStatement), 'statement_mismatch');
  const fresh = w.checks(recovery);
  refused(['dest', 'receipt', ...w.P, '--run', recovery, '--name', w.name, '--statement', fresh, '--execute'], 'receipt_present');
  const adopted = ok(adopt(fresh));
  assert.equal(adopted.adopted, true); assert.equal(readFileSync(receiptPath, 'utf8'), bytes);
  assert.equal(adopted.receipt.verifiedAt, JSON.parse(bytes).verifiedAt); assert.equal(adopted.receipt.runId, lost);
  assert.equal(ok(adopt(fresh)).replayed, true);
  w.record(recovery, 'receipt_published', adopted);
  w.record(recovery, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', recovery, '--execute']));
  w.record(recovery, 'callers_switched', undefined, w.name, ['--prefix-id', w.prefixId]);
});

test('an invalid existing receipt is never adopted', { skip }, t => {
  const w = world(t);
  w.provision();
  const receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(readFileSync(receiptPath, 'utf8')), runId: 'e'.repeat(32) }));
  const run = w.begin(); w.lock(run);
  const fresh = w.checks(run);
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', fresh, '--adopt-existing', '--execute'], 'receipt_present');
  assert.equal(existsSync(join(w.root, '.activate.lock', 'publication.json')), false);
});

test('a recorded publication is not completed once the target was rolled back or changed', { skip }, t => {
  for (const change of ['rollback', 'manifest'] as const) {
    const w = world(t);
    const run = w.begin(); w.lock(run); w.activate(run);
    const statement = w.checks(run);
    const args = ['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'];
    ok(args);
    // As if the receipt write never happened after the synced intent.
    rmSync(join(w.root, '.receipts', `${w.name}.json`));
    if (change === 'rollback') ok(['dest', 'rollback', ...w.P, '--run', run, '--name', w.name, '--execute', '--confirm-destructive']);
    else writeFileSync(join(w.root, w.name, 'node_modules/session-peer/dist/help.js'), '// changed\n', { flag: 'a' });
    refused(args, 'publication_target_changed');
    assert.equal(existsSync(join(w.root, '.receipts', `${w.name}.json`)), false);
  }
});

test('a publication intent with valid JSON but an invalid receipt is refused before any write', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const statement = w.checks(run);
  const args = ['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'];
  ok(args);
  const pubPath = join(w.root, '.activate.lock', 'publication.json'), receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  const pub = JSON.parse(readFileSync(pubPath, 'utf8')), good = JSON.parse(pub.receipt);
  const { receiptVersion, ...noVersion } = good;
  assert.equal(receiptVersion, 1);
  const variants: [unknown, string][] = [[noVersion, 'publication_intent_unreadable'], [{ ...good, receiptVersion: 2 }, 'publication_intent_unreadable'],
    [{ ...good, identityHash: 'x' }, 'publication_intent_unreadable'], [{ ...good, extra: 1 }, 'publication_intent_unreadable'],
    [{ ...good, verifiedAt: 'yesterday' }, 'publication_intent_unreadable'], [{ ...good, runId: 'e'.repeat(32) }, 'publication_target_changed']];
  for (const [receipt, error] of variants) {
    rmSync(receiptPath, { force: true });
    writeFileSync(pubPath, JSON.stringify({ ...pub, receipt: JSON.stringify(receipt) }));
    refused(args, error);
    assert.equal(existsSync(receiptPath), false);
  }
});

test('lock metadata of other file types is refused before removal', { skip }, t => {
  const w = world(t);
  const lock = join(w.root, '.activate.lock');
  mkdirSync(lock, { mode: 0o700 });
  assert.equal(spawnSync('mkfifo', [join(lock, 'owner.json')]).status, 0);
  refused(['dest', 'break-lock', ...w.P, '--unowned', '--lock-name', '.activate.lock', '--declare-run-ended', '--execute', '--confirm-destructive'], 'lock_contents_unexpected');
  assert.equal(statSync(join(lock, 'owner.json')).isFIFO(), true);
});

test('caller records without a prefix make no-caller unconfirmable instead of counting as zero', { skip }, t => {
  const w = world(t);
  w.provision();
  // A legacy record (pre-prefix journal format), appended with a valid hash chain.
  const lines = readFileSync(w.journal, 'utf8').split('\n').filter(Boolean);
  const legacy = JSON.stringify({ seq: lines.length, prev: sha(lines.at(-1)!), at: new Date().toISOString(), event: 'callers_switched', runId: JSON.parse(lines.at(-1)!).runId, target: w.name });
  writeFileSync(w.journal, `${lines.join('\n')}\n${legacy}\n`);
  const run = w.begin(); w.lock(run);
  refused(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', run, '--target', w.name], 'caller_history_unusable');
});


test('all receipt consumers reject an incomplete or malformed completion record', { skip }, t => {
  const reused = world(t);
  reused.provision();
  const path = join(reused.root, '.receipts', `${reused.name}.json`);
  const original = JSON.parse(readFileSync(path, 'utf8'));
  const invalid = (receipt: Out) => {
    const { verifiedAt: _verifiedAt, ...withoutTime } = receipt;
    return [withoutTime, { ...receipt, verifiedAt: 'yesterday' }, { ...receipt, extra: true },
      { ...receipt, identityHash: [receipt.identityHash] }];
  };
  const run = reused.begin(); reused.lock(run);
  const reuseProof = reused.checks(run);
  const staging = reused.stage(run);
  for (const value of invalid(original)) {
    writeFileSync(path, JSON.stringify(value));
    assert.equal(reused.state(), 'owned_receipt_corrupt');
    const launched = reused.launches();
    refused(['dest', 'activate', ...reused.P, '--run', run, '--staging', staging, '--execute'], 'target_not_absent');
    assert.equal(reused.launches(), launched, 'invalid completion records are not reused or probed');
    refused(['dest', 'receipt', ...reused.P, '--run', run, '--name', reused.name, '--statement', reuseProof, '--adopt-existing', '--execute'], 'receipt_present');
    assert.equal(existsSync(join(reused.root, '.activate.lock', 'publication.json')), false);
  }
  const active = world(t);
  const owner = active.begin(); active.lock(owner); active.activate(owner);
  const proof = active.checks(owner);
  const result = ok(['dest', 'receipt', ...active.P, '--run', owner, '--name', active.name, '--statement', proof, '--execute']);
  active.record(owner, 'receipt_published', result);
  const completion = join(active.root, '.receipts', `${active.name}.json`);
  const good = readFileSync(completion, 'utf8');
  for (const value of invalid(JSON.parse(good))) {
    writeFileSync(completion, JSON.stringify(value));
    assert.equal(active.state(), 'owned_receipt_corrupt');
    refused(['dest', 'unlock', ...active.P, '--run', owner, '--execute'], 'unreceipted_activation');
    assert.equal(existsSync(join(active.root, '.activate.lock')), true);
  }
  writeFileSync(completion, good);
  active.record(owner, 'lock_released', ok(['dest', 'unlock', ...active.P, '--run', owner, '--execute']));
});

test('publication replay and dry-run completion require staging to remain gone', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run);
  const staging = w.stage(run); w.activate(run, staging);
  const proof = w.checks(run);
  const args = ['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', proof];
  ok([...args, '--execute']);
  const path = join(w.root, '.receipts', `${w.name}.json`), bytes = readFileSync(path, 'utf8');
  mkdirSync(join(w.root, staging), { mode: 0o700 });
  refused([...args, '--execute'], 'receipt_present');
  assert.equal(readFileSync(path, 'utf8'), bytes);
  rmSync(path);
  refused(args, 'publication_target_changed');
  refused([...args, '--execute'], 'publication_target_changed');
  assert.equal(existsSync(path), false);
});


test('a lock with publication evidence cannot reactivate a rolled-back target using the old proof', { skip }, t => {
  const w = world(t);
  const run = w.provision();
  // A second acquisition can recover this existing install without an activation intent.
  w.lock(run);
  const receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  writeFileSync(receiptPath, 'corrupt');
  w.record(run, 'receipt_cleaned', ok(['dest', 'receipt-cleanup', ...w.P, '--run', run, '--name', w.name,
    '--mode', 'remove', '--execute', '--confirm-destructive']));
  const oldProof = w.checks(run);
  ok(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', oldProof, '--execute']);
  rmSync(receiptPath); // Simulate the receipt write being lost after publication intent persistence.
  const noCaller = w.file('no-caller', ok(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', run, '--target', w.name]));
  ok(['dest', 'rollback', ...w.P, '--run', run, '--name', w.name, '--statement', noCaller, '--execute', '--confirm-destructive']);
  const staging = w.stage(run);
  const publication = join(w.root, '.activate.lock', 'publication.json'), bytes = readFileSync(publication, 'utf8');
  refused(['dest', 'activate', ...w.P, '--run', run, '--staging', staging, '--execute'], 'publication_pending');
  assert.equal(existsSync(join(w.root, w.name)), false);
  assert.equal(existsSync(receiptPath), false);
  assert.equal(readFileSync(publication, 'utf8'), bytes);
  // Finishing the acquisition invalidates its proof; a fresh activation needs fresh checks.
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  w.lock(run); w.activate(run, staging);
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', oldProof, '--execute'], 'statement_mismatch');
  w.finish(run);
  assert.equal(w.state(), 'owned_receipted');
});


test('initial receipt dry-run requires every static check before proposing publication', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run);
  const staging = w.stage(run); w.activate(run, staging);
  const proof = w.checks(run);
  const args = ['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', proof];
  const publication = join(w.root, '.activate.lock', 'publication.json'), receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  mkdirSync(join(w.root, staging), { mode: 0o700 });
  const launched = w.launches();
  refused(args, 'verification_failed');
  refused([...args, '--execute'], 'verification_failed');
  assert.equal(w.launches(), launched);
  assert.equal(existsSync(publication), false); assert.equal(existsSync(receiptPath), false);
  rmSync(join(w.root, staging), { recursive: true });
  assert.equal(ok(args).dryRun, true);
  assert.equal(existsSync(publication), false); assert.equal(existsSync(receiptPath), false);
  w.finish(run);
});

test('a retained staging tree blocks final verify and unlock until it is explicitly discarded', { skip }, t => {
  const w = world(t);
  w.provision();
  const run = w.begin(); w.lock(run);
  const staging = w.stage(run);
  const provisioned = ok(['dest', 'activate', ...w.P, '--run', run, '--staging', staging, '--execute']);
  assert.equal(provisioned.outcome, 'already_provisioned'); assert.equal(provisioned.stagingRetained, staging);
  const launched = w.launches();
  const verify = h(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']).out;
  assert.equal(verify.ok, false); assert.equal(verify.checks.stagingGone, false); assert.equal(w.launches(), launched);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'retained_staging_pending');
  refused(['dest', 'activate', ...w.P, '--run', run, '--staging', w.stage(run), '--execute'], 'retained_staging_pending');
  const retained = join(w.root, '.activate.lock', 'retained.json'), original = readFileSync(retained, 'utf8');
  writeFileSync(retained, '{}');
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'retained_staging_unreadable');
  writeFileSync(retained, original);
  assert.equal(ok(['dest', 'discard-staging', ...w.P, '--run', run, '--staging', staging, '--execute']).dryRun, true);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'retained_staging_pending');
  ok(['dest', 'discard-staging', ...w.P, '--run', run, '--staging', staging, '--execute', '--confirm-destructive']);
  assert.equal(ok(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']).ok, true);
  assert.equal(ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']).released, true);
});

test('manifest entries named __proto__ are tracked like any other name', { skip }, t => {
  for (const kind of ['file', 'symlink'] as const) {
    const w = world(t);
    const entry = join(w.tree, '__proto__');
    if (kind === 'file') writeFileSync(entry, 'original'); else symlinkSync('node_modules', entry);
    const run = w.begin(); w.lock(run); w.activate(run);
    const manifest = JSON.parse(readFileSync(join(w.root, w.name, '.session-peer-manifest.json'), 'utf8'));
    assert.equal(Object.hasOwn(kind === 'file' ? manifest.files : manifest.links, '__proto__'), true, kind);
    const installed = join(w.root, w.name, '__proto__');
    if (kind === 'file') writeFileSync(installed, 'changed'); else { rmSync(installed); symlinkSync('node_modules/session-peer', installed); }
    assert.equal(w.state(), 'owned_failed_verification', kind);
    assert.equal(h(['dest', 'verify', ...w.P, '--name', w.name, '--run', run, '--execute']).out.checks.manifest, false, kind);
  }
});

test('the receipt and its directories are synced before success, and an unsynced publication blocks unlock', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const statement = w.checks(run);
  const args = ['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'];
  const trace = join(w.base, 'fsync.log'), receiptPath = join(w.root, '.receipts', `${w.name}.json`);
  // Test hooks only: record each fsync in order, or fail one by path suffix.
  const failing = h(args, { ...process.env, SESSION_PEER_TS_HARNESS_TEST_FSYNC_TRACE: trace, SESSION_PEER_TS_HARNESS_TEST_FSYNC_FAIL: `${w.name}.json` });
  assert.equal(failing.code, 1); assert.equal(failing.out.reason, 'EIO');
  assert.equal(existsSync(join(w.root, '.activate.lock', 'publication.json')), true);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'publication_unsynced');
  rmSync(trace);
  const replay = h(args, { ...process.env, SESSION_PEER_TS_HARNESS_TEST_FSYNC_TRACE: trace }).out;
  assert.equal(replay.ok, true); assert.equal(replay.replayed, true);
  const order = readFileSync(trace, 'utf8').split('\n').filter(Boolean);
  const at = (path: string) => order.indexOf(path);
  const synced = join(w.root, '.activate.lock', 'publication.synced.json');
  for (const path of [receiptPath, join(w.root, '.receipts'), w.root]) assert.ok(at(path) >= 0 && at(path) < at(synced), path);
  w.record(run, 'receipt_published', replay);
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
});

test('a first receipt write syncs the intent, then the receipt and its directories, then the synced marker', { skip }, t => {
  const w = world(t);
  const run = w.begin(); w.lock(run); w.activate(run);
  const statement = w.checks(run);
  const trace = join(w.base, 'fsync.log');
  assert.equal(h(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute'],
    { ...process.env, SESSION_PEER_TS_HARNESS_TEST_FSYNC_TRACE: trace }).out.ok, true);
  const order = readFileSync(trace, 'utf8').split('\n').filter(Boolean);
  const at = (path: string) => order.indexOf(path);
  const lock = join(w.root, '.activate.lock');
  const sequence = [join(lock, 'publication.json'), join(w.root, '.receipts', `${w.name}.json`), join(w.root, '.receipts'), w.root, join(lock, 'publication.synced.json')];
  for (const path of sequence) assert.ok(at(path) >= 0, path);
  assert.deepEqual([...sequence].sort((x, y) => at(x) - at(y)), sequence);
});

test('journal records are written completely and synced before success', { skip }, t => {
  const w = world(t);
  const run = w.begin();
  const before = readFileSync(w.journal);
  const failed = h(['op', 'record', ...w.J, '--run', run, '--event', 'run_ended', '--execute'], { ...process.env, SESSION_PEER_TS_HARNESS_TEST_FSYNC_FAIL: 'journal.jsonl' });
  assert.equal(failed.code, 1); assert.deepEqual(readFileSync(w.journal), before);
  const short = h(['op', 'record', ...w.J, '--run', run, '--event', 'run_ended', '--execute'], { ...process.env, SESSION_PEER_TS_HARNESS_TEST_SHORT_WRITE: '1' });
  assert.equal(short.out.ok, true);
  assert.equal(ok(['op', 'statement', ...w.J, '--kind', 'run-ended', '--run', run]).kind, 'run-ended');
});
