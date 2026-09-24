# Resource policy and enforcement

Status: Stage 0 categories refined by the Phase 1 audit. **Numeric production defaults are deliberately not chosen yet.** They require measurements of this JavaScript runtime on representative browsers/devices in Phase 2. No values are copied from another language engine.

Phase 2 must define one immutable internal `LIMITS` policy in `src/limits/`, share/derive its constraints for host and Worker, version it in the handshake, and expose effective values through `getRuntimeInfo()`. The host controller is the authority for admitted limits and public timeout outcomes; the adapter receives only a checked copy and maintains its own work counters. Do not scatter limits or let the guest replace the policy. `run.timeoutMs` is the only initial per-run override, bounded by that policy.

## Categories

| Policy key | Unit / purpose | Enforcement points | Outcome |
| --- | --- | --- | --- |
| `sourceChars` | UTF-16 code units | Host before encoding/post; Worker before QuickJS | Reject `INPUT_LIMIT` before admission, protocol failure for invalid wire input |
| `filenameChars` | UTF-16 code units | Host and Worker before use | Reject `INPUT_LIMIT`; never load as a URL/path |
| `stdoutChars` / `stderrChars` | Retained UTF-16 code units, including spaces/newlines | Guest-side formatting, adapter, and host accumulation | Retain bounded prefix, set `truncated`, discard further content for exhausted channel |
| `combinedOutputChars` | Total retained text across both channels | Adapter and host | Global prefix in emission order, set `truncated` |
| `consoleArgumentCount` | Maximum inspected arguments per call | Bridge before inspecting handles | Omit excess representation, set `truncated` |
| `consoleCallCount` | Work budget, including calls after output fills | Bridge counter during execution | Stop run with trusted `RESOURCE_LIMIT`; terminate/recover |
| `errorNameChars` / `errorMessageChars` / `errorStackChars` | Maximum normalized field lengths | Inside guest/adapter before host copying; host rechecks | Bounded fallback or prefix; set `truncated` if text omitted |
| `resultChars` | Maximum JSON-encoded public result, UTF-16 units | Adapter field budgets and final host construction | Engine-authored bounded failure if invariant violated |
| `messageChars` | Maximum JSON wire string length before parsing | Every sender/receiver | Reject input or invalidate malformed/oversized active response |
| `runtimeInfoChars` | Per-field Worker version/variant/profile/policy metadata length | Bootstrap adapter and host | Initialization/protocol failure for oversized or mismatched metadata |
| `streamChunkChars` | Per-chunk text maximum | Bridge/adapter and host | Split bounded text into finite chunks |
| `streamMessageCount` | Maximum chunks accepted/sent per run | Adapter and host | Trusted quota violation ends run; no unbounded queue |
| `guestHeapBytes` | QuickJS allocator budget | Runtime before source allocation/evaluation | Resource failure or conservative `RUNTIME_FAILURE`, invalidate |
| `guestStackBytes` | QuickJS guest stack budget | Runtime before evaluation | Resource failure/integrity classification and recovery |
| `initializationTimeoutMs` | Whole initial/retry boot | Host monotonic watchdog | Terminate and enter `failed` |
| `defaultExecutionTimeoutMs` / `maxExecutionTimeoutMs` | Admission through terminal run handling | Host watchdog, Worker local deadline, interrupt hook | `EXECUTION_TIMEOUT`, terminate/recover |
| `recoveryTimeoutMs` | One complete replacement boot | Host watchdog | Terminate and enter `failed` |
| Future diagnostics count/size, AST nodes/depth, analysis output/time | Separate analysis budgets | Future analysis admission and serialization | Not present until analysis is designed |

Source/filename/output lengths are not UTF-8 byte lengths or Unicode code-point counts. JSON escaping can expand source/text, and QuickJS receives encoded bytes; derive additional encoded-buffer bounds from accepted source limits. Never build an unbounded serialized string just to measure it. Reject NUL source/filename as specified in the API. Strings cut at a text cap should avoid splitting a surrogate pair; returning one fewer code unit is allowed and counts as truncation.

## Policy consistency

Before initialization, validate that every configured number is a finite positive safe integer where required, deadlines fit the timer strategy, and stack/heap budgets leave room for the actual runtime's overhead. Startup self-check must fit within the selected values.

Derive wire/result budgets from field budgets and exact schemas. In particular, JSON can require up to six characters per UTF-16 unit; include all quotes, keys, separators, numeric fields, and the maximum bounded error. `messageChars` must hold any valid run envelope at the admitted source/filename limits, or admission must apply a documented smaller derived bound. `resultChars` must hold the worst allowed combined output plus error and envelope fields. Avoid contradictory policies that accept input but inevitably fail to transport it.

Choose chunk size/count so all allowed retained output fits with bounded overhead. Aggregate partial logs into chunks; zero-length/exhausted output must not produce unlimited stream messages. Keep only accepted prefixes at the host. Failed/cancelled runs may lose in-flight chunks without violating the cap.

## Formatting and memory hazards

Guest strings and arrays may be huge even when source is small. Slice/limit guest text before copying to host JavaScript; do not copy a full string then call `.slice()` on the host. Avoid recursive `dump`, `JSON.stringify` of guest values, inspecting properties, or calling custom conversion hooks for console output. Bounded guest helper operations use captured trusted intrinsics and stay under the same execution deadline; guest modifications must not bypass them.

Guest `eval` and `Function` can construct and execute code much larger than the admitted source string. `sourceChars` only limits the submitted request; it is not a cap on all dynamically generated guest code. The QuickJS heap/stack controls and host execution deadline must cover such expansion. Likewise, a short source can allocate huge strings/arrays, so early input rejection and runtime resource controls solve different problems.

Formatting errors and hostile error getters are execution work. Hard termination remains available if a formatter or conversion loops. All QuickJS handles need explicit ownership and disposal, including exception and temporary formatting handles. Cleanup is not allowed to hold the run in `busy` forever.

`setMemoryLimit` constrains QuickJS allocations, not all WASM linear memory, wrapper strings, message queues, code assets, the tab, or GPU/browser allocations. `setMaxStackSize` differs from the build-time WASM stack. The published build allows memory growth; Phase 2 must measure initial/high-water memory and determine whether a compatible WASM maximum adds useful protection. Do not advertise a hard total-memory quota without such evidence. Whole-Worker replacement releases ownership of the instance, but browser reclamation timing is not controlled by this library.

## Boundary verification and calibration

For each numeric input/text limit test `limit - 1`, `limit`, `limit + 1`, plus zero, negative, fraction, `NaN`, infinity, and wrong types where relevant. Include BMP/non-BMP strings, quotes/backslashes/control escaping, large error fields, mixed stdout/stderr, many empty log calls, and a maximum valid result. Verify expensive encoding/runtime work was not reached for rejected oversized inputs.

For heap/stack/time budgets, exact byte/instruction boundaries are runtime-dependent: test the control's configured boundary with instrumentation where available, then just-below/above workloads and real cancellation/recovery. Fake clocks validate controller ordering; real browsers validate actual termination and throttling. Test limit interactions, not just isolated fields.

Select initial values only after measuring baseline allocation, representative educational scripts, recursion, regex/JSON work, startup on cold/warm cache, and console overhead across target devices. Record measured evidence, safety margin, and rationale per value. Unknown values are a Phase 2 calibration gate, not permission to run with unlimited defaults.

## Boundary ownership audited in Phase 1

| Boundary | Reject/check before crossing | Authoritative owner | Secondary check and breach action |
| --- | --- | --- | --- |
| Host application -> engine | Request shape, source/label length, timeout range; no coercion | Pure host validator using controller's immutable policy | Worker repeats exact wire/policy validation; invalid public input rejected without admission |
| Host -> Worker | Derive safe encoded size before JSON/post; assign current ID/generation/deadline | Host controller | Worker checks `messageChars`, schema, policy version, ID, source/label/budget; current fault fails boot/run |
| Worker -> QuickJS | Set heap/stack/interruption before guest source allocation/eval; no loader/extra bridge | Trusted adapter | Host execution watchdog terminates even if Worker is blocked; allocator failure invalidates |
| Guest -> console bridge | Limit argument count, primitive formatting, text copied across FFI, call work, channel/combined output | Adapter per-run counters | Host validates stream chunks/count/totals; violation `PROTOCOL_ERROR`/termination |
| Worker -> host | Chunk and total sizes, error text, metadata, message count and JSON length | Adapter | Host rechecks all fields before append/normalization; malformed current response invalidates |
| Host -> consumer | Result/error field and aggregate size, host duration | Controller/result normalizer | If invariants fail, return bounded engine failure and invalidate Worker |

The policy is selected once per engine generation; the Worker receives a validated copy and cannot increase its own effective limits by sending metadata. The host is the sole public timeout/state authority. The QuickJS interrupt hook enforces a local budget inside synchronous evaluation and reports a cause; it does not own the terminal result. Only source/filename/request shape can be rejected before admission; output/heap/time breaches occur after admission and use an engine-error result plus appropriate invalidation.

The two exhaustion examples in [security](security.md#resource-exhaustion-audit) show why limits are layered. A guest heap cap can be exhausted before the host timeout; the host watchdog can fire while the Worker is blocked; neither caps all browser/process allocations. Multiple engine instances add their budgets at application level. Numeric policy values and feasible guest-side string extraction are **UNVERIFIED** Phase 2 gates.
