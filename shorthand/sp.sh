# Source this file in an interactive Bash or zsh session to opt in.
# No profile edits, PATH changes, argument reconstruction or external launcher.
if command -v sp >/dev/null 2>&1; then
  printf '%s\n' 'sp already exists; inspect it with type -a sp before choosing a name.' >&2
  return 1
fi
if ! command -v session-peer >/dev/null 2>&1; then
  printf '%s\n' 'session-peer is not available; select its installation on PATH first.' >&2
  return 1
fi
alias sp='session-peer'
