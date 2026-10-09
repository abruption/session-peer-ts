# API reference

This reference describes source/package version **0.3.3 candidate (unpublished at the 2026-10-09 KST preparation checkpoint)**. Public npm `latest` verified at that checkpoint is **0.3.2**, with unchanged `preview=0.1.0-preview.1`. The 0.3.3 install example is conditional on separately approved publication; check `npm view session-peer@0.3.3 version` first. Before publication, use the reviewed candidate source artifact.

[Back to README](../README.md) · [User guide](guide.md)

The package exposes a small ESM API with TypeScript declarations. Install it
locally with `npm install --ignore-scripts session-peer@0.3.3` before importing it.
Importing the package does not execute the CLI or submit a message.

```js
import { VERSION, VERSION_LINE, reply, envelope } from 'session-peer';

console.log(VERSION);      // 0.3.3
console.log(VERSION_LINE); // session-peer 0.3.3 (typescript)
const address = 'session-peer://v1/reply?agent=claude&session=12345&transport=local';
console.log(reply(address)); // { to: '12345' }
console.log(envelope('Please review and reply.', true, address));
```

| Export | Contract |
| --- | --- |
| `VERSION` | Package version string. |
| `VERSION_LINE` | CLI version string including the TypeScript marker. |
| `reply(uri)` | Parse a supported Reply-To URI into `{ to, host?, home? }`; throw on invalid input. Parsing does not discover or authorize the destination. |
| `envelope(text, noFrom, address?, sender?)` | Trim leading/trailing newlines, optionally prepend sender metadata, and append a validated Reply-To URI. `sender` is `{ agent, id }` or `null` for none; when omitted, a valid Codex UUID from the environment is used. Returns text only. |

The example uses a placeholder PID and performs no delivery. These helpers do
not verify a live writer, establish a return route, or confirm consumption.
Only the exports above form the public package API; internal `dist` modules are
not package subpath exports. Use the [CLI guide](guide.md#use) for sending and
[CONTRIBUTING.md](../CONTRIBUTING.md) for development and test setup.


The ordinary SSH response correction is documented separately as the [0.3.3 ordinary SSH response correction](design/ordinary-ssh-responses.md); its internal parser is not a package-root export.
