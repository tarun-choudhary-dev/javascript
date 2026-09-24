# Architectural decisions

Status: accepted Stage 0 design baseline, 2026-09-24. Accepted here means the chosen plan; implementation, security behavior, and browser support are not verified. Revisit a decision when its evidence gate fails and record the reason before changing the public contract.

## ADR-001 — Engine boundary and browser delivery

| Item | Record |
| --- | --- |
| Decision | Build a standalone browser ESM engine with a small public class and static runtime assets |
| Alternatives considered | IDE-owned execution logic, playground application, server execution service, CLI |
| Reason | Independent applications need reusable execution without understanding Worker/runtime internals |
| Trade-offs | Asset deployment must be documented and tested without assuming one host framework |
| Known limitations | Browser resource/scheduling constraints remain; no backend escape hatch |
| Future consequences | UI, persistence, projects, accounts and collaboration stay outside; external-consumer tests are release gates |

## ADR-002 — Explicit embedded runtime

| Item | Record |
| --- | --- |
| Decision | QuickJS 2025-09-13 via core/release-sync packages 0.32.0, running in a dedicated Worker |
| Alternatives considered | Native Worker, native iframe, opaque iframe + native Worker, JS-Interpreter, QuickJS-NG variant; Duktape screened out |
| Reason | Explicit guest capabilities plus guest heap/stack/interrupt controls fit requirements better than ambient browser globals |
| Trade-offs | WASM download/startup and interpreter performance; more runtime/binding ownership than native eval |
| Known limitations | Version lag, manual handles, host bridge bugs, runtime/WASM/browser vulnerabilities, no total-tab memory cap |
| Future consequences | Pin embedded version separately from package version; review newer upstream fixes before adoption; fail closed if runtime unavailable; rerun conformance/security/distribution tests on upgrades |

See [candidate research and exact provenance](runtime.md). The chosen dependency is a research baseline pending Phase 1 freshness review, not a recommendation to run an unaudited old binary on hostile workloads.

## ADR-003 — Capability boundary and iframe decision

| Item | Record |
| --- | --- |
| Decision | Keep all guest evaluation in QuickJS/WASM; expose only bounded console methods; no iframe in initial architecture |
| Alternatives considered | Deleting native globals, CSP-only sandbox, iframe broker around native or embedded execution |
| Reason | A guest with no native references needs no DOM/browsing context. Removing browser globals is fragile; a broker adds origin/bootstrap/lifecycle complexity |
| Trade-offs | Adapter is trusted and its Worker retains ambient origin capabilities; no second origin boundary against its compromise |
| Known limitations | WASM/binding/host callback vulnerabilities can invalidate capability assumptions; no opaque-origin claim |
| Future consequences | Any new host bridge requires capability, network, storage, and resource review. Add an opaque/separate-origin layer only with a new threat-model decision and verified loading/policy/termination behavior |

## ADR-004 — State and first execution profile

| Item | Record |
| --- | --- |
| Decision | `script-sync-v1`: single Script, fresh guest runtime/context per run, warm Worker/WASM allowed, completion value ignored |
| Alternatives considered | Persistent REPL variables, module mode, implicit async wrapper, Promise job scheduler, arbitrary serialized return values |
| Reason | Make first execution semantics and cleanup bounded and reviewable without adding sessions, loaders, or an event loop |
| Trade-offs | No stateful REPL or useful asynchronous program continuation; application must resend any desired state as source |
| Known limitations | Promise intrinsics can create jobs but this profile discards them; detached rejections are not all reported; Date/random output varies |
| Future consequences | Async execution/modules/value serialization require explicit profile/result decisions and tests; reset still rebuilds underlying Worker/WASM, beyond fresh per-run guest state |

## ADR-005 — Hard cancellation and bounded recovery

| Item | Record |
| --- | --- |
| Decision | Host invalidates generation and terminates Worker on cancellation/timeout/runtime integrity failure, then makes one replacement attempt |
| Alternatives considered | Boolean flag, cooperative cancel message, wait-only timeout, reusing interrupted guest state, infinite automatic retry |
| Reason | A busy JavaScript/WASM loop cannot reliably process messages; old execution must actually stop |
| Trade-offs | Interrupted state is lost; recovery has startup latency and may fail |
| Known limitations | Browser suspension delays watchdog tasks; no OS-process termination acknowledgment or real-time guarantee |
| Future consequences | `failed` is an explicit stable state; retries are caller-controlled; request IDs/generations guard every async callback; disposal is terminal |

## ADR-006 — Small API and error/result ownership

| Item | Record |
| --- | --- |
| Decision | Lifecycle methods and state/runtime queries only; reject pre-admission/control failures with EngineError; resolve admitted runs with discriminated results |
| Alternatives considered | Throw every program exception, return raw guest values/Errors, unify engine failures with JS exceptions, OS-like exit codes, public transport/stream API |
| Reason | Consumers need predictable results and clear responsibility for program versus infrastructure failures |
| Trade-offs | Consumers handle both rejected admission/control promises and resolved run status; arbitrary expression evaluation is not returned |
| Known limitations | Error names/stacks are guest data and not stable across runtime versions; conservative fallback needed for ambiguous resource failures |
| Future consequences | Keep codes/result invariants versioned; avoid API expansion until behavior is justified; no inferred process exit semantics |

## ADR-007 — Private bounded protocol and centralized budgets

| Item | Record |
| --- | --- |
| Decision | Versioned JSON-string messages with direction/op/generation/request IDs, exact schemas, finite chunks, and one internal limits policy |
| Alternatives considered | Arbitrary structured-clone payloads, generic RPC, request ID alone, unlimited streaming, scattered constants |
| Reason | Small schemas and explicit identity make validation, quotas, and stale-event races auditable |
| Trade-offs | JSON encoding overhead and derived escaping budgets; browser clones messages before host validation |
| Known limitations | A compromised native sender can allocate/flood before validation; one engine's budgets do not cap all engines in a tab |
| Future consequences | Calibrate values for JavaScript in Phase 1; test boundaries and combined limits; protocol changes must update validators and fault-injection tests |

**Wire-shape note, 2026-09-24:** The bounded protocol/policy choice remains. Its Worker engine-error `message` field is removed because the host never uses it; see [ADR-011](#adr-011--omit-unused-worker-engine-error-text). Its Phase 1 numeric calibration expectation is superseded by [ADR-010](#adr-010--phase-1-is-architecture-only).

## ADR-008 — Separate analysis and honest compatibility

| Item | Record |
| --- | --- |
| Decision | No public analysis/compile APIs or parser dependency now; no supported-browser claim until evidence |
| Alternatives considered | AST generation on every run, parser as execution gate, claiming support from browser feature tables alone |
| Reason | Reliable execution is the first goal; parser/runtime semantics can differ and browser packaging needs real verification |
| Trade-offs | Syntax diagnostics initially come only from actual guest evaluation; no tokens/AST/formatting |
| Known limitations | QuickJS exposes no stable general AST API; external parser would add grammar/version/license work |
| Future consequences | Analysis gets separate limits/lifecycle if added; source/build/external-consumer tests must agree; record exact browser builds and policies |

## ADR-009 — Preserve license and defer dependency installation

| Item | Record |
| --- | --- |
| Decision | Preserve existing AGPL text; keep Stage 0 package private with no implementation/dependencies; record exact runtime/license evidence |
| Alternatives considered | Replace project license with MIT, assume `-or-later`, install a full framework/runtime during architecture work, publish placeholders |
| Reason | Existing ownership/licensing choices are not ours to replace; Stage 0 is a foundation and research task |
| Trade-offs | Exact project designation and full compiled-asset notice inventory remain publication gates |
| Known limitations | Package license metadata alone does not audit WASM support libraries or reproduce binaries |
| Future consequences | Confirm owner designation and finish artifact-level audit before distribution; add lock/build/test tooling only when Phase 1 is authorized |

**Scheduling note, 2026-09-24:** The Phase 1 request authorizes an architecture audit only. Its implementation timing replaces the earlier Stage 0 expectation that runtime integration, tests, and numeric limit calibration would occur in Phase 1. The licensing decision itself is unchanged. See [ADR-010](#adr-010--phase-1-is-architecture-only).

## Phase 1 review of all Stage 0 decisions

The status below reviews the **design choice**. `CONFIRMED` does not mean its future browser behavior has passed a test. The evidence column separates source/documented behavior from unverified integration. Phase 1 performs no execution experiment.

| Stage 0 decision | Status | Evidence and reason | Impact on current architecture |
| --- | --- | --- | --- |
| ADR-001 Engine boundary/browser delivery | CONFIRMED | Stage 0 scope and external-consumer requirement; no contrary evidence | Public facade remains independent of IDE/host UI; static assets only |
| ADR-002 QuickJS/WASM in Worker | CONFIRMED as candidate; runtime behavior UNVERIFIED | Pinned [binding APIs and variant build](runtime.md#phase-1-runtime-architecture-assessment) document boot, runtime creation, limits; no browser integration yet | Retain exact research pin, require freshness/asset/capability/termination evidence before adoption |
| ADR-003 Narrow capability boundary/no iframe | CONFIRMED as design; security behavior UNVERIFIED | Embedding removes intentional browser API bridge; no browser escape/network/storage tests | Adapter remains trusted and Worker retains ambient capabilities; [security matrix](security.md#browser-capability-inventory) stays unverified |
| ADR-004 Fresh runtime/context and synchronous Script | CONFIRMED as contract; cleanup behavior UNVERIFIED | Binding documents runtime/context creation and disposal; pending jobs require explicit pumping | Warm WASM/Worker permitted, guest runtime/context destroyed every clean run; Promise jobs discarded |
| ADR-005 Hard Worker termination and one recovery | CONFIRMED as design; actual latency UNVERIFIED | [HTML Worker termination algorithm](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker) documents script abortion | Controller owns revoke/terminate/recover; one bounded attempt, then failed |
| ADR-006 Small API and error separation | CONFIRMED as draft; extraction feasibility UNVERIFIED | Public [API](api.md), [failure analysis](architecture/flows.md#failure-mode-matrix) resolve all classes conceptually | Preserve admitted-run results and pre-admission/control rejections; verify bounded guest-error extraction later |
| ADR-007 Versioned bounded protocol/limits | MODIFIED only for engine-error wire field; throughput/quotas UNVERIFIED | [Message grammar](protocol.md), [ownership](architecture/components.md#mutable-state-ownership), and [limit boundary table](limits.md#boundary-ownership-audited-in-phase-1) | Single immutable policy; Worker and host validate independently; omit unused Worker engine message. See ADR-011 |
| ADR-008 Separate analysis/honest compatibility | CONFIRMED | No general QuickJS AST API selected; no engine/browser test run | No analysis API or support claim; test matrix remains unverified |
| ADR-009 Existing license/deferred installs | MODIFIED only for phase scheduling | Existing [LICENSE](../LICENSE) unchanged; new Phase 1 request excludes implementation and package installation | Keep private manifest and dependency audit; move build/lock/testing work to Phase 2. See ADR-010 |

No runtime, isolation, public contract, or licensing decision was silently replaced. The changed schedule and smaller internal wire schema are recorded below; the Stage 0 report remains an immutable historical account of what was recommended at its completion.

## ADR-010 — Phase 1 is architecture only

| Item | Record |
| --- | --- |
| Previous decision | Stage 0 report and ADR-009 anticipated runtime proof, dependency/tooling setup, and numerical calibration in Phase 1. |
| Reason for reconsideration | The new [Phase 1 request](stage-1-report.md#2-stage-0-baseline) explicitly defines an architecture audit and prohibits engine/Worker/QuickJS/API implementation and publishing. |
| Evidence | User's Phase 1 instruction in this session; repository remains design-only. No new browser/runtime experiment supports changing the runtime choice. |
| Alternatives considered | Follow Stage 0 timing and build a harness now — conflicts with Phase 1 boundary; defer the whole audit — leaves ownership/races ambiguous. |
| New decision | Complete concrete ownership, flow, failure, protocol, security, distribution, and test architecture in Phase 1. Move browser validation, dependency adoption, implementation, limit calibration, and distribution tests to Phase 2 prerequisites. |
| Trade-off | Security and runtime feasibility remain unverified longer; the design is more reviewable before code is written. |
| Impact | Living docs use Phase 2 for implementation gates; historical Stage 0 report is preserved. This decision does not authorize a particular runtime implementation or publication. |

## ADR-011 — Omit unused Worker engine-error text

| Item | Record |
| --- | --- |
| Previous decision | ADR-007's Stage 0 protocol made a Worker `result.error` public-shaped, including an engine-error `message` that the host would ignore and replace. |
| Reason for reconsideration | A wire field that is neither trusted nor used adds parsing, size, and validation work without helping the public contract. |
| Evidence | The [public API](api.md#execution-result) needs an engine-authored message; the [Phase 1 error ownership map](architecture/components.md#error-normalizer) assigns infrastructure wording to the host controller. The Stage 0 protocol itself already required the host to ignore Worker text. |
| Alternatives considered | Keep the bounded ignored field — backward compatible with an unimplemented private draft but unnecessarily redundant; trust Worker wording — would allow guest/adapter text to masquerade as engine diagnosis. |
| New decision | Worker `engine-error` wire payload is exactly `{kind:"engine",code}`. Host validates code and adds a fixed bounded message to the public `EngineErrorData`. Program errors still carry bounded guest name/message/stack/filename. |
| Trade-off | Wire error shape differs from public error shape and needs an explicit normalizer; this boundary already exists for stdout/stderr/duration and does not add a public API. |
| Impact | [Protocol grammar](protocol.md#field-types-sizes-and-failure-ownership) and fault injection must enforce the smaller shape; public API/result model remains unchanged. No current implementation or consumer is broken. |
