# Public API draft

Status: Stage 0 draft retained by the Phase 1 audit, not an implementation or stable published release. Consumers use only `JavaScriptEngine`, public data types, and `EngineError`; Workers, QuickJS handles, generations, and protocols are private. Breaking contract changes before the first release must update this document and the decisions log.

## Surface

The following notation describes types; it does not require TypeScript consumers or introduce source implementation.

```ts
class JavaScriptEngine {
  constructor();
  initialize(): Promise<void>;
  run(request: RunRequest): Promise<ExecutionResult>;
  cancel(): Promise<void>;
  reset(): Promise<void>;
  dispose(): void;

  isReady(): boolean;
  isBusy(): boolean;
  getState(): EngineState;
  getRuntimeInfo(): Readonly<RuntimeInfo>;
}

type EngineState =
  | "created" | "initializing" | "ready" | "busy"
  | "recovering" | "failed" | "disposed";

type RunRequest = {
  source: string;
  filename?: string;   // default: "input.js"; diagnostic label only
  timeoutMs?: number;  // positive safe integer, within engine policy
};
```

No constructor injection of arbitrary host functions, native values, worker URLs, or network capabilities. Default runtime assets resolve relative to the installed library. If real consumer bundling tests demonstrate a need for an asset-base option, add a separately reviewed trusted deployment option before release; never take asset locations from guest source or filenames.

## Validation and admission

Accept a plain data record containing only the documented own fields, with no accessor properties. Do not coerce source, filename, or numbers. Empty source is valid. Reject unknown fields, `null`, arrays, wrong types, non-finite/fractional/out-of-range timeouts, and over-limit strings. Source and filename sizes use UTF-16 code units (`string.length`). Reject NUL in source because C string conversion must not silently execute a prefix; other invalid JavaScript reaches the runtime as a program syntax error. Filenames must be nonempty and contain no NUL, control characters, or line separators. They may contain Unicode and path-like text but confer no loading capability.

Validate shallow shape and lengths before encoding, parsing, allocation in QuickJS, or posting to a Worker. Repeat wire validation in the Worker. A malicious host caller using a Proxy is outside the guest threat boundary; browser JavaScript cannot guarantee harmless inspection of arbitrary same-realm proxies.

In `disposed`, reject `DISPOSED` first. Otherwise validate the request, then check state: `busy` rejects `BUSY`; any other non-ready state rejects `NOT_READY`. Rejected requests never allocate an admitted operation, alter the current run, or trigger recovery. There is no implicit initialization and no run queue. Lifecycle call behavior and concurrency are fully defined in [architecture](architecture.md#operation-semantics-and-races).

## Execution semantics

Initial profile identifier: `script-sync-v1`.

- Evaluate one ECMAScript **Script** in a fresh QuickJS global environment. Do not wrap it in an async function, rewrite it, transpile it, or silently change it into a module. Script strictness follows its own directives; a top-level `return` is a syntax error.
- Source is compiled internally by QuickJS to its private bytecode and interpreted. Callers supply source only. No native browser execution, Node.js APIs, TypeScript, JSX, HTML, or imported bytecode.
- `console.log`, `console.info`, and `console.debug` append to stdout; `console.warn` and `console.error` append to stderr. Each call joins bounded representations with a space and appends `\n`. No DevTools formatting, substitution specifiers, object inspection, or other console methods are promised.
- Console primitive values have bounded text representations. Objects/functions use fixed opaque labels without invoking `toJSON`, getters, proxy traps, custom `toString`, or recursive inspection. Strings must be sliced inside the guest before copying potentially huge values to host memory. See [limits](limits.md).
- The script completion value is ignored, including object/function/Promise values. There is no `value` field in the result, and `console.error()` alone does not change success into failure.
- Execution ends when synchronous evaluation and bounded normalization/cleanup finish. **Promise jobs are not drained or awaited.** Promise executors and the synchronous prefix of async functions may run because they are language behavior. Their queued continuations are discarded with the guest runtime. This profile does not support async programs or detect all detached/unhandled Promise rejections. `run()` is asynchronous because transport/lifecycle are asynchronous, not because it provides a guest event loop.
- No timers, I/O, module loader, static imports/exports, top-level await, CommonJS, packages, or files. Static module syntax fails in Script parsing. Dynamic `import()` has no loader and cannot fetch; its rejection may be a discarded Promise under this profile.
- Guest `eval` and `Function` stay within QuickJS and the same limits. They cannot recover host globals. Standard `Date` and `Math.random` may be available; repeated program output is not guaranteed deterministic.
- Every run starts with clean guest globals. A previous run's variables, modified prototypes, errors, and pending jobs do not survive. Normal runs may reuse the trusted Worker/WASM allocation; `reset()` recreates those too.

Examples of intended semantics:

| Source | Outcome |
| --- | --- |
| `console.log("Hello World")` | `ok`, stdout `Hello World\n` |
| `console.error("warning")` | `ok`, stderr `warning\n` |
| `missingName()` | `program-error`, normalized `ReferenceError` |
| `let =` | `program-error`, normalized `SyntaxError` |
| `for (;;) {}` | `engine-error`, `EXECUTION_TIMEOUT`, Worker replaced |
| `Promise.resolve().then(() => console.log("later"))` | Synchronous evaluation succeeds; no `later` output in `script-sync-v1` |
| `globalThis.x = 1` then a separate run of `console.log(typeof x)` | Second run prints `undefined\n` |

Promise scheduling is an explicit future API-profile decision. Supporting it requires deadlines across job draining, completion rules for pending promises, and rejection tracking; the chosen binding's pending-job API alone does not report all async errors. [Pinned pending-job implementation and documentation](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/quickjs-emscripten-core/src/runtime.ts)

## Execution result

```ts
type ExecutionResult = {
  status: "ok" | "program-error" | "engine-error";
  stdout: string;
  stderr: string;
  durationMs: number;
  error: ProgramErrorData | EngineErrorData | null;
  truncated: boolean;
};

type ProgramErrorData = {
  kind: "program";
  name: string;       // e.g. SyntaxError, TypeError, or ThrownValue
  message: string;
  stack: string | null;
  filename: string;
};

type EngineErrorData = {
  kind: "engine";
  code: EngineErrorCode;
  message: string;    // bounded engine-authored text
};
```

Invariants: `ok` has `error: null`; `program-error` has `error.kind: "program"`; `engine-error` has `error.kind: "engine"`. All fields are present; there are no raw `Error` objects, handles, cyclic values, transferred buffers, or host stack traces. Every string and the aggregate result are bounded. Callers receive data snapshots, never mutable engine state.

`durationMs` is a finite nonnegative host-measured elapsed duration from admission through the selected terminal outcome, including transport/formatting, excluding subsequent recovery. It is elapsed time, not CPU time. Rejected requests have no result/duration. Browser suspension may increase elapsed time and does not create a real-time guarantee.

`truncated` means at least one retained output/error text field lost content to its limit. Output can be incomplete after hard termination even when `truncated` is false: only chunks already validated by the host are retained. No final flush acknowledgment is required for cancellation. Output is plain untrusted text, never sanitized HTML.

There is deliberately no `exitCode`: ECMAScript evaluation has no OS process exit convention. Applications can map statuses to their own presentation. Error information is separate from stderr and is not automatically duplicated there.

## Program errors versus engine errors

An admitted run always resolves to an `ExecutionResult`, including cancellation, reset, disposal, and infrastructure failure. An ordinary syntax/runtime exception produces `program-error`; arbitrary thrown values are represented as bounded `ThrownValue` data. Error getters and formatting may execute guest code, so normalization stays inside the execution deadline and memory budget. If trustworthy bounded extraction is impossible, use an engine-authored fallback, not host object traversal.

Validation/state failures *before admission* and failed lifecycle operations reject with the public `EngineError` class. It extends `Error`, has `name: "EngineError"`, `kind: "engine"`, and a documented `code`; it carries no raw guest/Worker exception or sensitive native cause. Async methods report these through rejection, not synchronous validation throws.

| Code | Meaning / owner |
| --- | --- |
| `INVALID_REQUEST` | Invalid type/shape, field, label, or timeout |
| `INPUT_LIMIT` | Source or filename exceeds admission limit |
| `NOT_READY` | Run attempted outside ready/busy/disposed handling |
| `BUSY` | Another run is active |
| `DISPOSED` | Terminal engine or admitted run aborted by disposal |
| `UNSUPPORTED_ENVIRONMENT` | Required browser capabilities unavailable or blocked |
| `INITIALIZATION_FAILED` / `INITIALIZATION_TIMEOUT` | First boot or explicit retry failed / expired |
| `CANCELLED` / `RESET` | Host control action ended or superseded an operation |
| `EXECUTION_TIMEOUT` | Execution deadline expired; never a guest `InternalError` |
| `RESOURCE_LIMIT` | Trusted limit mechanism detected memory/stack/output-work exhaustion |
| `WORKER_FAILURE` | Worker error/messageerror or transport failure |
| `RUNTIME_FAILURE` | WASM trap, adapter/cleanup failure, or ambiguous runtime integrity failure |
| `PROTOCOL_ERROR` | Malformed or impossible current-operation runtime message |
| `RECOVERY_FAILED` / `RECOVERY_TIMEOUT` | Replacement boot failed / expired |

Guest error names/messages are attacker-controlled and cannot be used to authenticate timeout or cancellation. Prefer controller/hook/allocator evidence for engine limits. The binding does not prove that every memory/stack failure can be distinguished from a guest-created exception: ambiguous integrity/resource failures must conservatively invalidate the runtime and return `RUNTIME_FAILURE`, with a fixed message. Phase 2 must verify this classification; do not label an infrastructure failure `SyntaxError` or `TypeError` merely to fit the result format.

## Runtime information

`getRuntimeInfo()` returns a snapshot with `engineVersion`, `runtimeName`, `runtimeVersion`, `bindingVersion`, `variant`, `executionProfile`, `initialized`, `capabilities`, and `limits` (effective numeric policy once implemented). `capabilities` describes the contract: synchronous Script and bounded console, with `dom`, `network`, `storage`, `modules`, `asyncJobs`, `persistentState`, and `analysis` false. Declared capability policy is not evidence of a completed security test.

Before successful initialization, declared metadata is available with `initialized: false`; no browser compatibility is inferred. During a healthy active run it remains true. Recovery, failed, and disposed states report false until a new boot succeeds. Do not expose Worker objects, asset internals, runtime generations, or engine secrets.

No `compile`, `inspect`, `diagnose`, `parse`, `tokenize`, or `format` methods are included now. JavaScript source compilation is already internal to execution. A future parser/formatter is a separately versioned, bounded capability; it must not alter or gate ordinary execution.
