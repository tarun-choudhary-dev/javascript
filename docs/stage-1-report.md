# Phase 1 architecture audit report

Date: 2026-09-24. **Phase 1 architecture audit complete; no engine code exists.** This report refines the [Stage 0 completion report](stage-0-report.md) and points to the canonical architecture documents. It does not claim that browser execution or security behavior has been tested.

**Evidence labels used throughout:** `VERIFIED` means directly inspected local/project or exact published artifact evidence, with the limited scope stated; `DOCUMENTED` means a primary specification or pinned upstream source describes a mechanism; `PROPOSED` is a decision for future implementation; `UNVERIFIED` means the engine's actual browser behavior has not been observed. A documented mechanism is not a verified security outcome.

## 1. Executive summary

The smallest defensible architecture remains one public engine facade, one host execution controller, one dedicated Worker with a trusted runtime adapter, and one embedded QuickJS/WASM module per Worker generation. Each accepted run creates and destroys its own QuickJS runtime/context; a clean Worker/WASM instance may remain warm. The host controller alone owns lifecycle, request IDs, generation, public deadlines, hard termination, and recovery. Only bounded data crosses the private message channel; guest code gets a narrow console bridge. This is **PROPOSED**, with package APIs and Worker termination **DOCUMENTED** but browser security and runtime behavior **UNVERIFIED**. [Component details](architecture/components.md)

Phase 1 found no reason to replace the Stage 0 runtime or public draft. It refined implementation sequence, exact ownership, error/failure outcomes, wire constraints, and stale-response rules. It **MODIFIED** the schedule: Stage 0 expected runtime proof in Phase 1; this request limits work to architecture, so empirical work is a Phase 2 prerequisite. It also removed an unused Worker engine-error message field while preserving the public result. [Decision log](decisions.md#phase-1-review-of-all-stage-0-decisions)

## 2. Stage 0 baseline

The complete Stage 0 [report](stage-0-report.md), [architecture](architecture.md), [runtime research](runtime.md), [security model](security.md), [API](api.md), [protocol](protocol.md), [limits](limits.md), [testing plan](testing.md), [licensing audit](licensing.md), and [nine decisions](decisions.md) were reviewed. The repository has a private manifest and documentation, no installed runtime, Worker, engine, UI, or tests. The only pre-audit worktree change was the user's `.gitignore` update, which keeps personal `.agents/` skills and `skills-lock.json` out of Git while retaining project Markdown.

| Carried assumption | Stage 0 basis | Phase 1 classification |
| --- | --- | --- |
| QuickJS 2025-09-13 in binding/variant 0.32.0 provides runtime/context, memory, stack and interrupt APIs | Pinned source/package/license inspection | `VERIFIED` for artifact identity; `DOCUMENTED` API; browser integration `UNVERIFIED` |
| A dedicated Worker can be terminated by its owner | HTML Worker specification | `DOCUMENTED`; timing and this product's behavior `UNVERIFIED` |
| Guest code has no browser network/storage/DOM authority if only bounded console is bridged | Intended QuickJS host-function design | `PROPOSED`; real guest capability/escape behavior `UNVERIFIED` |
| New QuickJS runtime/context removes guest state between runs | Binding API and Stage 0 policy | `DOCUMENTED` mechanism; repeated disposal/isolation `UNVERIFIED` |
| Synchronous Script and no Promise job pump is a deliberate initial profile | Stage 0 API/ADR-004 | `PROPOSED` contract; exact guest behavior `UNVERIFIED` |
| Host deadlines, Worker termination, one recovery, ID + generation prevent stuck/stale state | Stage 0 lifecycle/protocol design | `PROPOSED`; race behavior `UNVERIFIED` |
| Source/distribution parity and external consumer viability | Stage 0 test plan | `PROPOSED`; no build or consumer test |
| Runtime package and project licenses have known labels | Local AGPL file and upstream MIT/package evidence | `VERIFIED` for inspected notices; complete linked binary inventory `UNVERIFIED` |

The historical Stage 0 report is retained. Its references to Phase 1 implementation/calibration are superseded by [ADR-010](decisions.md#adr-010--phase-1-is-architecture-only), because this user request defines a documentation-only audit.

## 3. Final architecture

The [component diagram](architecture/components.md#physical-boundary-and-dependency-direction) shows the only runtime path: application -> public facade -> host controller -> private Worker adapter -> embedded QuickJS/WASM -> guest Script. Pure validators, immutable limits, message codec, and normalizers are functions/ownership areas, not mandatory extra runtime layers. No iframe, backend, native `eval` fallback, runtime plugin framework, persistent REPL, or analysis dependency is included. One engine owns at most one Worker and admitted run. **PROPOSED.**

## 4. Component responsibility map

The [full responsibility map](architecture/components.md#responsibility-map) records purpose, inputs, outputs, owned and excluded state, dependencies, failure behavior, and security duty for all thirteen requested concepts: host application, public engine, execution controller, lifecycle manager, request validator, limit manager, runtime adapter, Worker, runtime, message protocol, result normalizer, error normalizer, and security boundary. Lifecycle manager is a named part of the controller, not a second state machine. Limit manager/protocol are pure; security boundary is cross-cutting rather than a stateful object. **PROPOSED.**

## 5. Runtime assessment

QuickJS is a C JavaScript interpreter compiled to WASM. The proposed binding/variant remains `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync` 0.32.0, embedding Bellard QuickJS 2025-09-13. The [runtime assessment table](runtime.md#phase-1-runtime-architecture-assessment) answers loading, async WASM initialization, fixed asset origin, Script evaluation, bounded output/exception extraction, per-run creation/disposal, clean reuse, and invalidation. Pinned upstream APIs are **DOCUMENTED**; actual adapter loading, browser compatibility, safe output extraction, leak behavior, and security are **UNVERIFIED**.

The older embedded version needs a freshness/advisory review before Phase 2 adoption. No npm dependency is added in this audit. The selected synchronous variant has no Asyncify/module loader requirement for `script-sync-v1`. It does not give guest code native browser APIs. A guest heap/stack control is not a total tab memory cap. [Candidate comparison and licensing evidence](runtime.md)

## 6. Engine/runtime boundary

The engine owns public contract, validation/admission, lifecycle, policy, Worker transport, host deadline, termination, recovery, and final public data. The adapter owns binding calls, WASM module, guest runtime/context/handles, narrow console bridge, and bounded guest extraction. QuickJS owns language parsing/evaluation and guest heap/globals. The application owns source, display, and static deployment. Crossings and exclusions are in [boundary data table](architecture/components.md#data-crossing-each-boundary). Raw QuickJS handles, Worker references, binary bytecode, and transport messages never appear in the public API. **PROPOSED.**

Changing the runtime later requires a new adapter and conformance/security proof for the same public execution profile. It is not enabled by building a generic plugin abstraction now.

## 7. Worker architecture

The dedicated **module Worker** runs only trusted adapter/binding code and the QuickJS WASM instance; user source stays inside QuickJS. The host controller constructs a fixed package-owned Worker URL, owns its reference/listeners and generation, and terminates it on cancel, timeout, reset, dispose, or integrity failure. The Worker holds a warm WASM module and creates/disposes one guest runtime/context per clean run. It accepts `init`/`run` and emits `ready`/`stream`/`result`/`fatal` by [private protocol](protocol.md). It has no public handle. A Worker has ambient browser capabilities; capability restriction is at the guest/bridge boundary. **PROPOSED**, with termination semantics **DOCUMENTED** in the [HTML Standard](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker).

## 8. Execution flow

The [run sequence diagram and stage table](architecture/flows.md#one-run-ordered-stages) cover validation before admission, state/ID/deadline assignment, bounded encode/post, Worker validation, fresh QuickJS runtime creation, synchronous Script evaluation, internal output chunks, bounded extraction and cleanup, final identity/deadline/schema/totals checks, host normalization, and `busy -> ready`. Public request validation is synchronous work behind a Promise; transport is asynchronous; QuickJS Script evaluation is synchronous inside the Worker. The host cannot accept another run until cleanup and final validated result are complete. **PROPOSED.**

## 9. Lifecycle model

The authoritative host states are `created`, `initializing`, `ready`, `busy`, `recovering`, `failed`, and terminal `disposed`. The [valid transition table and operation rules](architecture.md#lifecycle-states) cover coalesced initialization, single run admission, idle cancellation, reset during initialization/busy/recovery, failure retry, and disposal. Every transitional state has one bounded outcome to ready/failed/disposed while the host event loop runs. A crashed browser or suspended host event loop cannot be guaranteed to settle. No separate Worker phase is allowed to write the host lifecycle. **PROPOSED.**

## 10. Cancellation model

The [cancellation diagram](architecture/flows.md#cancellation-flow) shows `cancel()` reaching the host controller; an active run is decided `CANCELLED` once, its generation revoked, old Worker terminated, run result settled, and one replacement boot started. The `cancel()` Promise resolves when the new Worker reaches ready or rejects on recovery failure; the run Promise independently resolves the cancelled engine result. During initialization or after a completed run, cancel is a no-op; during recovery it joins that recovery. The old runtime is never reused. **PROPOSED**, with owner-driven Worker script abortion **DOCUMENTED**.

## 11. Timeout model

The host controller is the **single public timeout authority**. Initialization deadline includes Worker construction/asset boot; execution deadline starts at run admission and includes transport/evaluation/output/cleanup/result validation; recovery has its own one-attempt deadline. The Worker-local QuickJS interrupt hook is a supplementary execution guard and reports a cause, not a second public state machine. A result processed at or after the host deadline becomes `EXECUTION_TIMEOUT`, even if timer callback is delayed. After execution timeout, revoke and terminate Worker, then recover. Analysis has no current operation or timeout. Numeric values require Phase 2 calibration. [Timeout table](architecture.md#timeout-policy), [limit ownership](limits.md#boundary-ownership-audited-in-phase-1). **PROPOSED.**

## 12. Recovery model

The [recovery diagram](architecture/flows.md#timeout-and-failure-recovery) covers active/idle Worker, WASM, adapter, protocol, timeout and cleanup failures. Revoke old generation before detaching/terminating, settle any admitted run once, create exactly one fresh Worker/WASM generation, and validate its boot before entering ready. Failed replacement enters stable `failed` and rejects readiness waiters; only explicit later `initialize()`/`reset()` retries. Initial boot failure goes straight to failed and discards partial state. Ordinary guest exceptions reuse a clean Worker only after successful per-run cleanup. **PROPOSED.**

## 13. Stale-response protection

The controller issues positive monotonic safe-integer request IDs and generations, never reusing either in one engine. Each Worker listener/timer/boot callback closes over Worker identity, generation, ID and phase. A revoked Worker event is ignored before parsing; a retired completed ID is ignored; an impossible future ID or malformed current operation is a protocol failure. Old results/streams/errors/timeouts cannot settle a new run, append output, clear its timer, alter metadata, or change state. Counter exhaustion fails closed. [Protocol invariant and outcomes](protocol.md#stale-response-invariant), [race matrix](architecture/flows.md#race-condition-matrix). **PROPOSED.**

## 14. Message protocol

Protocol `1` uses a bounded JSON string per message with exactly `{protocolVersion, generation, requestId, op, type, payload}`. `init`, `ready`, `run`, `stream`, `result`, and `fatal` have exact required fields/types, no optional wire fields, per-field `LIMITS` constraints, status/error invariants, output sequence and totals checks. A Worker engine-error carries a code only; the host supplies public infrastructure wording. Cancel/reset/dispose are host Worker-termination operations, not cooperative messages. Host and Worker validate independently. Unknown, malformed, oversized, future-ID or wrong-order **current** messages cause failure/invalidation; former generations and completed IDs are ignored. [Full grammar and validation matrix](protocol.md). **PROPOSED.**

## 15. Error model

Guest syntax and synchronous runtime exceptions are **program errors** (`SyntaxError`, `ReferenceError`, `TypeError`, or bounded fallback); they resolve an admitted run with `status: "program-error"`. Validation or state rejection before admission and failed lifecycle calls reject public `EngineError`. Timeout, cancellation, Worker/WASM/binding/cleanup/protocol faults after admission resolve `status: "engine-error"` with an engine code. Internal “runtime failures” are a subtype of **engine** failure, never guest `TypeError`. Worker-authored error text is not trusted for public infrastructure messages. Ambiguous resource/host integrity failures become conservative `RUNTIME_FAILURE` and invalidate. [API taxonomy](api.md#program-errors-versus-engine-errors), [failure matrix](architecture/flows.md#failure-mode-matrix). **PROPOSED**; safe classification/extraction remains **UNVERIFIED**.

## 16. Resource-limit model

One immutable versioned policy specifies source/label/output/error/result/message/stream/metadata/work counts, guest heap/stack, and boot/run/recovery deadlines. [Boundary table](limits.md#boundary-ownership-audited-in-phase-1) assigns pre-admission validation to host, independent run-envelope checks to Worker, QuickJS heap/stack/interrupt to adapter, producer-side output bounds to guest/adapter, and consumer-side rechecks to host. Valid policy relationships account for JSON escaping and maximum valid result size. Oversized public input rejects before Worker processing; post-admission breach yields engine error/invalidation where appropriate. Numeric defaults remain **UNVERIFIED** until measured. [Full categories](limits.md#categories)

## 17. Security audit

Untrusted inputs include source, label, output, exception, serialized messages and future diagnostics/artifacts. Assets include host DOM/code/state, user data, storage/cookies/network authority, engine integrity and availability. The guest boundary is QuickJS with an explicit bounded console bridge; Worker origin and WASM alone are insufficient claims. The [threat/control table](security.md#threats-controls-and-evidence-gates) and [capability inventory](security.md#browser-capability-inventory) state policy, observed actual behavior and required probes per API. Every guest capability outcome is **UNVERIFIED**. Browser/OS, supply chain, adapter and binding are trusted residual surfaces. [Security model](security.md)

## 18. Network/storage analysis

Trusted bootstrap may fetch fixed Worker/ESM/WASM assets. The inspected WASM glue requests with same-origin credentials and may retry/fallback; cookie-bearing asset requests are possible. Guest source receives no fetch/socket/module/worker/storage bridge by design. This separates **runtime acquisition** from **guest execution**. Actual guest-triggered network, cookie, IndexedDB, Cache Storage, local/session storage, or host persistence behavior is **UNVERIFIED**; receiver logs and seeded canaries are required. The surrounding Worker can possess ambient APIs, so “Worker cannot network/store” is false as a design argument. [Network and storage model](security.md#network-acquisition-versus-execution)

## 19. Browser compatibility

Minimum architecture requires a usable dedicated module Worker, browser ESM, WebAssembly with the selected glue's JavaScript dependencies, structured message transport, accessible static Worker/WASM assets, and compatible CSP/MIME/origin behavior. Blob URLs, iframe sandbox, MessageChannel, SharedArrayBuffer, COOP/COEP and a custom execution backend are **not required by this design**, subject to checking the actual binary. `file://` and environments without Worker/WASM are unsupported by policy. Every Chrome/Edge/Firefox/Safari/mobile/WebView row is **UNVERIFIED** because no engine build ran. Record exact versions/OS/asset hashes and promote only with evidence. [Browser matrix and definitions](testing.md#browser-matrix)

## 20. Distribution architecture

The proposed consumer installs an npm browser ESM package or serves its static distribution. It receives a public entry/declarations, module Worker bundle, pinned versioned WASM, package metadata, project license and full audited third-party notices/provenance. Assets resolve relative to the installed package/build, including a nested URL base; the Worker entry is served from the application origin. No required CDN or guest-selected URLs. Source-only tests/fixtures, private `.agents/` skills, `skills-lock.json`, local paths/secrets and experiments cannot be runtime dependencies. The build must expose only the public facade while shipping internal Worker/WASM assets. Exact emitted paths, bundler and CSP behavior are **UNVERIFIED**; no package was built/published. [Distribution boundary](runtime.md#phase-1-distribution-and-build-boundary), [license audit](licensing.md)

## 21. State ownership

The [state table](architecture/components.md#mutable-state-ownership) assigns sole owners, readers, writers, lifetimes and reset effects for lifecycle, Worker/listeners, generation/IDs, active run, readiness waiters, timers, output accumulator, runtime-info snapshot, immutable limits, Worker-local phase, WASM module, QuickJS runtime/context/handles/jobs, and host UI. `isBusy()` is derived from lifecycle; no second mutable busy flag. Worker-local phase validates transport but cannot overwrite host lifecycle. **PROPOSED.**

## 22. Failure-mode analysis

The [expanded failure matrix](architecture/flows.md#failure-mode-matrix) covers invalid input, not-ready/busy/disposed calls, first/recovery boot failures, guest exceptions, hostile error extraction, heap/stack exhaustion, infinite loops, timeout, cancellation/reset/disposal, Worker errors, WASM traps, malformed/duplicate/stale/future messages and post-failure retry. Every admitted operation has one result or rejection path, and every partial Worker is discarded if untrustworthy. A silent Worker failure is eventually caught by the host watchdog while its event loop runs. **PROPOSED.**

## 23. Race-condition analysis

The [race matrix](architecture/flows.md#race-condition-matrix) explicitly resolves overlapping initialize, run, cancel, reset, timeout, dispose, old ready/result/error/timer, duplicate terminal, and recovery retry. There is no run queue. The host's first valid terminal decision wins; deadline eligibility is checked before result acceptance. Disposal is terminal for current state even if an earlier operation had already settled. Exactly-once latches and captured identity prevent callbacks from a former generation mutating the current one. **PROPOSED.**

## 24. Testing architecture

Six layers remain: unit for validators/state/counters, runtime for exact QuickJS semantics/ownership, public API for lifecycle/results, security for observable capabilities and hard interruption, distribution for fresh package/assets/CSP/notices, and an external consumer importing only a packed tarball. The [Phase 2 evidence gates](testing.md#phase-2-verification-order-and-acceptance-evidence) define what each must prove. One behavioral suite runs against source and a **fresh** build. Phase 1 writes no test suite, so all execution/security/distribution outcomes remain **UNVERIFIED**.

## 25. Stage 0 decision review

All nine Stage 0 ADRs are individually reviewed with status, evidence, reason and impact in [the decision table](decisions.md#phase-1-review-of-all-stage-0-decisions). ADR-001 through ADR-006 and ADR-008 retain their design choices; their browser-dependent outcomes remain explicitly unverified. ADR-007's protocol core remains but its unused engine-error wire message is removed. ADR-009's license preservation remains, while the phase schedule it anticipated is modified. No Stage 0 record was overwritten.

## 26. Confirmed decisions

**CONFIRMED as design, not as execution evidence:** engine-first public facade; QuickJS/WASM in a dedicated Worker as current candidate; explicit guest capability bridge and no initial iframe; fresh guest runtime/context with synchronous Script; host-controlled hard termination and one recovery; separate program/engine errors; bounded versioned protocol and central limits; optional analysis deferred; project AGPL text preserved. ADR-007's core stays while the private wire field is refined. Detailed trade-offs and limitations remain in [ADRs 001–009](decisions.md).

## 27. Modified decisions

**MODIFIED:** (1) the work sequence—Stage 0 anticipated runtime validation, build setup and numeric calibration during Phase 1, while this request forbids implementation—recorded in [ADR-010](decisions.md#adr-010--phase-1-is-architecture-only); and (2) the private Worker engine-error wire shape, which omits a bounded message the host would discard, recorded in [ADR-011](decisions.md#adr-011--omit-unused-worker-engine-error-text). Each ADR records previous decision, reason, evidence, alternatives, new decision, trade-off and impact. The runtime candidate, **public** API draft, security target and license were not changed.

## 28. Unverified assumptions

The selected Worker bundle's import/WASM/CSP/nested-path behavior; exact QuickJS version metadata from the final binary; repeated fresh-runtime disposal and memory trends; bounded guest-string/error extraction without full host copies; classification of allocator/stack failure; actual absence of guest DOM/network/storage/host reference capabilities; genuine infinite-loop termination latency; browser suspension/recovery; policy values; source/build parity; external consumer loading; complete linked-binary licensing; and every browser support row are **UNVERIFIED**. [Runtime assessment](runtime.md#phase-1-runtime-architecture-assessment), [security evidence ledger](security.md#evidence-ledger), [test gates](testing.md#phase-2-verification-order-and-acceptance-evidence)

## 29. Known risks

- A binding/FFI/QuickJS/adapter defect could expose ambient Worker capabilities; WASM is not a complete browser sandbox.
- Old embedded QuickJS may contain fixes missing from current upstream; keep the pin provisional until freshness review.
- Browser-wide/process memory exhaustion can happen before a timer or Worker termination; guest allocator limits are narrower.
- Bounded console/error extraction may require lower-level binding work or a changed runtime/output contract; this is a critical feasibility gate.
- Browser throttling/suspension prevents strict real-time deadlines and instant recovery guarantees.
- Source-only asset resolution can hide a broken packed distribution; actual Worker/WASM paths, MIME/CSP and nested bases need separate proof.
- User-facing result/error fields are untrusted text and do not sanitize a consumer's HTML rendering.
- Project license designation and compiled support-library notices need closure before any distribution.

## 30. Open questions

| Question | Owner / closure point |
| --- | --- |
| Keep 0.32.0/QuickJS 2025-09-13 or adopt a reviewed newer build after security/freshness assessment? | Phase 2 dependency adoption, with ADR if changed |
| Can the binding expose a bounded string/error extraction path before full host copying? | First Phase 2 adapter feasibility proof; change architecture if not |
| Which initial numeric limits fit representative devices and output loads? | Phase 2 measurements before untrusted use |
| Can a policy using only engine-owned relative URLs survive real bundlers, CSP, redirects and nested deployment paths? | Phase 2 source/package/external-consumer proof |
| What exact browser version ranges can be supported? | After recorded matrix tests; no inferred support |
| Does project licensing intend AGPL v3 only or later, and what notices are required by the actual linked WASM/JS graph? | Owner designation and artifact-level license audit before publishing |
| Should later versions add async jobs, modules, persistent state or AST analysis? | A separately requested later stage; not needed for `script-sync-v1` |

## 31. Phase 2 prerequisites

Phase 2 needs separate authorization. Start with the selected runtime's freshness and license review, a small real-browser bootstrap/bridge/termination proof, and exact asset/CSP observation. If it passes, implement the controller and adapter to the ownership/flow/protocol contracts, calibrate `LIMITS`, prove capability and race behavior, build an audited distribution, and run the external consumer suite. Do not claim a secure reusable engine until these gates pass. Failure of a premise triggers an ADR update, not an unsafe native fallback. No IDE/UI, authentication, persistence, package manager, multi-file system, or optional analysis is required for core execution.

## 32. Phase 1 acceptance checklist

Checked items mean **architecture documented**, not implementation verified. This audit ends here and waits for Phase 2.

| Done | Phase 1 deliverable | Canonical evidence |
| --- | --- | --- |
| [x] | Concrete component architecture | [Components](architecture/components.md#physical-boundary-and-dependency-direction) |
| [x] | Engine/runtime boundary | [Boundaries](architecture/components.md#data-crossing-each-boundary) |
| [x] | Worker architecture | [Worker responsibility](architecture/components.md#worker), section 7 |
| [x] | QuickJS/WASM assessment | [Runtime assessment](runtime.md#phase-1-runtime-architecture-assessment) |
| [x] | Runtime ownership | [Ownership table](architecture/components.md#mutable-state-ownership) |
| [x] | Execution flow | [Flow](architecture/flows.md#one-run-ordered-stages) |
| [x] | Initialization flow | [Flow](architecture/flows.md#initialization-flow) |
| [x] | Lifecycle architecture | [State transitions](architecture.md#lifecycle-states) |
| [x] | Cancellation architecture | [Flow](architecture/flows.md#cancellation-flow) |
| [x] | Timeout architecture | [Timeout table](architecture.md#timeout-policy) |
| [x] | Recovery architecture | [Recovery](architecture/flows.md#timeout-and-failure-recovery) |
| [x] | Stale-response architecture | [Identity invariant](protocol.md#stale-response-invariant) |
| [x] | Message protocol | [Grammar](protocol.md#grammar) |
| [x] | Message validation | [Validation outcomes](protocol.md#invalid-duplicate-and-late-message-outcomes) |
| [x] | Error architecture | [Taxonomy](api.md#program-errors-versus-engine-errors) |
| [x] | Resource-limit architecture | [Boundary owners](limits.md#boundary-ownership-audited-in-phase-1) |
| [x] | Security-boundary audit | [Threat model](security.md) |
| [x] | Network verification plan | [Acquisition vs execution](security.md#network-acquisition-versus-execution) |
| [x] | Storage verification plan | [Storage model](security.md#storage-model) |
| [x] | Browser compatibility matrix | [Matrix](testing.md#browser-matrix) |
| [x] | Distribution architecture | [Build boundary](runtime.md#phase-1-distribution-and-build-boundary) |
| [x] | Test architecture | [Layers and gates](testing.md) |
| [x] | Failure-mode matrix | [Matrix](architecture/flows.md#failure-mode-matrix) |
| [x] | Race-condition analysis | [Matrix](architecture/flows.md#race-condition-matrix) |
| [x] | State-ownership model | [Table](architecture/components.md#mutable-state-ownership) |
| [x] | Architecture diagrams | [Component](architecture/components.md), [flows](architecture/flows.md) |
| [x] | Stage 0 decision review | [Review table](decisions.md#phase-1-review-of-all-stage-0-decisions) |
| [x] | Phase 1 completion report | This document, sections 1–32 |

The architecture now answers runtime identity, location/ownership/boot/destruction/recreation; boundaries; `run()` sequence; validation/limit/normalization positions; state transitions and failure exits; hard cancellation; ID/generation/stale handling; expected capabilities and unverified actual behavior; distribution asset needs; and independent verification strategy. The remaining questions are assigned to Phase 2 empirical work. **Stop after this audit.**
