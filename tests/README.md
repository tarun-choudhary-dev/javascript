# Test ownership planned for Phase 1

Stage 0 contains a test strategy, not passing runtime tests. The security claims are unverified until the [testing plan](../docs/testing.md) is executed.

Create suites when their subject exists:

| Planned location | Focus |
| --- | --- |
| `unit/` | Validators, transition logic, counters, deadlines, and limits |
| `runtime/` | Real QuickJS semantics, resource behavior, cleanup, and capability inventory |
| `api/` | Contract behavior, operation races, errors, reset, and disposal |
| `security/` | Guest escape attempts, observed network/storage effects, hostile messages/output |
| `distribution/` | Fresh build, WASM/Worker loading, CSP, package contents, and license notices |
| `consumer/` | A clean temporary application using only the packed public package |

Test fixtures are internal harnesses, not a product playground. Browser automation and static test servers are development infrastructure; they do not execute guest code on a backend. Do not add a dummy `npm test` that reports success without testing an engine.
