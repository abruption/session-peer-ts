// Darwin/Linux-local fixtures for scripts/deployment-harness.mjs (#23). They
// exercise the harness state machine on private temp prefixes with a tree
// assembled from this checkout and a local ssh stand-in. They are not
// destination evidence: no OpenSSH, no remote account and no published tarball.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

function h(args: string[], env: NodeJS.ProcessEnv = process.env): { code: number | null; out: Out } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60000, env });
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
  const identityFile = join(base, 'identity.json');
  const identity = ok(['dest', 'identity', '--version', JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
    '--package-sha256', sha('prepared-tree fixture'), '--lock-integrity', integrity]);
  writeFileSync(identityFile, JSON.stringify(identity));
  const label = ok(['op', 'init', '--journal', journal, '--dest-alias', 'fixture-dest', '--execute']).operatorLabel as string;
  const P = ['--prefix', prefix], J = ['--journal', journal];
  const file = (name: string, value: unknown) => { const path = join(base, `${name}-${Math.random().toString(16).slice(2)}.json`); writeFileSync(path, JSON.stringify(value)); return path; };
  const record = (run: string, event: string, value?: unknown, target?: string) =>
    ok(['op', 'record', ...J, '--run', run, '--event', event, '--execute', ...(value ? ['--file', file(event, value)] : []), ...(target ? ['--target', target] : [])]);
  const begin = () => ok(['op', 'begin', ...J, '--execute']).runId as string;
  const stage = (run: string) => ok(['dest', 'stage', ...P, '--run', run, '--identity', identityFile, '--from-tree', tree, '--execute']).staging as string;
  const lock = (run: string) => record(run, 'lock_acquired', ok(['dest', 'lock', ...P, '--run', run, '--operator-label', label, '--execute']));
  const cli = (args: string[]) => {
    const result = spawnSync(process.execPath, [join(repo, 'dist/cli.js'), ...args, '--host', 'dest.example', '--remote-bin', join(prefix, 'data/session-peer-ts', name, 'session-peer'), '--json'],
      { encoding: 'utf8', timeout: 60000, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: opDir, SESSION_PEER_TAILSCALE: 'off', CLAUDE_CONFIG_DIR: join(opDir, '.claude'), SESSION_PEER_CODEX_HOMES: '[]' } });
    return JSON.parse(result.stdout);
  };
  // Destination verification, then operator doctor and dry-run over the stand-in.
  const checks = (run: string) => {
    record(run, 'verified', ok(['dest', 'verify', ...P, '--name', name]));
    record(run, 'operator_doctor', cli(['doctor']), name);
    record(run, 'operator_dry_run', cli(['send', '--to', '999999', '--message', 'synthetic deployment check', '--dry-run']), name);
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
  return { base, prefix, root, journal, label, name, P, J, file, record, begin, stage, lock, activate, checks, finish, provision, state, bin };
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
  assert.equal(ok(['dest', 'probe', ...w.P, '--name', staging]).nativeLock, 'loaded');
  w.activate(run, staging);
  refused(['dest', 'unlock', ...w.P, '--run', run, '--execute'], 'unreceipted_activation');
  refused(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--execute'], 'statement_missing');
  w.record(run, 'verified', ok(['dest', 'verify', ...w.P, '--name', w.name]));
  refused(['op', 'statement', ...w.J, '--kind', 'operator-checks-passed', '--run', run, '--target', w.name], 'operator_checks_incomplete');
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'operator_doctor', '--target', w.name, '--file', w.file('bad', { ok: false }), '--execute'], 'operator_check_failed');
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'callers_switched', '--target', w.name, '--execute'], 'switch_before_receipt');
  const statement = w.checks(run);
  const receipt = ok(['dest', 'receipt', ...w.P, '--run', run, '--name', w.name, '--statement', statement, '--execute']);
  assert.equal(receipt.receipt.runId, run); assert.equal(receipt.recovery, false);
  w.record(run, 'receipt_published', receipt);
  refused(['op', 'record', ...w.J, '--run', run, '--event', 'callers_switched', '--target', w.name, '--execute'], 'switch_before_unlock');
  w.record(run, 'lock_released', ok(['dest', 'unlock', ...w.P, '--run', run, '--execute']));
  w.record(run, 'callers_switched', undefined, w.name);
  assert.equal(w.state(), 'owned_receipted');
  // A second run of the same identity reuses the receipt and changes nothing.
  const again = w.begin(); w.lock(again);
  const second = ok(['dest', 'activate', ...w.P, '--run', again, '--staging', w.stage(again), '--execute']);
  assert.equal(second.outcome, 'already_provisioned');
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
  w.record(w.begin(), 'callers_switched', undefined, w.name);
  const retire = w.begin(); w.lock(retire);
  refused(['op', 'statement', ...w.J, '--kind', 'no-caller', '--run', retire, '--target', w.name], 'configured_for_caller');
  refused(['dest', 'retire', ...w.P, '--run', retire, '--name', w.name, '--execute', '--confirm-destructive'], 'configured_for_caller_or_unconfirmed');
  w.record(retire, 'callers_unswitched', undefined, w.name);
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
  const verify = h(['dest', 'verify', ...w.P, '--name', w.name]);
  assert.equal(verify.code, 1); assert.equal(verify.out.checks.manifest, false);
  ok(['dest', 'destroy-prefix', ...w.P, '--execute', '--confirm-destructive']);
  assert.equal(existsSync(w.prefix), false);
});
