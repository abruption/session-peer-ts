# session-peer-mcp

Optional stdio tools for the matching TypeScript session-peer CLI. Install this
package with the exact core peer dependency shown in `package.json`. For a
source candidate, install the two reviewed tarballs in the same isolated npm
prefix. Installing the ordinary core alone does not load the MCP SDK.

Run `session-peer-mcp` to allow local Claude listing. Start it with
`--policy /absolute/path/policy.json` to select an explicit operator policy.
A missing or invalid selected file prevents startup. The repository's
`session-peer-ts` plugin starts with the same local-list-only default.
A send-capable host configuration must explicitly supply the policy path.
Host permission prompts and SSH host trust still apply.

```json
{
  "schemaVersion": 1,
  "destinations": [
    { "id": "local", "transport": "local", "agents": ["claude"], "capabilities": ["list"] },
    { "id": "worker", "transport": "ssh", "host": "user@worker",
      "remotePlatform": "posix", "codexHome": "/absolute/codex/home",
      "agents": ["codex"], "capabilities": ["list", "send"] }
  ]
}
```

Set `remotePlatform` to `win32` for a Windows destination. Each Codex
destination needs a pinned absolute home on that destination. A Reply-To URI
can specify a target only when its transport, host, agent, and home match
the chosen policy destination. A Codex URI must include its home. Sends,
including dry-runs, need `send` permission. Listings select permitted agents
only. No supplied message or URI changes the policy or creates an outgoing
return route.

The server runs at most two concurrent operations, limits stdin frames to
128 KiB, limits each worker result to 512 KiB and uses a 110-second operation
deadline. The caller receives structured JSON and its text equivalent.
A partial list can preserve healthy rows. On interruption after a possible
send, reconcile the unknown outcome without automatically resending.
Message text travels through the private worker stdin pipe. The core's
existing native adapters still apply, including the Codex queue argument.
On Windows cleanup covers known direct child handles. Closing a local SSH
connection does not establish that a remote process stopped.
