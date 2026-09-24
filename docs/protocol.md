# Internal message protocol draft

Status: Stage 0. Private protocol version `1`; it is not a consumer API and has no implementation yet. No generic messaging abstraction or iframe broker is required.

## Transport and envelope

Use the private channel of the dedicated Worker object the engine created. The host registers handlers on that object, not a global `window.message` listener. Listeners capture Worker identity and runtime generation. Guest programs do not receive `postMessage` or native object references.

Send a single JSON **string** per message. This intentionally narrow encoding supports a pre-parse character bound and avoids arbitrary structured-clone objects, transferables, cyclic values, prototypes, and raw Errors. String length is checked before `JSON.parse`. It does not prevent the browser allocating/copying the received string before the handler runs; bounded trusted senders and finite message counts are also required. A fully compromised native adapter could still overwhelm the browser; this is a documented boundary limit.

```ts
type Envelope = {
  protocolVersion: 1;
  generation: number; // positive safe integer, issued by host
  requestId: number;  // positive safe integer, issued by host
  op: "initialize" | "run";
  type: "init" | "ready" | "run" | "stream" | "result" | "fatal";
  payload: object;    // exact per-message schema below, no arbitrary fields
};
```

Both counters increase without reuse for the lifetime of an engine. A new Worker always receives a fresh generation. Boot/recovery operations also have request IDs. Before counter exhaustion, fail closed with `RUNTIME_FAILURE` and require a new engine instance; never wrap to a previously used ID. IDs are correlation values, not secrets or authentication tokens.

## Grammar

| Direction | Type / op | Exact payload fields and meaning |
| --- | --- | --- |
| Host -> Worker | `init` / `initialize` | `policyVersion` string; `limits` fixed numeric policy record; no guest code or URLs |
| Worker -> host | `ready` / `initialize` | `runtimeName`, `runtimeVersion`, `bindingVersion`, `variant`, `executionProfile`, `policyVersion` bounded strings matching expected manifest |
| Host -> Worker | `run` / `run` | `source`, `filename` strings; `executionBudgetMs` positive safe integer no larger than accepted host budget |
| Worker -> host | `stream` / `run` | `sequence` positive safe integer; `channel` exactly `stdout` or `stderr`; `text` nonempty bounded string |
| Worker -> host | `result` / `run` | `status` enum `ok`, `program-error`, or `engine-error`; `error` bounded public-shaped error or null; `truncated` boolean; `lastSequence`, `stdoutChars`, `stderrChars` nonnegative safe integers |
| Worker -> host | `fatal` / current op | `code` restricted engine enum (`INITIALIZATION_FAILED`, `RESOURCE_LIMIT`, `RUNTIME_FAILURE`, `PROTOCOL_ERROR`); no raw error object or stack |

The result schema follows [API invariants](api.md#execution-result). Host accumulates accepted stream chunks, calculates duration itself, and constructs stdout/stderr; it does not accept duplicated output strings in `result`. `lastSequence` and channel character totals must exactly match accepted chunks. The final message is sent only after guest cleanup succeeds. Resource/time hook failures are reported as engine outcomes and always invalidate the Worker, even if it happens to respond.

Worker `engine-error` results may contain only `EXECUTION_TIMEOUT`, `RESOURCE_LIMIT`, or `RUNTIME_FAILURE`; cancellation/reset/disposal originate in the controller. The controller supplies the public engine-error message from its own bounded templates rather than trusting Worker error text. Program error fields remain bounded untrusted data; the reported filename must match the admitted diagnostic label.

No public `stream` callback exists yet. Internal chunks let the controller preserve output before timeout/cancellation. Chunk size, total text, number of messages, and console-call work are bounded; do not post one unbounded message per log call. A zero-output program emits no stream messages.

`fatal` during module-load failure may never be possible because the adapter has not started; the host also handles Worker errors and boot timeout. An idle Worker fault is detected through Worker error/messageerror; there is no unauthenticated unsolicited ready/fatal state transition.

## Why there are no cancel/reset/dispose messages

The host performs these operations by revoking generation and terminating/replacing the Worker. A busy Worker cannot reliably process a cancellation message. A cooperative stop acknowledgment is neither necessary nor sufficient. `ready` after reset/recovery is the new Worker's `initialize` response. Ordinary program errors belong in `result`; `fatal` is an infrastructure signal.

## Validation order

1. Check the event came from the active Worker listener/generation. Immediately ignore events from revoked Workers, including `error`/`messageerror` and stale timers. Do not parse them or clear any current state.
2. Check primitive string type and `messageChars` before parsing; catch parse failures. Reject unexpected `ports`/transferables and wrong event shape.
3. Require a non-null plain record with exactly the envelope fields. Reject arrays, unknown/prototype-related keys and unsupported protocol versions. Never merge arbitrary received data into engine objects.
4. Validate identity fields as finite positive safe integers. Compare both generation and request ID against the expected active operation. A lower, previously retired identity is ignored; an impossible future identity or never-issued/mismatched current identity is a protocol error. Never accept a matching request ID from a different generation.
5. Validate direction, operation, type, and current phase. A `ready` for a run, a run result before admission, or a stream after completion cannot transition state. Replays from a completed identity are ignored without side effects.
6. Validate exact payload fields, primitive types, string lengths, allowed enums, numeric ranges, totals, result/error consistency, and stream sequencing. Arrays are not used by this protocol; reject all unexpected arrays. Bound object field counts/nesting to the exact schema; a message-size bound limits parsing cost even before shape inspection.
7. Only then append output, complete the operation, or change lifecycle. Whitelist constructed public data rather than returning the received object.

The Worker applies the same shape, size, identity, direction, and phase validation to host inputs. Unknown operations fail closed. Malformed data on an active/current channel causes `PROTOCOL_ERROR`, invalidation, and at most one recovery; it must not throw out of the host event handler or leave a promise pending. Do not echo arbitrary malformed text in diagnostics.

## Stale-response invariant

```text
generation 1 / request 10: Run A
host cancels A -> revoke generation 1 -> terminate Worker A
generation 2 / request 11: replacement boot
generation 2 / request 12: Run B
late event from generation 1 / request 10 -> ignore before mutation
```

The counter values are illustrative. Revocation may consume an additional generation value; equality and non-reuse are what matter. Stale events cannot resolve/reject B, append its output, cancel its timer, clear busy, publish a misleading error, or update runtime metadata. The same checks apply to asynchronous asset/initialization completions and callbacks, not merely successful `result` messages.

Tests must deliberately deliver a stale `ready`, stream, result, fatal/error event, and timeout after a new run starts; compare state, active timer, output, result, and settlement count. Duplicate messages and wrong/future IDs have separate expected behavior, as specified above.
