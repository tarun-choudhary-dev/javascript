# JavaScript Browser Engine

A standalone browser library for executing one synchronous ECMAScript Script per call. It exposes a small API for applications; it has no editor, terminal, routing, persistence, package system, or backend execution service.

**Status: Phase 2 engine skeleton.** The pinned QuickJS/WASM Worker and public lifecycle run in Chromium 140 (Playwright build 1193). This is a private, unpublished package. Wider browser compatibility and a complete security audit remain open.

```js
import {JavaScriptEngine} from 'javascript-browser-engine';

const engine = new JavaScriptEngine();
try {
  await engine.initialize();
  const result = await engine.run({source: 'console.log("Hello World")'});
  console.log(result.status, result.stdout);
} finally {
  engine.dispose();
}
```

The host creates a dedicated module Worker. The trusted Worker adapter loads QuickJS 2025-09-13 through `quickjs-emscripten-core` and the `@jitl/quickjs-wasmfile-release-sync` 0.32.0 variant. It creates and destroys a guest runtime/context for each run. A run does not preserve guest globals; `reset()` also replaces the Worker and WASM instance. `cancel()` and timeout invalidate and terminate the old Worker, then boot one replacement. Guest code is interpreted by QuickJS and receives no browser API bridge. The trusted adapter loads a same-origin WASM file using browser network APIs, separately from guest execution.

The initial `script-sync-v1` profile ignores completion values and does not drain Promise jobs. `console.log/info/debug` produce stdout; `warn/error` produce stderr. Syntax and runtime exceptions yield `program-error`; admitted engine faults yield `engine-error`; invalid or out-of-state requests reject with `EngineError`. See [API](docs/api.md), [limits](docs/limits.md), and [security](docs/security.md).

## Build and verify

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run test:consumer
```

Build emits `dist/index.js`, `dist/index.d.ts`, `dist/worker.js`, `dist/emscripten-module.wasm`, and a third-party notice. Serve the assets from an HTTP(S) origin, keeping the three runtime files together. A consumer imports only `dist/index.js` through the package export; Worker and WASM paths resolve relative to it. Browser CSP must permit the Worker script and WASM compilation/loading. `dist/` is generated and Git-ignored; run `npm run build` after source changes. Node and esbuild are build/test tools, not guest APIs.

The package remains `private` while licensing, broader browser testing, and resource calibration are completed. The packed-consumer smoke test passes in Chromium. The existing [LICENSE](LICENSE) is preserved. See [licensing](docs/licensing.md) for distribution gaps.

## Documentation

The [Phase 2 report](docs/stage-2-report.md) distinguishes implemented, verified, unverified, and deferred behavior. The [Phase 1 report](docs/stage-1-report.md) is the architecture baseline. Living contracts are in [architecture](docs/architecture.md), [runtime](docs/runtime.md), [protocol](docs/protocol.md), [testing](docs/testing.md), [limits](docs/limits.md), [security](docs/security.md), and [decisions](docs/decisions.md).
