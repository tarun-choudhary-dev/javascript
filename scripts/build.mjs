import {build} from 'esbuild';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {writeSourceArchive} from './source-archive.mjs';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('@jitl/quickjs-wasmfile-release-sync/package.json');
const wasm = resolve(dirname(packagePath), 'dist/emscripten-module.wasm');
const variant = JSON.parse(await readFile(packagePath, 'utf8'));
const wasmBytes = await readFile(wasm);
const wasmSha256 = createHash('sha256').update(wasmBytes).digest('hex');
const expectedWasmSha256 = '105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232';
if (variant.version !== '0.32.0' || wasmSha256 !== expectedWasmSha256)
  throw new Error('QuickJS variant changed; review WASM provenance and notices before rebuilding');
await mkdir('dist', {recursive: true});
for (const [entry, outfile] of [['src/index.js', 'dist/index.js'], ['src/runtime/worker.js', 'dist/worker.js']]) {
  await build({entryPoints: [entry], outfile, bundle: true, platform: 'browser', format: 'esm',
    target: ['es2022'], minify: false, legalComments: 'eof', conditions: ['browser']});
}
await copyFile(wasm, 'dist/emscripten-module.wasm');
await copyFile('src/index.d.ts', 'dist/index.d.ts');
const upstreamNotice = await readFile(resolve(dirname(packagePath), 'LICENSE'), 'utf8');
const runtimeNotice = (await readFile('third_party/runtime-notices.txt', 'utf8')).replaceAll('\r\n', '\n');
const runtimeNoticeSha256 = createHash('sha256').update(runtimeNotice).digest('hex');
if (runtimeNoticeSha256 !== '033706c91a1a76d2eca1ae74daca5b5a9a1a98410e7dd587099a1d4358c655c9')
  throw new Error('Pinned SDK notice changed; review selected WASM inputs and licenses');
const notice = `Third-party notices — private 0.1.0 release candidate\n\n` +
  `Verified package identities: quickjs-emscripten-core 0.32.0, ` +
  `@jitl/quickjs-wasmfile-release-sync 0.32.0, and @jitl/quickjs-ffi-types 0.32.0. ` +
  `These packages share the quickjs-emscripten MIT notice below.\n` +
  `Embedded QuickJS source: 2025-09-13, upstream commit ` +
  `f1139494d18a2053630c5ed3384a42bb70db3c53, vendored at ` +
  `quickjs-emscripten commit df4efb9ef2cb25c417ecb57986da462d11b244ed. ` +
  `The vendored quickjs.c adds an __EMSCRIPTEN__ conditional workaround around ` +
  `short-integer bytecode emission. Its source header names Fabrice Bellard and ` +
  `Charlie Gordon for 2017-2025; dtoa.c names Fabrice Bellard for 2024. ` +
  `The upstream combined license text below retains its original copyright years.\n` +
  `QuickJS source: https://github.com/bellard/quickjs/tree/f1139494d18a2053630c5ed3384a42bb70db3c53\n` +
  `Vendored build source: https://github.com/justjake/quickjs-emscripten/tree/df4efb9ef2cb25c417ecb57986da462d11b244ed\n` +
  `WASM SHA-256: ${wasmSha256}.\n\n` +
  `The pinned SDK build/link audit identified 321 selected archive members; ` +
  `the final map named 30 with retained sections. Attribution for the selected ` +
  `SDK families follows after the upstream binding/QuickJS license. Selection ` +
  `does not prove each member survived link-time optimization.\n\n` +
  `--- Upstream combined binding/QuickJS license text (verbatim) ---\n\n${upstreamNotice}` +
  `\n--- Pinned SDK runtime notices ---\n\n${runtimeNotice}`;
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notice);
await writeFile('dist/package.json', JSON.stringify({type: 'module'}, null, 2));
const snapshot = await writeSourceArchive('dist/SOURCE_SNAPSHOT.tar');
await writeFile('dist/PROVENANCE.json', JSON.stringify({
  schemaVersion: 1,
  project: {name: 'javascript-browser-engine', version: '0.1.0',
    license: 'AGPL-3.0-only', copyright: 'Copyright (C) 2026 tarun choudhary',
    sourceArchive: 'dist/SOURCE_SNAPSHOT.tar', sourceSha256: snapshot.sha256,
    sourceFiles: snapshot.files},
  runtime: {variant: '@jitl/quickjs-wasmfile-release-sync', version: '0.32.0',
    sourceCommit: 'df4efb9ef2cb25c417ecb57986da462d11b244ed',
    quickjsVersion: '2025-09-13', quickjsCommit: 'f1139494d18a2053630c5ed3384a42bb70db3c53',
    emscriptenVersion: '5.0.1', emscriptenCommit: '8c5f43157a3f069ade75876e23061330521eabde',
    emsdkImageDigest: 'sha256:40a30b0e22be2b1fce570a5fcbf8124c4ccb22962b49850546863da07d374a51',
    wasm: 'dist/emscripten-module.wasm', wasmSha256},
  notices: {file: 'dist/THIRD_PARTY_NOTICES.txt', sdkSourceSha256: runtimeNoticeSha256}
}, null, 2) + '\n');
