# JavaScript Browser Engine

A standalone browser library for executing one synchronous ECMAScript Script per call. It exposes a small API for applications; it has no editor, terminal, routing, persistence, package system, or backend execution service.

**Status: Phase 3 hardening completed; private pre-release package.** The bundled engine passed 22 browser tests each in Playwright Chromium 140, Firefox 141, and WebKit 26 on Windows. These are tested configurations, not a supported browser range. Actual Safari, Edge, mobile browsers, strict CSP, memory ceilings, production limit calibration, and the compiled-WASM license audit remain open.

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

The initial `script-sync-v1` profile ignores completion values and does not drain Promise jobs. `console.log/info/debug` produce stdout; `warn/error` produce stderr. Syntax and runtime exceptions yield `program-error`; admitted engine faults yield `engine-error`; invalid or out-of-state requests reject with `EngineError`. Each admitted run resolves `{status, stdout, stderr, durationMs, error, truncated}`. `run()` accepts `{source, filename?, timeoutMs?}`. `cancel()` hard-terminates the current Worker, and `reset()` replaces it. The current policy caps source at 32,768 UTF-16 units, output at 32,768 units, default execution at 2 seconds, and requested execution at 5 seconds. These values are provisional.

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

The package remains `private` while licensing, broader browser testing, and resource calibration are completed. The packed-consumer smoke test passes in Chromium. The existing [LICENSE](LICENSE) is preserved. The package includes a third-party notice for the identified QuickJS binding/runtime terms; exact linked WASM inputs and the project's license designation still require review before publication.

## Local design notes

The project keeps phase reports, architecture notes, and decision records locally under `docs/`. Repository `.gitignore` excludes Markdown other than this README, as requested by the repository owner. Those local notes are therefore not included on GitHub or in the npm package. The public behavior above and `dist/index.d.ts` are the consumer-facing summary in the current distribution.
