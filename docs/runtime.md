# Runtime research and selection

Research date: 2026-09-24; Phase 1 architecture audit added below. This is a documentary/source/package inspection, **not a browser execution experiment**. Browser behavior and security claims remain unverified until [tests](testing.md) are run. Version identifiers below are research baselines, not automatic update ranges.

## Criteria

The initial engine needs modern core JavaScript, a browser-only deployment, a guest environment without ambient browser authority, termination of arbitrary loops outside the UI thread, practical heap/stack controls, bounded host interoperation, documented licensing, and distributable pinned assets. Browser API compatibility, peak JIT performance, persistent REPL sessions, Node.js compatibility, and debugging/AST APIs are not initial requirements.

## Serious candidates

### Browser-native JavaScript in a dedicated Worker

| Attribute | Finding |
| --- | --- |
| Runtime / version | Browser's V8, SpiderMonkey, or JavaScriptCore; version follows the exact browser build, not a separately pinned engine dependency |
| Execution model | Browser parses/compiles/interprets or JITs source in a Worker global; native guest execution |
| Browser requirements | Dedicated Worker and a permitted script origin/CSP; module Worker if ESM bootstrap is chosen |
| Worker support | Native by definition; off the document's main execution context |
| Cancellation | Owner can call `Worker.terminate()`; recreate for clean state |
| Memory behavior | Browser-managed heap; no standard portable per-Worker hard heap cap |
| Network behavior | Fetch, XMLHttpRequest, WebSocket, script loading and other browser capabilities may exist; CSP can restrict some channels |
| DOM access | No document DOM, but no promise of process separation |
| Storage access | IndexedDB/Cache Storage may be available; no direct document localStorage/sessionStorage/cookie API |
| Global object access | Guest controls real WorkerGlobalScope and built-ins; may reach additional Worker APIs |
| Licensing | Browser runtime is supplied by the user agent, not redistributed in the engine package; engine-owned adapter still needs project licensing |
| Distribution | Library and Worker script; no embedded runtime binary |
| Known limitations / decision | Rejected as guest runtime: removing named globals is not a robust capability boundary, portable memory controls are insufficient, and browser versions change semantics |

Evidence: [Worker interfaces and lifecycle](https://html.spec.whatwg.org/multipage/workers.html), [Fetch exposure](https://fetch.spec.whatwg.org/#fetch-method), and [IndexedDB exposure](https://w3c.github.io/IndexedDB/#idbfactory).

### Native JavaScript in an isolated iframe

| Attribute | Finding |
| --- | --- |
| Runtime / version | Embedding browser's engine; record exact browser version at test time |
| Execution model | Native script in a browsing context, optionally `sandbox="allow-scripts"` without `allow-same-origin` |
| Browser requirements | Iframe sandbox, permitted frame/script CSP, message communication |
| Worker support | Not needed for this candidate; optional nested Worker becomes the next candidate |
| Cancellation | Removing/navigating frame is not a portable independent hard-stop API for a loop blocking a shared main thread |
| Memory behavior | Browser-managed, no portable per-frame quota |
| Network behavior | Opaque origin does not mean no requests; scripts, fetches, images, navigation, and other channels need policy and tests |
| DOM access | Own document DOM remains available; origin/sandbox rules restrict parent access |
| Storage access | Opaque origin restricts origin storage, but iframe fetching/cookie behavior needs verification; sandbox alone is no universal network credential policy |
| Global object access | Real Window, references such as parent/top, and browser APIs subject to restrictions |
| Licensing | No redistributed runtime; project owns frame/bridge code |
| Distribution | Library plus trusted frame document/bootstrap and deployment policy |
| Known limitations / decision | Rejected: no adequate independent cancellation guarantee and unnecessary guest DOM/browser exposure |

Evidence: [HTML iframe sandbox rules](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox) and [sandbox flags](https://html.spec.whatwg.org/multipage/browsers.html#sandboxing). Never combine same-origin content, `allow-scripts`, and `allow-same-origin` as a claimed untrusted-content boundary.

### Sandboxed iframe plus native Worker

| Attribute | Finding |
| --- | --- |
| Runtime / version | Browser engine, version coupled to browser; HTML/CSP integration also browser-specific |
| Execution model | Trusted broker in opaque iframe owns a Worker running guest source natively |
| Browser requirements | Sandbox, Worker startup under opaque origin, MessageChannel/postMessage, compatible CSP and asset/blob loading |
| Worker support | Required; opaque-origin URL and policy behavior must be tested |
| Cancellation | Broker terminates Worker; broker/host failure and timeout paths also needed |
| Memory behavior | No portable guest heap quota; broker adds another context |
| Network behavior | Origin isolation does not disable Worker requests; scoped CSP and channel coverage needed |
| DOM access | Worker has no DOM; broker has a document but must never evaluate guest code |
| Storage access | Opaque-origin restrictions help; actual nested Worker storage behavior requires browser tests |
| Global object access | Real WorkerGlobalScope remains visible to guest; broker channel must resist forgery/flooding |
| Licensing | Browser runtime not distributed; broker/Worker glue is project code |
| Distribution | Library, frame bootstrap, Worker, strict policies; deployment complexity increases |
| Known limitations / decision | Rejected initially: improves origin separation but retains native capability/memory concerns and adds another lifecycle/protocol layer |

Evidence: [Worker startup and origins](https://html.spec.whatwg.org/multipage/workers.html#dom-worker), [CSP worker source control](https://www.w3.org/TR/CSP3/#directive-worker-src). This candidate was considered seriously; no claim is made that opaque-origin Worker startup has been validated here.

### Embedded QuickJS compiled to WebAssembly in a dedicated Worker — selected

| Attribute | Finding / chosen policy |
| --- | --- |
| Runtime / version | Bellard QuickJS **2025-09-13**, via `quickjs-emscripten-core` **0.32.0** and `@jitl/quickjs-wasmfile-release-sync` **0.32.0** |
| Execution model | QuickJS C interpreter compiled to WASM; guest JS becomes private QuickJS bytecode, not guest WASM or browser-native JS |
| Browser requirements | WebAssembly, dedicated module Worker, ESM, BigInt/typed arrays used by generated glue, structured clone, permitted WASM/script loading; prove actual build requirements in browser matrix |
| Worker support | Browser-targeted glue detects Worker context; engine uses one trusted Worker adapter |
| Cancellation | QuickJS interrupt hook for guest deadline checks plus owner-controlled `Worker.terminate()`; replacement discards complete WASM instance |
| Memory behavior | `setMemoryLimit`, `setMaxStackSize`; WASM growth and wrapper/host allocations remain additional costs, not a tab-wide quota |
| Network behavior | No host functions exposed by default; only console will be installed. Trusted glue loads WASM using browser requests; no guest network/module bridge |
| DOM access | No guest DOM; browser DOM objects never passed into interpreter |
| Storage access | No guest browser storage APIs or host filesystem bridge |
| Global object access | QuickJS's own globals/intrinsics; no Window, WorkerGlobalScope, Node globals, or parent application references |
| Licensing | Binding/variant/QuickJS MIT; generated Emscripten and linked support code audited separately |
| Distribution | Library ESM, trusted Worker bundle with binding/glue, versioned `.wasm`, declarations and notices; all assets may be self-hosted |
| Known limitations | Slower than browser JIT for many workloads; no browser/Node APIs; manual handle ownership; embedded semantics/version lag; FFI/compiler/browser vulnerabilities remain possible |

Source evidence: [pinned QuickJS version](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/vendor/quickjs/VERSION), [runtime controls](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/quickjs-emscripten-core/src/runtime.ts), [variant build](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/variant-quickjs-wasmfile-release-sync/Makefile), and [upstream host interoperation](https://github.com/justjake/quickjs-emscripten#exposing-apis).

### JavaScript interpreter written in JavaScript

| Attribute | Finding |
| --- | --- |
| Runtime / version | Neil Fraser JS-Interpreter source snapshot **45d00b0c86e48cca1bb3af0f711bc4c0d626c359**; npm `js-interpreter` **6.0.2** is an independently packaged aminmarashi fork, not an upstream release number |
| Execution model | Parse to an AST and interpret it in host JavaScript; upstream describes ES5 execution |
| Browser requirements | JavaScript, bundled interpreter/parser; Worker needed for this project's independent termination |
| Worker support | Interpreter can be hosted in a Worker; integration not verified in this project |
| Cancellation | Cooperative stepping is possible; still terminate Worker to cover blocked host callbacks/parser work |
| Memory behavior | Interpreter data uses browser JS heap; no portable hard cap for all allocations |
| Network behavior | Host capabilities require deliberate bridges; guest need not receive fetch |
| DOM access | Not intrinsic to the interpreter; requires a bridge |
| Storage access | Not intrinsic; requires a bridge |
| Global object access | Interpreted environment; bridges and interpreter correctness form boundary |
| Licensing | Apache-2.0 for interpreter; audit parser/transitives separately if ever adopted |
| Distribution | Interpreter and parser JavaScript plus Worker adapter, no WASM required |
| Known limitations / decision | Rejected for initial engine: ES5-oriented semantics and host heap behavior do not meet modern core JavaScript/resource goals; useful for instructional stepping |

Evidence: [upstream scope at inspected revision](https://github.com/NeilFraser/JS-Interpreter/tree/45d00b0c86e48cca1bb3af0f711bc4c0d626c359), [independent npm package metadata](https://registry.npmjs.org/js-interpreter/6.0.2), [upstream license](https://github.com/NeilFraser/JS-Interpreter/blob/45d00b0c86e48cca1bb3af0f711bc4c0d626c359/LICENSE). The npm metadata identifies `aminmarashi/JS-Interpreter`, revision `81d64c2da98e3e97f9df8a379951d71482185828`, and a `minimist` dependency; adoption would require checking that distribution rather than equating it with upstream source. Neither is installed here.

## Related options screened

QuickJS-NG is a serious alternative within the same embedded architecture. The 0.32.0 binding's NG variant vendors **v0.12.1**, while upstream's release page observed during research reports **v0.17.0**. Its Worker/WASM requirements, cancellation mechanism, capability policy, storage/network model, and distribution approach are the same as the selected variant; its runtime semantics, upstream changes, and binary/license provenance need a separate pin and regression pass. Both use MIT licensing. Select the explicit Bellard variant now to avoid silently switching runtime families; do not mistake the newest NG release for the vendored binary. [Vendored version](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/vendor/quickjs-ng/VERSION), [NG license](https://github.com/quickjs-ng/quickjs/blob/master/LICENSE), [observed upstream release](https://github.com/quickjs-ng/quickjs/releases/tag/v0.17.0).

Duktape **2.7.0** was screened out before deep integration research because its documented language baseline is ES5/E5.1 with selected later features; it would also require a maintained browser/WASM binding. No Duktape artifact is selected or distributed. [Duktape scope](https://duktape.org/), [release downloads](https://duktape.org/download.html).

SES/realm lockdown would still need an independent Worker for hard interruption and does not itself establish a portable hard heap budget. It adds host-realm hardening work without removing the need to audit granted capabilities. It is not a selected dependency. A custom interpreter or a V8-to-WASM port would substantially expand engine maintenance; no requirement justifies building one in Stage 0.

## Exact artifact evidence

The registry records all selected 0.32.0 packages at git revision `df4efb9ef2cb25c417ecb57986da462d11b244ed`. The selected variant's build file identifies `QUICKJS_LIB=quickjs`, Emscripten **5.0.1**, imported/growing WASM memory, a 5 MB build-time stack, and filesystem support disabled. These build settings are evidence about that artifact, **not recommended engine limit values**. QuickJS's guest stack limit is separate from the compiled WASM stack allocation.

The published variant tarball was downloaded outside this repository and its SHA-512 integrity matched the registry. Its contents include browser ESM glue, `.wasm`, binding files/types/maps, and a license containing both binding and QuickJS notices. No package lifecycle scripts or guest programs were executed. The repository contains none of that third-party code.

The inspected browser glue uses `fetch(..., { credentials: "same-origin" })` for WASM, attempts streaming instantiation, and has array-buffer/synchronous-XHR fallback paths. Initialization can therefore make more than one request on a failed load. A textual scan of that glue found no direct `eval`/`new Function`; this is **not** proof of CSP compatibility of the complete bundle. Phase 2 must verify the actual production asset graph. [Published variant metadata/tarball location](https://registry.npmjs.org/@jitl/quickjs-wasmfile-release-sync/0.32.0)

Upstream Bellard QuickJS now advertises a **2026-06-04** release. The selected npm binary still identifies the older vendored source. Pinning gives a reproducible research baseline, not a security freshness guarantee: review intervening fixes and advisories before adopting the runtime in Phase 2. If a rebuild or different pin is needed, update this record and rerun all boundary tests. [Upstream releases](https://bellard.org/quickjs/)

## Language, errors, and analysis

The pinned runtime documents broad ES2024 support. It is not an assurance of complete conformance, browser Web APIs, or equivalence with each browser's current native engine. The engine further narrows its first profile to [synchronous Script execution](api.md#execution-semantics). Unsupported async jobs/imports and return-value behavior are part of that contract, not accidental omissions.

Guest parsing/evaluation errors are exposed by the binding as guest handles. Normalize within the bounded Worker adapter; distinguish these from controller timeouts, Worker errors, WASM traps, malformed messages, and resource failures. Never use the convenience unbounded guest-object dump path for public results.

QuickJS compiles directly to its own bytecode and does not provide a supported general-purpose ESTree AST interface. Its bytecode is runtime-version-dependent and is not a safe untrusted interchange format. No bytecode loading/export or public `compile()` API is justified now. A later parser such as Acorn could supply AST/tokens separately, with its own exact version, license, syntax mode, input/output limits, and tests for differences from QuickJS. Parser acceptance must not be presented as proof that the execution runtime accepts or safely runs the same program. [Pinned runtime internals and bytecode warnings](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/vendor/quickjs/doc/quickjs.texi)

## Distribution decision

Future consumers install a browser ESM library or self-host its build artifacts. Ship a public entry point and declarations, a dedicated module Worker bundle (binding and browser glue included), one versioned WASM file, and license/notice/provenance files. Export only the public engine contract; hide adapter entry points as internal assets. Exact filenames are a Phase 2 build choice.

Use local package-relative assets, no default CDN, no runtime `latest` URLs, and no user-specified code URLs. A consumer serves static files with correct JavaScript/WASM MIME types and appropriate CSP; no custom server executes source. Offline use is possible only after assets have been delivered/cached by the host deployment; the engine registers no Service Worker and supplies no persistent cache API. `file://` is outside the deployment target.

Development tooling runs under Node; guest execution remains in the browser. Do not choose a bundler before testing this selected package's actual browser entry points and Worker/WASM URL resolution. A blocked Worker/WASM/CSP requirement must fail initialization with an engine error, not silently reduce isolation.

## Phase 1 runtime architecture assessment

The exact package family remains the **PROPOSED** runtime. Evidence from the pinned [binding documentation](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/README.md) and [runtime source](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/quickjs-emscripten-core/src/runtime.ts) supports the following API shape. It does not establish that our future Worker bundle works securely in a target browser.

| Question | Architectural answer | Evidence status |
| --- | --- | --- |
| How is QuickJS loaded? | Trusted module Worker imports `quickjs-emscripten-core` and the exact release-sync variant, then calls the binding's variant loader. Worker script/ESM loading occurs before its adapter can process `init`. | **DOCUMENTED** package/binding API; produced bundle and CSP **UNVERIFIED** |
| How is WASM initialized? | Variant loader asynchronously acquires/compiles/instantiates the pinned WASM file in the Worker; only a validated boot response marks host ready. | **DOCUMENTED** binding and inspected glue; actual load graph **UNVERIFIED** |
| Where do assets come from? | Engine-owned package-relative Worker/variant/WASM URLs in the consumer's static deployment, fixed by the installed build, never from guest source or filename. | **PROPOSED** layout; bundler/subpath resolution **UNVERIFIED** |
| How does source reach execution? | The host sends a bounded string in the private run envelope; adapter creates a fresh QuickJS runtime and context and calls the binding's Script evaluation API. | **DOCUMENTED** binding eval/runtime APIs; our transport/adapter **PROPOSED** |
| How do output/results return? | Only the bounded console bridge can emit internal stream chunks; guest completion value is discarded; a final result follows handle/context/runtime cleanup. | **PROPOSED**; no browser observation |
| How do exceptions return? | Binding provides a guest exception handle. Adapter extracts bounded guest data under the deadline; host validates and maps it to `program-error`, while transport/WASM/allocator integrity failures remain engine errors. | Handle API **DOCUMENTED**; safe bounded extraction/classification **UNVERIFIED** |
| What is reused? | On a clean run, keep the Worker and instantiated WASM module; create/dispose a new QuickJS runtime **and** context each time. Never reuse guest globals, handles, module loader, or pending jobs. | Creation/disposal APIs **DOCUMENTED**; repeated cleanup/memory behavior **UNVERIFIED** |
| What is destroyed on invalidation? | Controller revokes generation and terminates entire Worker. Browser discards its adapter/WASM/guest ownership; a new Worker loads assets and creates a fresh WASM instance. | Worker termination semantics **DOCUMENTED** by [HTML](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker); actual recovery **UNVERIFIED** |
| Can it be safely reused? | A **clean** Worker/WASM may be reused after explicit per-run QuickJS disposal; any trap, timeout, cancellation, malformed current response, or failed cleanup destroys the Worker. | Policy **PROPOSED**; leak/conformance/escape testing **UNVERIFIED** |

One QuickJS runtime owns its heap; a context is a realm within it. Replacing only the context is insufficient for this contract because runtime-level allocations/jobs/settings may survive. Replacing the runtime/context after every normal run gives fresh guest state while retaining the trusted WASM module. Reset and invalidation replace the Worker/WASM as well. A warm WASM allocation can retain memory high-water marks; no secure erasure or total-browser-memory bound is claimed.

**Synchronous Script only:** do not install a module loader, timers, fetch, I/O, or a Promise job pump. Promise executors and async-function synchronous prefixes may execute; queued jobs are discarded with the runtime. The QuickJS CLI `std`/`os` modules are not installed. `eval` and `Function` remain inside the guest interpreter. This is a design contract, not verified guest capability behavior.

The adapter must not use `dump` or generic guest `toString` on untrusted values for public output. A bounded guest-side formatter/FFI extraction path is required so an oversized guest string is cut **before** full host copying; host watchdog and guest memory limit still apply during that work. Whether this can be implemented safely with the selected binding is a **Phase 2 feasibility gate**. If it cannot, the chosen adapter/runtime or output contract must be revisited before executing untrusted programs.

The concrete proposed bridge is a trusted QuickJS-side console wrapper prepared **before** guest source runs. It captures the guest string-slicing primitive and a single adapter-installed emit function in a closure. For each call it inspects only primitive types, slices strings within the guest limit, represents objects/functions by fixed opaque labels, and passes only the already bounded string to the host callback. The callback enforces call/chunk/combined budgets again and posts bounded internal streams. The host then validates every stream. The emit function itself is not placed in any public guest global after wrapper setup. Guest-mutated prototypes, many arguments, huge primitives, and exception normalization still need a real binding proof; this is an architectural route, **not** a verified safe implementation. A thrown object is never recursively dumped; genuine QuickJS error handles need bounded guest-side field extraction with fallback if a property has hostile behavior.

## Phase 1 distribution and build boundary

The proposed **source** contains public facade/controller/policy/protocol/adapter code and design/test material. The proposed **distribution** contains only browser ESM public entry, type declarations, dedicated module Worker bundle, pinned WASM asset, package metadata, project license and audited third-party notices/provenance needed by consumers. Test fixtures, repository docs beyond useful public README/API notes, `.agents/` personal skills, `skills-lock.json`, local paths, credentials, and experiment scripts are not runtime dependencies and must not be required by the packed package.

The public entry resolves the Worker relative to the installed module or its build manifest. The Worker resolves WASM relative to its own trusted bundle/variant asset graph; host applications do not supply QuickJS URLs. Serving under a nested base path must work without absolute-root URLs. The library should load under a local static development server and from a fresh production tarball with the same contract. The initial deployment expects the Worker entry to be served from the application origin; direct cross-origin Worker construction is outside this design. A host may acquire/package artifacts through a CDN as a separate deployment choice, but the engine has no required external CDN. [Worker URL/origin rules](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker) Generated hashes/version manifest tie Worker and WASM to one build. MIME, CSP, browser ESM import, redirect, and service-worker interference remain **UNVERIFIED**.

Keep assets in an explicit package file allowlist at distribution time. Resolve Worker/WASM paths using an external-consumer test, not assumptions about any one bundler's source tree. No build or publishing is performed in Phase 1; [distribution test architecture](testing.md#source-and-distribution-parity) and [license gates](licensing.md#required-audit-before-distribution) govern Phase 2.
