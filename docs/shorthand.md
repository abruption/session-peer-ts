# Optional `sp` shorthand

The current public package is 0.3.1. This checkout is the unpublished 0.3.2 candidate; the shorthand still forwards to the explicitly selected CLI and does not install or upgrade it.

[README](../README.md) · [User guide](guide.md)

This feature ships with 0.3.0 and later ([#74](https://github.com/abruption/session-peer-ts/issues/74)).
The npm 0.2.1 and earlier archives do **not** contain these activation files;
install 0.3.0 or later, or use a reviewed checkout or its
[locally built tarball](guide.md#build-from-source).

`session-peer` is the canonical command. `sp` is an opt-in alias in your current
Bash/zsh session or PowerShell scope. It resolves the same command on PATH: there
is no second CLI parser, argument reconstruction, `eval`, runtime dispatcher or
extra delivery attempt. Version/help output continues to say `session-peer`.
Keep `session-peer` in scripts, automation, SSH commands and reply instructions.
Windows cmd.exe also uses the canonical command; this feature does not install
an `sp.cmd` launcher.

Only one implementation is assumed installed. Check `session-peer --version`
and your installation manager before enabling the alias. Python and TypeScript
co-installation is outside this feature's scope.

## Checking for the activation files

An installation that reports 0.3.0 or later contains these files. `--version`
alone is not conclusive for a source build, which reports its checkout's
package version. Check for the files in the installed package directory:

```sh
# Global npm installation:
ls "$(npm root --global)/session-peer/shorthand/sp.sh"
# Isolated or project prefix (replace <prefix>):
ls "$(npm root --prefix <prefix>)/session-peer/shorthand/sp.sh"
```

```powershell
Test-Path (Join-Path (npm root --global) 'session-peer/shorthand/sp.ps1')
# Isolated or project prefix (replace <prefix>):
Test-Path (Join-Path (npm root --prefix <prefix>) 'session-peer/shorthand/sp.ps1')
```

A missing file means that installation predates the feature (for example the
0.2.1 archive); its `session-peer` command still works, but `sp` cannot
be activated from it.

## Why activation is explicit

npm owns only the `session-peer` executable. Adding another unconditional npm
`bin` entry would claim the generic `sp` name during installation. Instead, npm
ships activation files and never creates an `sp` executable, changes PATH,
edits a shell profile or runs an installation hook.

The activation file runs **in the shell you source it into**, so it can detect
that shell's aliases and functions as well as commands on PATH. A subprocess
cannot see every alias/function in its parent shell. This is why activation is
not a separate `session-peer install-alias` process. Detection is a snapshot of
that scope/PATH, not a machine-wide reservation; commands added later can still
change resolution. A repeated activation also refuses the already defined `sp`.

## Bash and zsh

Inspect the existing names and read the activation file before sourcing it:

```sh
type -a session-peer
type -a sp
# Reviewed source checkout:
. ./shorthand/sp.sh
sp --version
sp list --agent claude --json
```

`type -a sp` reporting no command is expected when the name is free. The asset
refuses an existing alias, function or executable and also refuses a missing
`session-peer`. It defines only `alias sp='session-peer'`. Quoted arguments,
Unicode, stdin and `--` retain their ordinary shell meaning; message contents
are never evaluated again.

With an npm installation **that contains the new files**, the activation path is:

```sh
# Global npm installation:
. "$(npm root --global)/session-peer/shorthand/sp.sh"
# Or a project-local installation (choose one):
# . ./node_modules/session-peer/shorthand/sp.sh
```

Use this in an interactive Bash/zsh session. Bash disables alias expansion by
default in noninteractive scripts; the asset does not change shell options.
Use canonical `session-peer` in automation. If you want persistence, review and
add the chosen source line yourself to `.bashrc` or `.zshrc` after PATH setup.
A child shell cannot activate an alias in its parent.

To disable it, inspect `alias sp`; if it still points to `session-peer`, run
`unalias sp`. Remove your profile source line too, if you added one. Do not
remove a replacement alias belonging to another tool.

## PowerShell

PowerShell normally already defines `sp` as `Set-ItemProperty`. Activation
intentionally refuses that collision. Inspect **all** matches first:

```powershell
Get-Command session-peer -All
Get-Command sp -All
```

If you decide to give up the built-in alias in this scope, explicitly remove it
only after verifying its definition. Windows PowerShell marks this built-in alias
read-only, so this explicit removal uses `-Force`. Activation never does. This
is a separate user choice:

```powershell
if ((Get-Alias sp -ErrorAction SilentlyContinue).Definition -eq 'Set-ItemProperty') {
    Remove-Item Alias:sp -Force
}
```

Other `sp` commands/functions/aliases must also be resolved by you.

The PowerShell activator detects collisions with `Get-Command sp -ListImported`,
which covers aliases, functions, cmdlets and PATH applications already visible in
the session. It does **not** consider an `sp` command exported by a module that
is installed but not yet imported (module auto-loading). Activation deliberately
does not import modules to find out, because importing runs module code. If you
rely on such a module, check `Get-Command sp -All` (which can auto-load it) and
choose accordingly; once that module is imported, the activator refuses its `sp`.

Then read
and dot-source the activation file (do not invoke it with `&`):

```powershell
# Reviewed source checkout:
. ./shorthand/sp.ps1
sp --version
sp list --agent claude --json
# For a global npm installation containing the new files, use this path instead:
# . (Join-Path (npm root --global) 'session-peer/shorthand/sp.ps1')
```

The alias belongs to the caller's scope. Dot-sourcing inside a function does not
activate it globally. Shell execution policy still applies; activation does not
change it. PowerShell's normal native argument and text-pipeline encoding rules
remain the same for both names. The alias does not add a wrapper around npm's
existing launcher.

To disable only this alias:

```powershell
if ((Get-Alias sp -ErrorAction SilentlyContinue).Definition -eq 'session-peer') {
    Remove-Item Alias:sp
}
```

Remove any activation line you chose to add to `$PROFILE`. A new unmodified
PowerShell session restores its normal built-in aliases.

## Updating, uninstalling and replacing an implementation

Use npm to update an npm-owned runtime as described in the [README](../README.md#update).
An active `sp` alias follows the canonical name on PATH after an in-place npm
update; it does not pin a package version or cache the previous CLI entry point.
After changing prefixes/PATH, check both `session-peer --version` and `sp --version`.

Disable the alias and remove a persistent profile line before running
`npm uninstall --global session-peer` (use your original prefix for a local
installation). npm removes the package and activation files but cannot remove
an alias already loaded into another shell. Such an alias becomes unresolved
when the canonical executable disappears; it does not install a fallback.

When changing between Python and TypeScript, first remove the old implementation
with its own manager, then select the new installation. Do not use npm `--force`
to replace another manager's files. Never silently replace another tool's `sp`.

## Validation boundaries

Package tests compare both names against an isolated installed CLI for
version/help/list/dry-run and argument errors, including exit codes and stdout
and stderr. Shell fixtures check whitespace, Unicode, literal metacharacters,
stdin, `--`, executable/alias/function collisions, missing canonical commands
and deactivation; each fixture shell first proves that its runner reports a
script's own exit code (3), not a 0/1 summary.

The lifecycle fixture runs in every fixture shell: Bash on macOS/Linux, zsh where
present (including macOS), and Windows PowerShell 5.1 on Windows Node 22/24. In an
isolated `--prefix` it installs the packed version, activates `sp`, replaces it
in place with a second, fixture-only version packed from a copy whose
`package.json` version and compiled `VERSION` constant were changed (it sorts
below the original, so this is a version replacement, not a registry upgrade),
and checks that `sp --version` and `session-peer --version` both report the
replacement. It then uninstalls the package and checks that both names fail as
command not found (Bash/zsh exit 127, PowerShell `CommandNotFoundException`) and
that deactivation removes `sp`. Installation and replacement use the same
prefix, so moving the canonical command to another PATH location is not covered.
It never installs globally or edits a profile.

These are isolated fixtures, not live message or ACK evidence. Submission,
ownership, permissions and no-retry-on-unknown contracts remain those of the
canonical CLI.
