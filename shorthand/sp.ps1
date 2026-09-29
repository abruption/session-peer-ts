# Dot-source this file to opt in in the caller's current PowerShell scope.
if ($MyInvocation.InvocationName -ne '.') {
    throw 'Dot-source this file to activate sp in the current scope.'
}
if (Get-Command sp -ErrorAction SilentlyContinue) {
    throw 'sp already exists; inspect Get-Command sp -All before choosing a name.'
}
if (-not (Get-Command session-peer -ErrorAction SilentlyContinue)) {
    throw 'session-peer is not available; select its installation on PATH first.'
}
Set-Alias -Name sp -Value session-peer -Scope Local -ErrorAction Stop
