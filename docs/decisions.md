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
