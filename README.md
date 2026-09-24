# JavaScript Browser Engine

A standalone browser library for executing one synchronous ECMAScript Script per call. Applications use a small public API; the package has no editor, terminal, persistence, or backend execution service.

**Release status: private 0.1.0 candidate; not cleared for publication.** The release audit found unresolved compiled-WASM notice/provenance obligations and an unresolved designation for the project's existing AGPL v3 license. The package remains `private: true`; no browser support range is promised.

## Use from a browser application

Install the package locally with `npm install <path-to-package-tarball>` after building a candidate. The import below assumes a bundler or web server that serves the package's emitted browser assets at one HTTP(S) origin:

```js
import {JavaScriptEngine} from 'javascript-browser-engine';

const engine = new JavaScriptEngine();
try {
  await engine.initialize();
  const result = await engine.run({
    source: 'console.log("Hello World")',
    filename: 'example.js',
    timeoutMs: 2000,
  });
  console.log(result.status, result.stdout);
} finally {
  engine.dispose();
}
```

`run({source, filename?, timeoutMs?})` accepts a string Script, an optional diagnostic filename, and an optional execution deadline in milliseconds. `initialize()` prepares the Worker/WASM runtime. `cancel()` terminates an active run and waits for a replacement; `reset()` replaces the Worker even when idle. `dispose()` is terminal. `isReady()`, `isBusy()`, `getState()`, and `getRuntimeInfo()` report current state and the versioned policy. Run only when ready; invalid, oversized, out-of-state, or post-disposal requests reject with `EngineError` and a stable `code`.

Every admitted run resolves `{status, stdout, stderr, durationMs, error, truncated}`. `status` is `ok`, `program-error`, or `engine-error`. A syntax or runtime exception has `error.kind: 'program'` plus `name`, `message`, `stack`, and `filename`; execution infrastructure failure has `error.kind: 'engine'` plus `code` and `message`. `cancel()` settles an active run with `CANCELLED`; execution timeout settles it with `EXECUTION_TIMEOUT`. After either, the engine replaces the Worker and returns to `ready` or enters `failed` if recovery fails. A failed engine can retry `initialize()`.

Each run gets a fresh QuickJS context. Variables, objects, and prototype mutations do not survive a normal run. The `script-sync-v1` profile ignores completion values and does not drain Promise jobs; it does not provide modules, `fetch`, DOM, Node APIs, persistence, or browser storage to guest code. `console.log/info/debug` write bounded stdout and `warn/error` bounded stderr. There is no analysis API or returned expression value. The trusted Worker itself has browser authority; the guest QuickJS context receives only the bounded console bridge in the tested configuration.

## Distribution and deployment

The build emits `dist/index.js`, `dist/index.d.ts`, `dist/worker.js`, `dist/emscripten-module.wasm`, `dist/package.json`, and `dist/THIRD_PARTY_NOTICES.txt`. The package export points to `dist/index.js`; it resolves Worker and WASM URLs relative to itself. A consumer must serve **all three executable assets together on the application origin** with correct JavaScript and `application/wasm` MIME types. Moving, renaming, inlining, or hosting the Worker on a different origin is outside the tested contract. A cross-origin import with permissive CORS still failed Worker startup in five tested browser configurations. No backend is needed to execute guest code, but trusted runtime assets must be fetched by the browser.

The following policy was tested on both the page and served Worker/assets in local HTTP fixtures:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'
```

`worker-src 'none'`, `connect-src 'none'`, or omission of WASM compilation permission made initialization fail in the tested configurations. A deployed application can use additional directives, but should test its exact page and Worker response headers. The trusted WASM request carried a same-origin cookie when one was set in the tested browsers; guest JavaScript did not receive a network API. Serve trusted assets from an origin whose cookies and Service Worker behavior are acceptable. CDN rewrites, redirects, offline caches, cross-origin assets, and hostile same-origin code are not verified deployments.

The current provisional limits include 32,768 UTF-16 units of source, 256 for a filename, 32,768 combined output units, 2 seconds default execution, 5 seconds maximum requested execution, and a 16 MiB QuickJS guest heap allocation budget. `getRuntimeInfo().limits` exposes the complete policy. The guest heap budget is **not** a Worker, tab, WASM, or browser-process memory ceiling. Host Worker termination and timeouts depend on conforming browser behavior; background tab throttling and browser-wide resource pressure are not fully characterized.

## Build and verify

```sh
npm ci
npm run build
npm test
npx playwright install chromium firefox webkit
npm run test:browser
npx playwright test --browser=firefox
npx playwright test --browser=webkit
npm run test:consumer
npm run test:release
```

On a machine with installed Chrome and Edge, `npx playwright test --config=playwright.product.config.js` runs the full product-browser suite; `npm run test:release -- --require-products` requires both product browsers. The release script builds twice in a clean source copy, compares six generated-file hashes, audits the exact nine-file tarball, installs it into a separate consumer, and runs the same public contract from source and installed package at root and nested paths. Repeatability on one pinned toolchain does not establish reproducibility across machines or prove the WASM binary's source provenance.

On Windows, 38 browser tests passed each in Playwright Chromium 140.0.7339.186, Firefox 141.0, WebKit 26.0, installed Chrome 153.0.8010.53, and Edge 153.0.4234.48. These are **TESTED** configurations, not a supported range; Playwright WebKit is not the Safari product. Safari, mobile browsers, WebViews, older versions, and alternative deployment policies remain **UNVERIFIED**.

The package's project [LICENSE](LICENSE) contains GNU AGPL version 3 text. The build ships notices for identified QuickJS/binding components, but the exact linked Emscripten/libc/compiler inputs of the WASM artifact have not been established. Publication also needs the owner's exact project `-only`/`-or-later` designation and copyright attribution. Do not treat the current notice as a completed distribution-license audit.

Local phase reports, architectural notes, and decision logs live under `docs/` but are ignored by Git under the repository owner's Markdown publication preference. This README and `dist/index.d.ts` are the current consumer-facing contract. Version `0.1.0` is a private candidate, not a released compatibility promise; public API or policy changes require a future versioning decision.
