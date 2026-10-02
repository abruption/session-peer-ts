// Test-only preload. CLI children never query the real tailnet and never pick
// up the invoking agent's sender identity or reply-host settings; fixtures that
// need an identity set it explicitly.
process.env.SESSION_PEER_TAILSCALE = 'off';
for (const key of ['CLAUDE_CODE_MESSAGING_SOCKET', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'SESSION_PEER_REPLY_HOST', 'CC_PEER_REPLY_HOST']) delete process.env[key];
