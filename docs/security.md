# Security boundary and threat model

Status: Stage 0 threat model refined by the Phase 1 architecture audit. **No browser security tests have been executed.** Statements marked as policy are requirements, not demonstrated guarantees. Source inspection supports the architecture; only the tests in [testing](testing.md) can establish observed behavior of this engine's eventual distribution.

## Trust and assets

Treat source, filenames, guest values, output, exceptions, serialized messages/results, and future diagnostics/imported artifacts as untrusted. Assume intentional infinite loops, allocation attacks, prototype manipulation, output flooding, protocol spoofing, and attempts to recover host references.

Protect the host page's DOM, application JavaScript/globals, parent state, cookies/storage, network authority, user data, engine state, subsequent runs, and UI availability. Only source and its bounded diagnostic label enter a guest; no application secrets, objects, callbacks, authentication tokens, or references should be passed there.

Trusted computing base: browser and OS, library controller/validators, Worker adapter, QuickJS and its C-to-WASM build, binding/console bridge, and the installed asset delivery chain. The consumer application is trusted to call the API; this library cannot defend a page against other already-compromised same-origin scripts, malicious extensions, devtools, or a compromised browser.

WASM constrains access to its own linear memory and explicitly imported functions. It does not repair every C runtime bug, protect a badly designed host callback, provide a separate OS process, or cap browser-wide resources. [WebAssembly security model](https://webassembly.org/docs/security/)

## What forms the boundary

Untrusted source is interpreted only in QuickJS. The Worker runs engine-controlled JavaScript and contains ordinary browser capabilities; they must never be passed through the QuickJS bridge. Guest `globalThis` is the interpreter's global object, and constructor/eval chains stay in that interpreter. Initially, the only guest-to-host bridge is bounded console output returning guest `undefined`.

Do not expose generic RPC, arbitrary property lookup on host objects, a filesystem, runtime handles, host exception objects, module resolution, guest-controlled asset paths, native callbacks, or an object serializer that invokes guest code on the UI thread. Protocol parsing/formatting is data handling, never dynamic evaluation.

Network/storage absence follows from the embedded environment plus the bridge allowlist; it does **not** follow from the Worker origin, CORS, or deleting global names. A same-origin Worker itself may access host-origin resources. Compromise of the adapter or a capability-escaping binding bug would undermine this boundary. No claim of defense against arbitrary trusted-adapter compromise is made.

## Threats, controls, and evidence gates

| Threat | Required control | Verification / residual limit |
| --- | --- | --- |
| Host DOM/global escape | Embedded guest; no host reference bridge | Constructor/eval/prototype escape probes and host canaries; upstream/browser flaws remain possible |
| Network exfiltration | No network/module/native browser APIs in guest | Observe real requests, sockets, and receiver logs after initialization; a missing `fetch` name alone is insufficient |
| Storage/cookie access | No storage/cookie/host-object bridge | Seed host canaries and compare after malicious runs; runtime-acquisition requests are a separate channel |
| Infinite computation | Owner terminates Worker; interrupt hook checks deadlines | Infinite loop/recursion/regex and repeated recovery tests; timer throttling prevents strict wall-clock guarantees |
| Heap/stack exhaustion | Guest heap/stack limits plus bounded input/output and Worker disposal | Allocation stress, trap/recovery tests; no total-tab/process memory cap |
| Output/serialization denial of service | Bounded primitive formatting, opaque object labels, chunk/count/work budgets | Huge strings, cyclic objects, getters/proxies, console floods, hostile thrown values |
| Forged/stale messages | Private Worker event source, strict schema and operation/generation identity | Reordering, replay, malformed JSON, wrong Worker, duplicate completion, wrong IDs |
| Cross-run contamination | Fresh guest runtime/context every run; destructive reset | Mutate globals/prototypes, then verify clean next run |
| Supply-chain compromise | Exact package pins, integrity/asset provenance, maintained notices | Review artifacts/advisories and retest upgrades; initial audit is not a vulnerability certification |
| XSS through output or filename | Return inert strings; never insert into HTML in engine | Host consumer fixture renders via `textContent`; application rendering remains consumer responsibility |
| Host data disclosure via errors | Engine-authored infrastructure messages; bounded guest-only errors | Ensure no host stacks, credentials, private paths or raw transport objects cross public API |

## Network: acquisition versus execution

**HOST-SIDE RUNTIME ACQUISITION** means trusted engine/bootstrap code, even when running in the Worker. It may load the engine ESM graph, Worker bundle, and one pinned WASM asset from the consumer's static deployment. The published 0.32.0 browser glue uses same-origin credentials for WASM fetch, supports streaming-to-buffer fallback, and has a synchronous-XHR fallback path. Cookies may therefore accompany same-origin asset requests. Failed loading may retry; these are not guest-originated requests. [Audited package metadata and artifact location](https://registry.npmjs.org/@jitl/quickjs-wasmfile-release-sync/0.32.0)

The Phase 1 architecture fixes runtime URLs to engine-owned package-relative assets and includes loading within the initialization/recovery deadline. Phase 2 must verify and record the complete request/redirect graph. Never send source, filenames, output, or other guest-derived text in runtime URLs or telemetry. The engine has no telemetry feature. CDN delivery is not the default. If the consumer's origin or Service Worker substitutes assets, it is part of the trusted delivery environment.

**USER PROGRAM EXECUTION** receives no fetch, XHR, WebSocket, WebRTC, image/DOM loader, import loader, or Worker creation bridge. The intended answer to “can guest JavaScript access the network?” is **no provided capability**. The actual engine behavior is **UNVERIFIED** until browser tests demonstrate no observable guest-triggered network effects. QuickJS dynamic imports must fail locally with no loader; nested eval/Function must not recover a browser loader.

The adapter's ambient network authority remains a residual risk. A restrictive worker-response CSP can reduce it; CSP on a document does not automatically impose every desired policy on a separately fetched Worker. `worker-src` controls worker loading; `connect-src` controls relevant connection APIs; WebAssembly compilation has its own script policy considerations. Do not call a CSP deployment secure because one fetch attempt failed. [CSP Worker loading](https://www.w3.org/TR/CSP3/#directive-worker-src), [connection policy](https://www.w3.org/TR/CSP3/#directive-connect-src), [WASM compilation checks](https://www.w3.org/TR/CSP3/#can-compile-wasm-bytes)

The Phase 2 CSP fixture must allow only the intended library/Worker assets and the tested WASM compilation policy (normally `wasm-unsafe-eval` where required/supported), without broad `unsafe-eval`. A Worker-response policy must account for WASM acquisition. Record the actual working policy and negative tests before publishing a deployment recipe. There is no iframe/blob bootstrap in this design and no requirement for SharedArrayBuffer, COOP, or COEP for the selected single-threaded profile; confirm the actual binary does not add one.

## Storage model

No guest persistence. No localStorage, sessionStorage, IndexedDB, Cache Storage, cookie, filesystem, or parent application storage capability is installed. No service-worker registration. The warmed interpreter does not preserve guest state across runs. Browser HTTP caching of trusted assets is allowed and does not become a guest storage API.

The trusted Worker may have IndexedDB/Cache Storage access by platform exposure, and runtime fetches may send cookies, so “Workers cannot access storage/cookies” would be false as a broad security claim. The intended restriction is at the guest bridge. Seed and test host storage/cookie canaries on a dedicated local test origin, including interactions with host Service Workers, without using real account data.

## Browser capability inventory

Each “actual/status” cell is **UNVERIFIED** because no guest program has run in a browser in this project. “Absent” is the **PROPOSED** QuickJS guest policy; it does not claim the surrounding trusted Worker lacks the feature. `VERIFIED`, `BLOCKED`, or `CONDITIONALLY AVAILABLE` require recorded browser evidence. `ALLOWED` below is only the intended capability policy.

| Capability / names | Expected guest policy | Actual behavior / status | Required verification method |
| --- | --- | --- | --- |
| DOM | Absent | UNVERIFIED | Host DOM canary and own-document access probes |
| `window` | Absent | UNVERIFIED | Direct, global-property, eval, constructor-chain lookup |
| `document` | Absent | UNVERIFIED | DOM and cookie lookup attempts |
| `parent`, `top`, `opener` | Absent | UNVERIFIED | Nested lookup/navigation/message attempts cannot reach host |
| `globalThis` | ALLOWED: guest-only object | UNVERIFIED | Built-in constructor chains return guest environment |
| `self`, `location`, `navigator` | Absent | UNVERIFIED | No Worker/browser global references or host URL/device info |
| `localStorage` | Absent | UNVERIFIED | Host canary read/write attempts and comparison |
| `sessionStorage` | Absent | UNVERIFIED | Same, including another same-origin tab fixture |
| `indexedDB` | Absent | UNVERIFIED | Host database canary remains unchanged |
| `caches` / Cache Storage | Absent | UNVERIFIED | No guest cache access or new entries |
| Cookies / `document.cookie` / Cookie Store | Absent | UNVERIFIED | No guest read/write; separately observe asset request cookie headers |
| `fetch`, XMLHttpRequest, EventSource, beacon | Absent | UNVERIFIED | HTTP receiver and browser request log, including failed CORS requests |
| `WebSocket`, WebTransport | Absent | UNVERIFIED | No handshake/connection observed |
| WebRTC / `RTCPeerConnection` | Absent | UNVERIFIED | No guest ICE/network channel or related object |
| Service Workers | Absent | UNVERIFIED | No registration, control, or message to host registration |
| `Worker`, `SharedWorker` | Absent | UNVERIFIED | No nested browser workers or external code loading |
| `BroadcastChannel` | Absent | UNVERIFIED | Same-origin peer receives no guest message |
| `postMessage`, `MessageChannel`, `MessagePort` | Absent | UNVERIFIED | Guest cannot invoke real transport or forge ready/results |
| `importScripts`, static/dynamic imports | No loader; module syntax unsupported | UNVERIFIED | HTTP receiver stays silent, including dynamic imports inside eval |
| Clipboard | Absent | UNVERIFIED | No clipboard object, operation, or permission request |
| Geolocation | Absent | UNVERIFIED | No location object, read, or prompt |
| Camera / microphone / media devices | Absent | UNVERIFIED | No device enumeration, capture, or permission request |
| USB / serial / HID | Absent | UNVERIFIED | No device object, connection, or chooser |
| Notifications / Push | Absent | UNVERIFIED | No prompt, registration, or delivered notification |
| `setTimeout`, `setInterval`, animation scheduling | Absent | UNVERIFIED | No asynchronous host callback is created |
| SharedArrayBuffer / Atomics | No host shared-memory bridge | UNVERIFIED | No shared host buffers; audit guest intrinsic presence separately |
| `WebAssembly` | No browser WASM API installed | UNVERIFIED | Guest cannot instantiate host modules or see adapter memory |
| `console` | ALLOWED: bounded bridge | UNVERIFIED | Methods reveal no native function/global handles |
| `eval`, `Function`, Promise, Date, Math | ALLOWED: guest language intrinsics | UNVERIFIED | Guest-only authority; Promise jobs not scheduled; time/randomness not deterministic |
| `process`, `require`, QuickJS `std` / `os` | Absent | UNVERIFIED | No Node or qjs CLI standard-library/module exposure |

Test property enumeration and behavior, not only `typeof` checks. Repeat via prototype/constructor chains, getters, thrown objects, and modified built-ins. Unsupported names that happen to exist in the pinned runtime must trigger review instead of being explained away after the fact. Every dependency/bridge change requires re-running this inventory.

## Evidence ledger

| Claim | Evidence so far | Required before release |
| --- | --- | --- |
| Embedded runtime exposes host functions by explicit installation | Upstream interface documentation/source | Guest capability and escape tests on exact bundle |
| Owner can abort Worker script | HTML specification | Infinite-loop cancellation and post-termination side-effect checks |
| WASM package and runtime version are identified | Registry metadata, matching artifact integrity, pinned source version/build/license inspection | Lockfile, shipped-asset hashes, provenance review |
| No guest network/storage/DOM access | Architecture/allowlist only | All corresponding browser probes and canaries |
| Limits protect availability | Proposed controls only | Boundary/stress tests, host responsiveness observation |
| Browser/CSP compatibility | No engine tested | [Browser matrix](testing.md#browser-matrix) with exact builds and policies |

The security goal is bounded, capability-restricted execution under this threat model. It is not perfect isolation, deterministic program output, secure erasure, strict real-time scheduling, or containment of arbitrary browser/process compromise.

## Resource-exhaustion audit

`while (true) {}` is expected to occupy the Worker/QuickJS interpreter. The QuickJS interrupt hook may return at its local deadline; the host controller's independent watchdog must revoke and call `Worker.terminate()` even if the Worker never responds. If the browser host event loop is running, the engine then makes one bounded recovery attempt. The HTML Worker termination algorithm is **DOCUMENTED** to abort running script; this exact integration and cancellation latency are **UNVERIFIED**. A suspended tab can delay the host timer.

`const x = []; while (true) { x.push(new Array(1000000)); }` attacks memory and CPU simultaneously. QuickJS `setMemoryLimit` and `setMaxStackSize` are **DOCUMENTED** runtime controls, but wrapper objects, WASM growth, queued messages, browser process memory, and host-side string copies sit outside that guest allocator budget. Allocation could exhaust the tab/process before a timeout callback runs. The plan is to set guest limits before evaluation, bound input/output/message/work, then terminate/recreate on trusted limit/trap evidence. Whether those controls prevent visible tab damage on target devices is **UNVERIFIED**. Do not promise a hard tab memory ceiling, instant recovery, or that timeouts alone solve memory exhaustion.

The browser process, scheduler, and host application count of engine instances remain outside an individual engine's resource quota. A host may need its own policy for concurrent engine instances. [Limit ownership and calibration](limits.md), [later stress acceptance](testing.md#required-scenarios)
