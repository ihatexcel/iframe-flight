# iframe-flight

High-performance data transport between a parent window and an embedded iframe. Ships Apache Arrow — no additional dependencies required.

**[Live demo](https://ihatexcel.github.io/iframe-flight/)**

## Features

- **Zero-copy transfers** via `SharedArrayBuffer` when COOP/COEP headers are present, with automatic fallback to standard `postMessage`
- **Apache Arrow bundled** — create and send columnar tables without a separate Arrow import
- **Handshake protocol** with configurable timeout and state lifecycle
- **Message deduplication** and optional TTL expiry
- **Two listening modes** — `CONTINUOUS` (latest-wins with optional debounce) or `FIRST_MESSAGE` (one-shot with manual resume)
- **Full TypeScript** types included

## Installation

```bash
npm install iframe-flight
```

## Quick start

**Parent window**

```ts
import { ArrowParentEmitter, tableFromArrays, tableToIPC } from 'iframe-flight';

const emitter = new ArrowParentEmitter(
  document.getElementById('my-iframe') as HTMLIFrameElement,
  { allowedOrigins: ['https://your-app.com'] }
);

emitter.onReady(async () => {
  // send() picks the best format automatically:
  //   Uint8Array + SharedArrayBuffer available → zero-copy
  //   Uint8Array + no SharedArrayBuffer       → postMessage copy
  //   anything else                           → JSON
  const table = tableFromArrays({
    id:    [1, 2, 3],
    name:  ['Alice', 'Bob', 'Charlie'],
    score: [95.5, 87.3, 92.1],
  });

  const ack = await emitter.send(tableToIPC(table));
  console.log(`rows=${ack.rows}  zeroCopy=${ack.isZeroCopy}`);
});
```

**Child iframe**

```ts
import { ArrowChildReceiver, ListenMode } from 'iframe-flight';

const receiver = new ArrowChildReceiver({
  listenMode:    ListenMode.CONTINUOUS,
  allowedOrigins: ['https://your-app.com'],
});

receiver.onData((result) => {
  if (result.format === 'json') {
    console.log(result.data);
  } else {
    // Apache Arrow Table — zero-copy if SharedArrayBuffer was available
    console.log(result.table, result.isZeroCopy);
  }
});
```

## API

### `ArrowParentEmitter(iframe, config?)`

| Method | Description |
|---|---|
| `send(data, opts?)` | Auto-selects the best format — **recommended** |
| `sendArrowZeroCopy(buf, opts?)` | Arrow IPC via `SharedArrayBuffer` (zero-copy ⚡) |
| `sendArrowCopy(buf, opts?)` | Arrow IPC via `postMessage` |
| `sendJSON(data, opts?)` | Any JSON-serialisable value |
| `onReady(cb)` | Fires once the handshake completes |
| `onStateChange(cb)` | `cb(newState, oldState)` on every transition |
| `onError(cb)` | Handshake timeout, ACK timeout, version mismatch |
| `isReady()` | `true` when state is `READY` |
| `isSABSupported()` | `true` if `SharedArrayBuffer` is available |
| `getState()` | Current state string |
| `close()` | Reject pending ACKs and release resources |

**Config options**

| Option | Default | Description |
|---|---|---|
| `handshakeTimeout` | `5000` | ms before giving up on the initial handshake |
| `ackTimeout` | `3000` | ms to wait for a `DATA_RECEIVED` acknowledgement |
| `allowedOrigins` | `['*']` | Restrict which origins are accepted |
| `sourceId` | auto | Identifier included in every message |

### `ArrowChildReceiver(config?)`

| Method | Description |
|---|---|
| `onData(cb)` | `cb(result)` — `result.table` for Arrow, `result.data` for JSON |
| `onStateChange(cb)` | `cb(newState, oldState)` |
| `onError(cb)` | Parse errors, version mismatches |
| `resumeListening()` | Re-enable after `FIRST_MESSAGE` mode |
| `isReady()` / `getState()` | Same states as the emitter |
| `close()` | Clear buffer, stop intervals |

**Config options**

| Option | Default | Description |
|---|---|---|
| `listenMode` | `CONTINUOUS` | `CONTINUOUS` or `FIRST_MESSAGE` |
| `listenDelay` | `0` | Debounce in ms (`CONTINUOUS` only — keeps only the latest) |
| `allowedOrigins` | `['*']` | Restrict which origins are accepted |

### Listen modes

```ts
import { ListenMode } from 'iframe-flight';

// CONTINUOUS — keeps listening, processes only the latest message.
// Use listenDelay to debounce rapid sends.
new ArrowChildReceiver({ listenMode: ListenMode.CONTINUOUS, listenDelay: 100 });

// FIRST_MESSAGE — processes one message then pauses.
// Call resumeListening() when ready for the next one.
const receiver = new ArrowChildReceiver({ listenMode: ListenMode.FIRST_MESSAGE });
receiver.onData(async (result) => {
  await render(result.table);
  receiver.resumeListening();
});
```

### Apache Arrow re-exports

Apache Arrow is bundled and re-exported so you only need one import:

```ts
import {
  tableFromArrays,
  tableToIPC,
  tableFromIPC,
  Table,
  Schema,
} from 'iframe-flight';
```

### Send options

All send methods accept a common options object:

```ts
await emitter.send(data, {
  format:        'auto',        // 'auto' | 'arrow-zerocopy' | 'arrow-copy' | 'json'
  correlationId: 'req-42',      // trace requests end-to-end
  ttl:           30_000,        // discard if not processed within 30 s
  priority:      1,             // passed through to the receiver
  schema:        table.schema.toString(),
});
```

### Zero-copy requirements

`SharedArrayBuffer` requires both pages to be served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`isSABSupported()` returns `false` when these headers are absent. `send()` falls back to copy mode automatically.

## State lifecycle

```
INIT → CONNECTING → READY ⇄ SENDING / RECEIVING → CLOSED
                        ↘ ERROR
```

Use `onStateChange` to observe transitions:

```ts
emitter.onStateChange((next, prev) => {
  console.log(`${prev} → ${next}`);
});
```

## Browser support

| Feature | Requirement |
|---|---|
| Copy mode (JSON / Arrow copy) | All modern browsers |
| Zero-copy (`SharedArrayBuffer`) | Chrome 68+, Firefox 79+, Safari 15.2+ with COOP/COEP headers |

## License

MIT
