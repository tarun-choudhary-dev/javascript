import {build} from 'esbuild';
import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('@jitl/quickjs-wasmfile-release-sync/package.json');
const wasm = resolve(dirname(packagePath), 'dist/emscripten-module.wasm');
await mkdir('dist', {recursive: true});
for (const [entry, outfile] of [['src/index.js', 'dist/index.js'], ['src/runtime/worker.js', 'dist/worker.js']]) {
  await build({entryPoints: [entry], outfile, bundle: true, platform: 'browser', format: 'esm',
    target: ['es2022'], minify: false, legalComments: 'eof', conditions: ['browser']});
}
await copyFile(wasm, 'dist/emscripten-module.wasm');
await copyFile('src/index.d.ts', 'dist/index.d.ts');
await copyFile(resolve(dirname(packagePath), 'LICENSE'), 'dist/THIRD_PARTY_NOTICES.txt');
await writeFile('dist/package.json', JSON.stringify({type: 'module'}, null, 2));
