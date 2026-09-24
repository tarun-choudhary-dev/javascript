# Stage 0 completion report

Date: 2026-09-24. **Stage 0 foundation is complete. Phase 1 has not started.** This report records an architecture and verification plan, not an implemented or certified sandbox. All runtime/browser security behavior remains unverified in this project.

## 1. Project definition

Working identity: **JavaScript Browser Engine**, private package `javascript-browser-engine`, foundation version `0.0.0-stage.0`. It is a reusable browser execution library consumed by independent applications. The repository was new apart from its initial commit and existing license; no prior IDE or execution engine was assumed.

Inside the engine: execution, initialization/lifecycle, request validation, bounded resources, cancellation/timeouts, reset/recovery, normalization, runtime metadata, protocol/security enforcement, and stale-response protection. Outside: editors, terminals, UI, routes/themes, project/file systems, application state, accounts, persistence, collaboration, and backends. [Project entry point](../README.md)

## 2. Architecture

The consumer calls `JavaScriptEngine`. Its host controller owns a dedicated Worker containing the trusted adapter and an embedded QuickJS/WASM guest. The Worker separates computation from the UI thread and supplies external termination. Guest capability isolation comes from the embedded environment and narrow host bridge, not from a Worker origin or deleted native globals.

The initial design omits an iframe broker because guest code receives no browser realm references; adding a broker now would add another bootstrap, origin/CSP, protocol, and recovery layer. This choice does not claim an opaque origin or protection against arbitrary adapter compromise. [Architecture and scope](architecture.md)

## 3. Runtime decision

Select Bellard **QuickJS 2025-09-13**, compiled to WASM through **`quickjs-emscripten-core` 0.32.0** plus **`@jitl/quickjs-wasmfile-release-sync` 0.32.0**. Guest source becomes QuickJS's private bytecode; it is not executed as host-native JavaScript. The binding provides guest heap/stack and interrupt controls with explicit host interoperation.

Research compared native Worker, native iframe, opaque iframe plus Worker, embedded QuickJS, and a JavaScript-written interpreter. QuickJS-NG was considered within the embedded family; Duktape was screened for language fit. Native options expose ambient browser capabilities and lack a portable guest heap quota. The selected baseline's runtime is older than current upstream; review intervening fixes before Phase 1 adoption. [Candidates, versions, reasons, and limitations](runtime.md)

## 4. Security model

All user-derived source, labels, output, exceptions, and messages are untrusted. Only bounded console methods are intentionally bridged into the guest. No browser DOM/global, parent state, network, storage, worker/channel, device, or module-loading capability is provided.

Trusted runtime acquisition can request static assets and the inspected glue uses same-origin credentials; this does not grant guest network access. No persistence is provided. The capability inventory records intended behavior and required probes, all unverified until real browser tests. Residual risks include binding/runtime/browser defects, supply-chain compromise, and browser-wide resource exhaustion. [Threat model and inventory](security.md)

## 5. Public API

The draft API contains `initialize`, `run`, `cancel`, `reset`, `dispose`, `isReady`, `isBusy`, `getState`, and `getRuntimeInfo`.

`run({ source, filename?, timeoutMs? })` admits one bounded synchronous Script when ready. It resolves to `{ status, stdout, stderr, durationMs, error, truncated }`. Program errors and engine failures are discriminated. Invalid requests/state before admission and failed lifecycle operations reject with `EngineError`. No OS-like exit code, arbitrary guest result object, worker handle, or analysis method is exposed. [Full contract](api.md)

The first profile, `script-sync-v1`, does not schedule Promise jobs, import modules, provide timers, or preserve guest variables between runs. This is an explicit boundary of the first implementation, not full browser/Node.js equivalence.

## 6. Lifecycle

States are `created`, `initializing`, `ready`, `busy`, `recovering`, `failed`, and terminal `disposed`. The transition and method tables define initialization coalescing, invalid calls, reset during initialization, cancellation during recovery, races, and exactly-once settlement.

Each initial/replacement boot is bounded. Recovery gets one attempt and then reaches `ready` or `failed`; explicit callers may retry. Normal runs destroy guest state while allowing trusted Worker/WASM reuse. Reset destroys the entire Worker/WASM instance. [Lifecycle rules](architecture.md#lifecycle-states)

## 7. Cancellation strategy

Revoke the old generation, detach its transport/timers, call `Worker.terminate()`, settle the admitted run, and create a fresh generation under a recovery deadline. Never rely on a flag or on a busy Worker receiving a cancel message. The interrupt hook supplements deadlines; external Worker termination remains the hard-stop mechanism.

Timeout and disposal follow the same invalidation principle. Browser suspension can delay host scheduling, so outcomes are deterministic once the host runs, without a strict real-time claim. [Cancellation, recovery, and timeout policy](architecture.md#cancellation-and-recovery-algorithm)

## 8. Resource-limit strategy

One internal versioned policy will govern source/filename, each output channel/combined output, formatting work, error/result/message sizes, chunk/message counts, guest heap/stack, and initialization/execution/recovery deadlines. Analysis budgets are separate future work.

Reject oversized requests before encoding/runtime work; bound guest strings before copying to host; validate both ends. Numeric values require JavaScript/browser calibration in Phase 1. Test `limit - 1`, `limit`, `limit + 1` and interactions. QuickJS allocator limits are not total browser memory limits. [Limit categories and enforcement](limits.md)

## 9. Message model

Private versioned JSON-string envelopes carry type, operation, request ID, generation, and exact bounded payloads. Messages are `init`, `ready`, `run`, `stream`, `result`, and `fatal`. Cancel/reset/dispose are controller-owned termination actions rather than cooperative messages.

Validate sender identity, size before parsing, schema, direction, operation/phase, ID/generation, lengths/ranges/totals, and sequencing. Stale Workers/events/timers are ignored before mutation. Malformed current-operation responses invalidate the runtime without escaping as uncaught host exceptions. [Protocol](protocol.md)

## 10. Repository structure

Created a private identity manifest, ignore rules, README, focused source/test ownership documents, and these design documents:

```text
docs/
  architecture.md
  runtime.md
  security.md
  api.md
  protocol.md
  limits.md
  testing.md
  licensing.md
  decisions.md
  stage-0-report.md
src/
  README.md
tests/
  README.md
```

The existing `LICENSE` is preserved. No runtime implementation, UI, dependency installation, build artifacts, dummy tests, empty module hierarchy, or framework was added. A scripts directory will be created when real build/test scripts exist.

## 11. Testing strategy

Unit -> runtime -> public API -> security -> distribution -> external consumer. Deterministic controller tests cover ordering; real browsers prove loading, runtime semantics, termination, and observable capability behavior. Shared behavioral tests run on both source and freshly built distribution.

A clean external project installs only a packed package and tests plain ESM and an independent bundler, nested asset paths, CSP/MIME/loading failure, and the public contract. Security tests observe receiver/network logs and host state canaries rather than equating CORS errors with blocked requests. [Testing plan](testing.md)

## 12. Browser compatibility plan

Chrome, Edge, Firefox, Safari, mobile browsers, and WebViews are **UNVERIFIED**. The matrix records exact browser/OS/build/policy plus WASM, Worker, CSP, runtime, cancellation, and known issues. Iframe behavior is marked not applicable to the selected architecture.

Use `TESTED` only after evidence for an exact combination; `SUPPORTED` requires an explicit maintained range. Missing Worker/WASM and `file://` deployment are unsupported by design, with no native-execution fallback. [Matrix and status definitions](testing.md#browser-matrix)

## 13. Licensing considerations

Preserve the repository's existing AGPL v3 text. Its project-specific `-only` versus `-or-later` designation needs owner clarification before publication; the manifest does not invent one.

The proposed binding, variant, FFI package and QuickJS use MIT notices. Emscripten 5.0.1 generated portions and linked support/data components require artifact-level auditing. No third-party code is currently distributed. Exact metadata/provenance, integrity evidence, notice obligations, unresolved compiled-input inventory, and publication gates are recorded separately from the project license. [License audit](licensing.md)

## 14. Architectural decisions

Nine decision records cover the engine boundary, explicit runtime pin, capability/iframe strategy, fresh state and synchronous profile, hard cancellation/bounded recovery, public results/errors, bounded protocol/limits, separate analysis/browser evidence, and existing license preservation. Each records alternatives, reasons, trade-offs, known limitations, and future consequences. [Decision log](decisions.md)

## 15. Known risks

- Security behavior has not yet been demonstrated in a browser; WASM/binding/runtime bugs and host callback mistakes remain possible.
- The selected package embeds an older QuickJS version; freshness/advisory review may require changing the pin or build.
- Worker termination/timers depend on browser scheduling; tab/process crashes and total memory exhaustion exceed library guarantees.
- Manual handles and large strings/output can cause leaks or host-side allocation pressure unless carefully bounded before copying.
- Asset URLs, browser entry selection, MIME, CSP, and cold/warm loading can behave differently in source and distribution.
- The synchronous profile deliberately excludes Promise continuation and async error tracking; consumers must not confuse the Promise-returning API with a guest event loop.
- Full compiled-asset licensing/provenance and the project license designation are not yet release-ready.

## 16. Open questions and when they must close

These are measured implementation/publication gates, not unresolved choices about the engine boundary or public lifecycle.

| Question | Closure point |
| --- | --- |
| Do intervening QuickJS/binding security fixes require a new pin/rebuild? | Phase 1 dependency adoption, before hostile guest testing |
| What numeric limits protect target devices without rejecting ordinary scripts? | Phase 1 calibration, before enabling untrusted workloads |
| Can bounded guest string/error extraction and conservative resource-failure classification meet the contract with this binding? | First adapter proof, before public API acceptance |
| Which actual asset layout/CSP/bundler settings work without consumer knowledge of runtime internals? | Phase 1 source/distribution/external-consumer proof |
| Which browser versions can receive a maintained support promise? | After matrix evidence; before support claims |
| Does project licensing intend AGPL v3 only or later, and are all binary notices/provenance complete? | Owner clarification and artifact audit before publication |
| Is async/module/AST functionality worth a later profile/API? | A separately requested future stage, not a blocker for `script-sync-v1` |

No values or approvals are inferred from silence. There is enough architectural clarity to begin an explicitly authorized Phase 1; there is not yet evidence to release an untrusted-code engine.

## 17. Recommendation for Phase 1

After separate authorization, first implement a small browser validation harness for the chosen runtime/Worker boundary, fixed assets, capability inventory, console bridge, hard loop interruption, and fresh recovery. Review runtime freshness and complete bounded extraction/resource-classification feasibility before expanding the adapter.

Then implement the documented small API and lifecycle with central calibrated limits, exact message validation, and source/distribution/external-consumer tests. Any failed security premise requires revisiting the decision log. Do not add an IDE, persistence, packages, multiple files, optional analysis, or async scheduling as part of that first execution foundation.

**Stop here for Stage 0. Await Phase 1 instruction.**

## Deliverable traceability

Checked items indicate that a design/documentation deliverable exists, not that its future runtime behavior has passed tests.

| Complete | Stage 0 deliverable | Evidence |
| --- | --- | --- |
| [x] | Project identity defined | README, package.json, section 1 |
| [x] | Scope defined | architecture.md, section 1 |
| [x] | Engine/IDE boundary defined | architecture.md, section 2 |
| [x] | JavaScript runtime candidates researched | runtime.md |
| [x] | Runtime selection criteria documented | runtime.md, decisions.md |
| [x] | Security boundary defined | security.md |
| [x] | Threat model documented | security.md |
| [x] | Network model documented | security.md, runtime.md |
| [x] | Storage model documented | security.md |
| [x] | Browser capability inventory created | security.md |
| [x] | Public API draft created | api.md |
| [x] | Result model drafted | api.md |
| [x] | Lifecycle model drafted | architecture.md |
| [x] | Cancellation strategy drafted | architecture.md |
| [x] | Timeout strategy drafted | architecture.md, limits.md |
| [x] | Stale-response strategy drafted | protocol.md, architecture.md |
| [x] | Resource-limit categories defined | limits.md |
| [x] | Message protocol concept defined | protocol.md |
| [x] | Analysis boundary defined | api.md, runtime.md |
| [x] | Initial repository structure created | README, src/README.md, tests/README.md |
| [x] | Documentation structure created | docs/ |
| [x] | Testing strategy defined | testing.md |
| [x] | Browser compatibility strategy defined | testing.md |
| [x] | Licensing audit plan defined | licensing.md |
| [x] | Architectural decisions recorded | decisions.md |

All acceptance topics have a documented answer: architecture (sections 1–2), runtime (3), security (4), API (5), lifecycle (6), cancellation (7), limits (8), distribution (3/10/13 and runtime.md), and testing (11–12). Outstanding browser tests, measured limits, and publication audits are explicitly assigned to later authorized work.

## Foundation review performed

Validated the private package manifest as JSON, all 17 report sections, Markdown fence balance, local document links/anchors, text whitespace, and preservation of the existing license. Reviewed API/state/protocol/limit terminology for consistency. Runtime research checked exact registry/source versions and independently matched the selected variant archive's integrity. No runtime, browser, security, build, or external-consumer tests were run because their implementation belongs to Phase 1; this report does not present documentation checks as execution evidence.
