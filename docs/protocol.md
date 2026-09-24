# Internal message protocol draft

Status: Stage 0 draft refined by the Phase 1 architecture audit. Private protocol version `1`; it is not a consumer API and has no implementation yet. No generic messaging abstraction or iframe broker is required.

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
| Worker -> host | `result` / `run` | `status` enum `ok`, `program-error`, or `engine-error`; `error` bounded wire error or null; `truncated` boolean; `lastSequence`, `stdoutChars`, `stderrChars` nonnegative safe integers |
| Worker -> host | `fatal` / current op | `code` restricted engine enum (`INITIALIZATION_FAILED`, `RESOURCE_LIMIT`, `RUNTIME_FAILURE`, `PROTOCOL_ERROR`); no raw error object or stack |

The result schema follows [API invariants](api.md#execution-result). Host accumulates accepted stream chunks, calculates duration itself, and constructs stdout/stderr; it does not accept duplicated output strings in `result`. `lastSequence` and channel character totals must exactly match accepted chunks. The final message is sent only after guest cleanup succeeds. Resource/time hook failures are reported as engine outcomes and always invalidate the Worker, even if it happens to respond.

Worker `engine-error` results may contain only `EXECUTION_TIMEOUT`, `RESOURCE_LIMIT`, or `RUNTIME_FAILURE`; cancellation/reset/disposal originate in the controller. An engine-error wire payload contains only `{kind:"engine",code}`. The controller supplies the public engine-error message from its own bounded templates, with no unused Worker-authored message field. Program error fields remain bounded untrusted data; the reported filename must match the admitted diagnostic label. This is a Phase 1 refinement to ADR-007; the public [API result](api.md#execution-result) still has an engine-authored message.

No public `stream` callback exists yet. Internal chunks let the controller preserve output before timeout/cancellation. Chunk size, total text, number of messages, and console-call work are bounded; do not post one unbounded message per log call. A zero-output program emits no stream messages.

`fatal` during module-load failure may never be possible because the adapter has not started; the host also handles Worker errors and boot timeout. An idle Worker fault is detected through Worker error/messageerror; there is no unauthenticated unsolicited ready/fatal state transition.

## Field types, sizes, and failure ownership

No payload field is optional in version 1. Public optional request fields are resolved to concrete validated values **before** the host sends `run`. No wire array, binary buffer, native Error, arbitrary nested value, or additional key is allowed. All string lengths are UTF-16 code units; use the central [limit keys](limits.md#categories), not independent protocol constants.

| Message | Required field types | Size/range policy | On invalid current-operation message |
| --- | --- | --- | --- |
| Common envelope | `protocolVersion` literal integer `1`; `generation`, `requestId` positive safe integers; `op`, `type` exact enum strings; `payload` exact plain record | Whole JSON string `<= messageChars`; exact six envelope keys | Host: `PROTOCOL_ERROR`/invalidate or boot failure; Worker: `fatal` if able, otherwise host watchdog handles it |
| `init` host -> Worker | `policyVersion` bounded string; `limits` fixed flat record of positive safe integer values defined by policy | `policyVersion <= runtimeInfoChars`; numeric policy validated and hash/version matched by Worker | Worker cannot mark ready; host boot fails and partial Worker is terminated |
| `ready` Worker -> host | Six bounded strings: `runtimeName`, `runtimeVersion`, `bindingVersion`, `variant`, `executionProfile`, `policyVersion` | Each `<= runtimeInfoChars`; expected manifest/profile/policy equality; boot ID/generation exact | Boot fails; terminate partial Worker, enter `failed` or fail current recovery |
| `run` host -> Worker | `source`, `filename` strings; `executionBudgetMs` positive safe integer | Source/filename admission limits plus wire budget; budget no larger than current host allowance | Worker must not create guest; host treats response/silence as infrastructure failure |
| `stream` Worker -> host | `sequence` positive safe integer; `channel` exact enum; `text` nonempty string | `text <= streamChunkChars`; total and count within stdout/stderr/combined/message quotas; sequence exactly prior + 1 | Active run `PROTOCOL_ERROR`, terminate/recover; no unvalidated append |
| `result` Worker -> host | `status` enum; `error` null or exact bounded tagged record; `truncated` boolean; `lastSequence`, `stdoutChars`, `stderrChars` nonnegative safe integers | Error name/message/stack/label each field cap; result/message caps; totals exactly accepted chunks; status/error invariant | Active run `PROTOCOL_ERROR`, terminate/recover; never resolve with received object |
| `fatal` Worker -> host | `code` one of four documented engine codes; no guest text | Whole message cap and exact current boot/run identity | Treat as infrastructure failure, terminate; host maps public code from trusted template |

For a program error, `error` has exactly `{kind:"program",name,message,stack,filename}` with bounded strings, `stack` string or null, and `filename` identical to the admitted label. For a Worker-authored engine result, `error` has exactly `{kind:"engine",code}`; the host validates the allowed code and constructs its own bounded public message. `ok` has null error. A Worker may not report `CANCELLED`, `RESET`, `DISPOSED`, or `WORKER_FAILURE`, because those are host-observed/controller decisions. `durationMs`, `stdout`, and `stderr` are never accepted from the Worker as final public fields.

The `limits` record must use exactly the named policy fields and an agreed version/hash; this is not an arbitrary user-supplied configuration object. Bootstrap and result caps must be derived so the largest valid payload can fit `messageChars`; [policy consistency](limits.md#policy-consistency) is an initialization gate. Unknown numeric values, negative values, `NaN`/infinity (not valid JSON numbers), strings where numbers are expected, and all arrays/nested objects beyond the exact schema fail validation.

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

## Invalid, duplicate, and late message outcomes

| Received situation | Outcome before any public state mutation |
| --- | --- |
| Unknown `type`/`op` or unsupported version from current Worker | `PROTOCOL_ERROR`; terminate Worker, settle current run or fail boot, one recovery only for an established runtime |
| Malformed JSON, wrong primitive, wrong fields/nesting, or oversized current message | Same protocol failure; no uncaught handler exception |
| Former Worker/generation, including its error/timer callback | Ignore **before parsing** and before output/timer/metadata changes |
| Retired request ID in current generation, including duplicate result/stream/ready | Ignore; a completed operation cannot settle twice |
| Future/never-issued request ID or future generation from current Worker | Protocol failure; never attach it to a newer run |
| Valid identity but wrong phase/order (`result` before run, `ready` during run, skipped/repeated sequence) | Protocol failure while active; unexpected idle current-generation data invalidates the Worker |
| Final result with inconsistent output totals, wrong label, status/error mismatch, or forbidden engine code | Protocol failure and invalidation; host constructs only a bounded engine failure |
| Host `messageerror` or Worker `error` event | `WORKER_FAILURE`, boot failure, or idle recovery depending current state; event details do not cross public API |

The dedicated Worker port gives a specific event source; a serialized `generation` value alone is not authentication. Every callback checks the captured Worker identity and controller generation before touching current state. The adapter copies only the generation/ID sent by the controller and rejects an out-of-order host command. A compromised trusted Worker/adapter remains inside the threat model as a residual risk, not something JSON validation can fully contain.

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
