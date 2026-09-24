# JavaScript Browser Engine

A standalone browser library for running untrusted JavaScript through a small programmatic API. Future IDEs, education platforms, playgrounds, and other applications consume the engine; the engine has no dependency on their UI or application state.

**Status: Stage 0 foundation only.** There is no executable engine, published package, build, or browser support claim. The contracts below are drafts for Phase 1. No runtime dependencies are installed or vendored.

The selected architecture is a dedicated Worker containing a trusted adapter and an embedded QuickJS interpreter compiled to WebAssembly. Guest programs run inside QuickJS, never in the browser's JavaScript global environment. The Worker provides interruption and separates computation from the UI thread; the embedded runtime supplies the guest capability boundary. See the [runtime research](docs/runtime.md) and [security model](docs/security.md).

```text
Consumer application
    -> JavaScriptEngine public API
        -> lifecycle controller and validated Worker transport
            -> trusted Worker adapter
                -> WebAssembly / QuickJS guest boundary
                    -> untrusted JavaScript
```

The initial execution profile is a single synchronous ECMAScript Script, with bounded console output and a fresh guest runtime for every run. No DOM, browser APIs, imports, timers, persistent variables, or Promise job scheduling are provided. This is an explicit first execution profile, not a claim of complete browser or Node.js compatibility. See [execution semantics](docs/api.md#execution-semantics).

## Intended consumer API

This is a contract example, **not runnable Stage 0 code**. The package name is a working identity, not a claim that the npm name is available.

```js
import { JavaScriptEngine } from "javascript-browser-engine";

const engine = new JavaScriptEngine();
try {
  await engine.initialize();
  const result = await engine.run({
    source: 'console.log("Hello World");',
    filename: "example.js",
  });
  // Inspect result.status before using result.error.
  console.log(result.stdout);
} finally {
  engine.dispose();
}
```

Execution is intended to remain entirely in the browser. Static delivery of the library, Worker, and WASM assets is required; a custom execution server is not. Loading trusted runtime assets does not grant network access to guest programs. This distinction is a design requirement awaiting browser verification.

## Documentation

| Document | Purpose |
| --- | --- |
| [Stage 0 report](docs/stage-0-report.md) | Completion report, requirement traceability, risks, and Phase 1 recommendation |
| [Architecture](docs/architecture.md) | Scope, ownership, lifecycle, recovery, cancellation, and timeouts |
| [Runtime](docs/runtime.md) | Candidate comparison, exact baseline, language semantics, and distribution |
| [Security](docs/security.md) | Threat model, network/storage behavior, capability inventory, and verification requirements |
| [API](docs/api.md) | Public contract, requests, results, and error taxonomy |
| [Protocol](docs/protocol.md) | Message grammar, validation, identity, and stale-response protection |
| [Limits](docs/limits.md) | Central policy categories, units, enforcement, and calibration |
| [Testing](docs/testing.md) | Test layers, browser matrix, source/distribution parity, and external consumers |
| [Licensing](docs/licensing.md) | Existing project license, dependency audit evidence, and release obligations |
| [Decisions](docs/decisions.md) | Choices, alternatives, trade-offs, and consequences |

## Repository foundation

```text
README.md
LICENSE                    existing AGPL v3 license text, preserved
package.json               private identity; no entry point or fake test command
.gitignore
docs/                      design contracts and research
src/README.md              intended ownership; implementation starts in Phase 1
tests/README.md            intended test layout; no runtime tests exist yet
```

Inspection on 2026-09-24 found only `.git` and `LICENSE`, one initial commit, and a clean worktree. No `AGENTS.md`, existing application, package manifest, build, or tests were present. Local tooling observed: Node.js 24.19.0 and npm 11.17.0 on Windows. These are research/authoring tools, not runtime requirements for consumers.

The repository's [LICENSE](LICENSE) contains the GNU AGPL version 3 text. It is unchanged. [Licensing](docs/licensing.md) records the unresolved `-only` versus `-or-later` designation and separates this project from the MIT-licensed proposed runtime dependencies.

Stage 0 ends with these documents. Phase 1 requires a separate instruction; it must first prove loading, capability isolation, termination, and recovery in real browsers.
