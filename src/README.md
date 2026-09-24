# Source ownership planned for Phase 1

No runtime code is implemented in Stage 0. Add directories as their first real module is needed; empty directory scaffolds and placeholder classes are intentionally omitted.

| Planned location | Owns | Must not own |
| --- | --- | --- |
| `api/` | Public class, public types, normalized public errors/results | Browser globals or runtime handles exposed to consumers |
| `lifecycle/` | State transitions, active operation, generation, deadlines, recovery | Guest execution |
| `execution/` | Worker creation/termination, transport, internal protocol | UI or project state |
| `runtime/` | Worker entry point, QuickJS adapter, console bridge, handle cleanup | Application capabilities or network imports for guests |
| `security/` | Request/message validation, bounded normalization | A blacklist pretending to sandbox native JavaScript |
| `limits/` | One policy definition and derived validation constraints | Independently duplicated magic numbers |

Keep modules concrete. A single runtime implementation does not need a plugin system, abstract runtime factory framework, dependency injection container, or runtime registry. Use browser ESM; source typing/build tool selection is a Phase 1 tooling decision. The library must work for plain JavaScript consumers and eventually ship type declarations.

See [architecture](../docs/architecture.md), [API](../docs/api.md), and [protocol](../docs/protocol.md) before implementation.
