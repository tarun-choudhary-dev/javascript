# Testing and browser compatibility strategy

Status: Stage 0 plan refined by the Phase 1 architecture audit. There is no engine implementation, test suite, distribution, or tested browser yet. Documentary/package integrity checks are not runtime security tests. Phase 1 defines acceptance evidence; Phase 2 builds and runs the suites.

## Layered tests

| Layer | What it must prove | Environment |
| --- | --- | --- |
| Unit | Strict validators, limit accounting, transition table, counter non-reuse, exactly-once completion, race precedence | Fast deterministic tests with controlled clock/transport |
| Runtime | Pinned QuickJS semantics, guest globals, console bridge, heap/stack controls, handle cleanup, WASM failures | Real runtime in actual browser Worker; debug variant for leak checks where useful |
| Public API | Consumer methods, result invariants, rejected admission vs admitted failures, independent engine instances | Browser using only public exports |
| Security | No exposed host capabilities, observed network/storage effects, escape/flood/protocol resilience, real hard termination | Isolated test origin, real Worker/WASM, instrumented browser and test receivers |
| Distribution | Fresh package includes working Worker/WASM and notices; public exports/assets/CSP match source behavior | Fresh clean build and `npm pack` artifact |
| External consumer | Library works without repository aliases, source files, dev server magic, or manually copied runtime artifacts | Temporary separate project installing only the packed tarball |

No production dependency injection seam should expose raw Worker/runtime controls just to make tests convenient. Test the controller with private fakes for ordering, then prove the transport/runtime with real browsers. Node tests cannot establish browser isolation, CSP, asset loading, or hard interruption.

## Required scenarios

**Language/result:** empty source, console channel routing, Unicode, syntax/ReferenceError/TypeError, arbitrary thrown primitives/objects, Script strictness, top-level return/module syntax, guest eval/Function, ignored completion values, synchronous-only Promise semantics, isolated globals/prototypes, disabled imports/timers/browser APIs. Confirm no infrastructure error is labeled a JavaScript exception. Confirm error text is not implicitly copied into stderr.

**Lifecycle:** repeated/coalesced initialization; run before ready; concurrent run rejection without affecting active run; cancel when idle/initializing/busy/recovering; reset in every state; reset superseding initialization; dispose in every state and twice; initialize/run/cancel/reset after dispose; idle Worker failure; failed recovery followed by explicit retry; two engines without interference. Every admitted run and readiness waiter must settle once.

**Races:** result vs cancel/timeout/dispose/reset; result at/after deadline before timer callback; old boot completing after reset; old result/error/messageerror/timer after replacement run; duplicate stream/terminal messages; wrong operation/future IDs; repeated resets during recovery. Assert result, output, state, active timer, metadata, and settlement count remain correct.

**Termination/availability:** busy loop, recursion, pathological regex, allocations, repeated logging and normalization loops. Cancel externally, observe UI heartbeat, verify Worker termination and no post-cancel effects, then run a fresh successful program. Do not accept a test that merely checks a cancelled flag or a rejected Promise. Use process/browser timeouts around destructive stress fixtures so test automation itself cannot hang indefinitely.

**Resource boundaries:** all [limits](limits.md) at `limit - 1`, `limit`, `limit + 1`, worst JSON escaping, surrogate pairs, combined channel caps, result/error/message budgets, maximum valid request, malformed/deep JSON, invalid numeric values, and many calls after output is full. Check bounded host allocations/message counts and recovery after guest/WASM allocation failure. Record limits the browser cannot enforce.

**Security:** execute every row of the [capability inventory](security.md#browser-capability-inventory). Also probe constructor/prototype chains, `eval`, `Function`, host callback constructors, modified intrinsics, proxies/getters, console/error formatting, attempted protocol injection, XSS-shaped filenames/output, nested imports/workers, and malicious serialized fields. Seed host DOM/global/storage canaries and assert no reads leak or writes occur.

For network tests, first capture the expected initialization request graph on a cold cache. Then isolate the execution interval and monitor same-origin and cross-origin HTTP receivers, WebSocket handshakes, browser network events and relevant channel-specific instrumentation. Repeat with cache disabled, failed/retried asset loads, reset/recovery, and a controlled host Service Worker. Absence of a JS exception or a failed CORS response is not proof that no request was sent. Test endpoints are measurement infrastructure only; they never execute user source.

**Faults/loading:** blocked/missing/corrupt WASM, wrong MIME, wrong Worker path, module import failure, protocol/runtime version mismatch, rejected CSP, offline cold start, offline warm assets, worker errors/messageerror, forced WASM trap, cleanup failure, and recovery asset failure. All must reach a documented terminal/readiness outcome within bounded scheduling assumptions, never an infinite retry.

**Ownership:** every guest handle/context/runtime released on success and error; termination clears all controller listeners/timers/references. Observe repeated-run/reset/cancel memory trends. Run an appropriate debug variant for leak detection and the exact release variant for acceptance; one does not substitute for the other.

## Source and distribution parity

Run one behavioral contract suite against two adapters: a development/source entry and the **freshly built, packed distribution**. The public expectations are identical; only import/asset locations differ. Never validate old checked-in/manual `dist` files.

| Behavior | Source fixture | Fresh distribution fixture |
| --- | --- | --- |
| Execution, console, and guest/program errors | Required | Required |
| Engine errors and loading failure | Required | Required |
| Lifecycle, cancellation, recovery, reset, disposal | Required | Required |
| Input/output/memory/time/message limits | Required | Required |
| Capability and network/storage security | Required | Required |
| Runtime version and Worker/WASM loading | Required | Required |
| Analysis | Confirm absent initially | Confirm absent initially |
| Future analysis feature, when added | Same feature suite | Same feature suite |

Phase 2 should introduce a reproducible build and exact lockfile before installing a test/bundler stack. Build only from the current sources and pinned dependencies, record artifact hashes, and run package-content checks. CI must fail on missing WASM, accidentally exposed source-only imports, absent notices, or source/build behavior divergence.

## External consumer procedure

1. Clean-build the library and pack it. Inspect package contents, public exports, runtime/version manifest, and notices.
2. Create a temporary project **outside the repository**. Install the tarball; never use a workspace link or absolute source path.
3. Test a plain browser ESM/static deployment and one independently configured mainstream bundler fixture. Resolve Worker and WASM relative to package artifacts; publish no consumer instructions that depend on knowing runtime internals.
4. Serve from root and a nested URL base, with correct MIME and a documented CSP. Test normal and missing/blocked assets.
5. Run the public execution/error/lifecycle/limits/security suite. Inspect network requests to ensure no undeclared CDN or repository path dependency.
6. Run offline after deliberate asset delivery/caching, and record that cold offline initialization fails clearly if assets are absent.
7. Preserve browser versions, OS, policy headers, dependency lock/hash, results, and failures as evidence. Delete temporary fixtures only within verified task-owned paths.

A local static test server and network receiver are development tools, not custom backends required by consumers.

## Browser matrix

Minimum capabilities for the **proposed** distribution, independent of any support claim:

| Browser capability | Required? | Architectural role and evidence status |
| --- | --- | --- |
| Dedicated **module** Worker and private message events | Yes | Runs trusted adapter off the UI thread and permits owner termination; selected bundle behavior `UNVERIFIED` |
| WebAssembly compile/instantiate and the selected glue's typed-array/BigInt/TextDecoder primitives | Yes | Initializes QuickJS binary in Worker; exact browser requirements `UNVERIFIED` until production bundle inspection |
| Static HTTP(S) delivery of ESM Worker, imported modules, and WASM with compatible MIME/origin | Yes | Fixed package-relative asset graph; nested paths and redirects `UNVERIFIED` |
| CSP that permits Worker/module loading and WASM compilation | Conditional on host policy | Must be tested with the actual worker response and page policies; no broad `unsafe-eval` assumed |
| Browser fetch/XHR used by trusted WASM glue | Asset-loader dependent | Inspected glue uses fetch and may fall back; actual request graph/credentials `UNVERIFIED` |
| Blob URLs / MessageChannel / iframe sandbox | No initial requirement | No blob/frame broker or MessageChannel in the chosen protocol; future change needs new tests |
| SharedArrayBuffer / COOP / COEP | No initial requirement | Single-threaded selected variant; exact output graph still requires confirmation |

The Worker entry is expected to be served from the application origin under the [Worker constructor's origin rules](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker). This does not itself isolate the trusted Worker from host-origin network/storage authority.

Status definitions:

- `UNVERIFIED`: no engine evidence for this combination.
- `TESTED`: required suite passed for the recorded exact version/OS/artifact/policy; not an ongoing support promise.
- `SUPPORTED`: a documented maintained version range with repeatable CI/manual coverage and release ownership.
- `KNOWN ISSUE`: evidence identifies a reproducible limitation; link its report and affected versions.
- `UNSUPPORTED`: deliberately excluded or fails a non-negotiable requirement; fail closed, no unsafe fallback.

| Browser / platform target | Exact version | WASM / module Worker | Iframe behavior | CSP / runtime / cancellation | Status / known limitations |
| --- | --- | --- | --- | --- | --- |
| Chrome desktop, Windows/macOS/Linux | Not recorded | Unverified for selected artifact | N/A, not used | Unverified | `UNVERIFIED`; no engine run |
| Edge desktop, Windows | Not recorded | Unverified | N/A | Unverified | `UNVERIFIED` |
| Firefox desktop, Windows/macOS/Linux | Not recorded | Unverified | N/A | Unverified | `UNVERIFIED` |
| Safari desktop, macOS | Not recorded | Unverified | N/A | Unverified | `UNVERIFIED`; requires actual Safari, not just automation WebKit |
| Chrome Android | Not recorded | Unverified | N/A | Unverified | `UNVERIFIED`; include constrained memory/background behavior |
| Safari iOS/iPadOS | Not recorded | Unverified | N/A | Unverified | `UNVERIFIED`; include suspension and process eviction |
| Embedded WebViews | Not recorded | Unverified | N/A | Unverified | `UNVERIFIED`; no inferred support from browser branding |
| Environment with no usable Worker or WASM | Any | Required feature absent | N/A | Cannot satisfy boundary | `UNSUPPORTED` by design |
| `file://` deployment | Any | Outside static HTTP(S) deployment target | N/A | Origin/loading behavior outside contract | `UNSUPPORTED` by design |

Initially target current stable desktop versions; add prior versions/mobile only from measured evidence. Record exact builds, not “latest”. Test automation Chromium/Firefox/WebKit can broaden coverage but cannot substantiate product-specific Safari/Edge claims alone. Any future iframe architecture adds an explicit iframe/origin/CSP test column and resets affected verification status.

Each tested row must include WebAssembly compile/instantiate behavior, Worker creation, import/glue compatibility, CSP headers, asset MIME/URLs, network graph, capability results, cancellation latency, cold/warm initialization, background-tab timing, memory behavior, and known issues. No browser receives a support badge from the Phase 1 architecture audit.

## Phase 2 verification order and acceptance evidence

First prove the chosen artifact loads in a dedicated Worker and the guest cannot reach browser capabilities. Then prove hard termination and fresh recovery, then implement the minimum API with correct errors and ownership. Calibrate limits before exposing untrusted workloads. Finish source/build and external-consumer parity before calling the first implementation reusable. Failures of these premises require an architectural decision update, not a native-execution fallback.

| Evidence gate | Required artifact/evidence | What it establishes |
| --- | --- | --- |
| Runtime bootstrap | Exact lockfile, Worker/WASM asset graph, cold/warm boot traces, matching runtime/policy metadata | Selected binary can initialize inside a Worker under intended deployment; failed boot is bounded |
| Guest capability boundary | Capability matrix with direct/prototype/eval probes plus DOM/storage/network canaries and receiver logs | Actual guest access for each forbidden/allowed API, not just source inspection |
| Hard cancellation and recovery | Infinite loop and memory pressure fixtures; Worker identity changes, no old messages accepted, fresh run succeeds | Cancel/timeout terminate old execution and restore a usable generation where browser survives |
| Lifecycle/protocol | Deterministic race/fault injection mapped to [race/failure matrices](architecture/flows.md#race-condition-matrix) and [protocol outcomes](protocol.md#invalid-duplicate-and-late-message-outcomes) | Exactly-once settlement, stale-response immunity, finite failure exits |
| Limits and output | Calibrated `LIMITS` values, boundary cases, FFI string extraction evidence, memory measurements | Public resource policy is enforceable by the selected adapter on target devices |
| Distribution/license | Fresh build and packed artifact, manifest/hashes, notices/SBOM, nested-path/CSP/MIME checks | Source/package parity and complete runtime asset/license delivery |
| Independent consumer | Temporary external project installing tarball only, exercising public API and security suite | Applications need no repository-local alias or runtime internals |

No fixture or package is created in Phase 1. The [browser matrix](#browser-matrix) remains `UNVERIFIED`; a source-level expectation does not upgrade it to `TESTED`.
