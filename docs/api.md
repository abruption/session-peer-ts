# API reference

[Back to README](../README.md) · [User guide](guide.md)

The package exposes a small ESM API with TypeScript declarations. Install it
locally with `npm install --ignore-scripts session-peer@0.2.0` before importing it.
Importing the package does not execute the CLI or submit a message.

```js
import { VERSION, VERSION_LINE, reply, envelope } from 'session-peer';

console.log(VERSION);      // 0.2.0
console.log(VERSION_LINE); // session-peer 0.2.0 (typescript)
const address = 'session-peer://v1/reply?agent=claude&session=12345&transport=local';
console.log(reply(address)); // { to: '12345' }
console.log(envelope('Please review and reply.', true, address));
```

| Export | Contract |
| --- | --- |
| `VERSION` | Package version string. |
| `VERSION_LINE` | CLI version string including the TypeScript marker. |
| `reply(uri)` | Parse a supported Reply-To URI into `{ to, host?, home? }`; throw on invalid input. Parsing does not discover or authorize the destination. |
| `envelope(text, noFrom, address?)` | Trim leading/trailing newlines, optionally prepend valid Codex sender metadata from the environment, and append a validated Reply-To URI. Returns text only. |

The example uses a placeholder PID and performs no delivery. These helpers do
not verify a live writer, establish a return route, or confirm consumption.
Only the exports above form the public package API; internal `dist` modules are
not package subpath exports. Use the [CLI guide](guide.md#use) for sending and
[CONTRIBUTING.md](../CONTRIBUTING.md) for development and test setup.
