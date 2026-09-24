# Licensing audit and distribution requirements

Status: Stage 0 inventory/audit plan, researched 2026-09-24. No third-party runtime, dependency installation, or build assets are distributed in this repository at this stage. Links identify source evidence; a dependency's package-level label is not a complete audit of a compiled binary.

## Project code and documents

The repository already contained the full **GNU Affero General Public License version 3** in [LICENSE](../LICENSE), committed before Stage 0. Preserve it; do not replace it with the runtime's MIT license or infer a permissive project license.

There was no package manifest or project-specific copyright/license grant clarifying **AGPL-3.0-only** versus **AGPL-3.0-or-later**. The generic example notice inside the license is not itself that clarification. The new private manifest therefore uses `SEE LICENSE IN LICENSE` until the owner clarifies the intended designation before publication. No relicensing decision is made here.

Release planning must account for preserving notices, providing the license and applicable corresponding source/build material when conveying covered artifacts, and the license's modified-network-interaction provisions where applicable. Distribution of browser JavaScript/WASM is distinct from merely invoking a remote service. Do not assume that private package metadata, a browser-only design, or permissive runtime dependencies remove the project's existing license obligations. The existing license text is the controlling project evidence; this document is an engineering audit record, not a determination of every consumer's legal obligations. [Existing terms](../LICENSE), [FSF license source](https://www.gnu.org/licenses/agpl-3.0.html)

## Proposed runtime components

All 0.32.0 selected package metadata reports source revision `df4efb9ef2cb25c417ecb57986da462d11b244ed`. Versions here are exact planned pins, not installed dependencies.

| Component / role | Version | License evidence | Attribution / notice / distribution action |
| --- | --- | --- | --- |
| `quickjs-emscripten-core`, JS binding | 0.32.0 | MIT; [pinned license](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/quickjs-emscripten-core/LICENSE) | Retain upstream copyright and full permission/warranty notice in shipped notices/source; include even if bundled/minified |
| `@jitl/quickjs-wasmfile-release-sync`, glue/WASM distribution | 0.32.0 | MIT package; [combined license](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/variant-quickjs-wasmfile-release-sync/LICENSE) | Preserve binding and QuickJS notices; audit generated/linked contents separately; distribute notice alongside binary |
| `@jitl/quickjs-ffi-types`, transitive FFI declarations/support | 0.32.0 | MIT; [pinned license](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/packages/quickjs-ffi-types/LICENSE) | Preserve notice when declarations/runtime support are shipped; verify bundle/type output before deciding omission |
| Bellard QuickJS embedded C runtime | 2025-09-13, vendored at the revision above | MIT; [runtime license](https://github.com/justjake/quickjs-emscripten/blob/df4efb9ef2cb25c417ecb57986da462d11b244ed/vendor/quickjs/LICENSE) | Include Bellard/Gordon notices and inspect per-file headers, including generated tables; top-level license lists older copyright years than current source headers |
| Emscripten generated glue/runtime portions | Build identifies SDK 5.0.1 | MIT OR NCSA for Emscripten itself; [exact license](https://github.com/emscripten-core/emscripten/blob/5.0.1/LICENSE) | Preserve applicable generated-code notices (MIT route is available); distinguish compiler tool from code actually emitted into distributed artifacts |
| Linked libc/math/compiler support and generated data | Exact inputs of SDK 5.0.1 / selected build; full linked-file inventory not yet established | **Incomplete at binary level**; musl aggregate MIT plus separately noted file licenses; [SDK musl copyright](https://github.com/emscripten-core/emscripten/blob/5.0.1/system/lib/libc/musl/COPYRIGHT) | Inspect linked/generated inputs, exact source revisions and per-file notices; preserve all applicable terms. Do not label every WASM byte MIT based solely on npm metadata |

The core and variant metadata both depend on `@jitl/quickjs-ffi-types` 0.32.0; that package reports no dependencies. The umbrella `quickjs-emscripten` package is not selected because it would include unneeded variants. Debug variants, parsers, bundlers, test runners, and their dependencies need separate entries if adopted. Browser runtimes are supplied by users' browsers and are not redistributed by this package.

## Artifact/provenance checks performed

Registry metadata was read directly for [core](https://registry.npmjs.org/quickjs-emscripten-core/0.32.0), [release variant](https://registry.npmjs.org/@jitl/quickjs-wasmfile-release-sync/0.32.0), and [FFI types](https://registry.npmjs.org/@jitl/quickjs-ffi-types/0.32.0).

| Artifact | Registry SHA-512 integrity |
| --- | --- |
| Core 0.32.0 | `sha512-QFnPfjFey8EqknSrSxe1hZrf1/8z7/6s1QzGOmKo6++02r7QRRX7ZoyNaZh7JuVjWsVW87KnQrbZqnHkOAzUyg==` |
| Release variant 0.32.0 | `sha512-BKNDI/TPBfGlLNGYpLrhcDGXmIk4xHm4MRAisOBnOzpXVn9HZWsfmMAc9WMBrAHjvvds6HOikKeaOBKdPdpVrg==` |
| FFI types 0.32.0 | `sha512-v9T+GQpmk43VDJ7d72sf0Nexhk+ArvtUihW27dy7lqAl0zBObFKtSBBIm5RBjwIhE8VwsPPm9PNuvPvNqLWUEg==` |

The release variant tarball was independently hashed and matched its registry integrity. Its browser glue, file inventory, and combined license were inspected outside the project directory. Core/FFI integrity strings above were recorded from metadata, not independently matched to downloaded tarballs. The binding's declared git revision and vendored version/build source were inspected; a reproducible binary-to-source rebuild was **not** performed. These distinctions matter for the eventual supply-chain audit.

No copied third-party license files are added as if a complete `THIRD_PARTY_NOTICES` had been finalized. Before any binary is bundled, produce actual notices from the audited distributed inputs rather than this provisional table.

## Required audit before distribution

1. Clarify the project license designation/copyright attribution without altering existing terms by assumption.
2. Pin all runtime/build/test dependencies and record lockfile integrity, origin, source revision, license, role, and whether their code appears in output. Review advisories and intervening upstream fixes.
3. Inspect package tarballs, license files, source headers, generated-code notices, and the actual JS/WASM/declaration/map asset graph. Verify version provenance rather than treating package and embedded-runtime versions as identical.
4. Establish the SDK's linked libc/math/compiler-support and data-table inventory. Reproduce/inspect the build or obtain sufficient upstream provenance; unresolved distributed-component terms block publication.
5. Generate a component manifest/SBOM and full `THIRD_PARTY_NOTICES` with exact notices, modifications, and required license texts. Keep third-party notices distinct from the project's license.
6. Include required project source/build materials and license/notice files in the actual packed distribution and release artifacts; do not assume comments survive minification.
7. Validate the tarball from a clean consumer and repeat this audit for every dependency/build change. Record tools that are development-only separately from code/assets shipped to consumers.

This completes Stage 0's licensing identification and audit plan. It does **not** certify a not-yet-created distribution as compliant or approve changing the existing project license.
