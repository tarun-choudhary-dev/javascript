import {mkdtemp, mkdir, cp, copyFile, readFile, realpath, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve, sep, extname} from 'node:path';
import {chromium, firefox, webkit} from '@playwright/test';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:release');
const requireProducts = process.argv.includes('--require-products');
const root = await mkdtemp(join(tmpdir(), 'js-engine-release-'));
const source = join(root, 'source');
const consumer = join(root, 'consumer');
const expectedFiles = ['LICENSE', 'README.md', 'dist/THIRD_PARTY_NOTICES.txt',
  'dist/emscripten-module.wasm', 'dist/index.d.ts', 'dist/index.js', 'dist/package.json',
  'dist/worker.js', 'package.json'].sort();
const distFiles = expectedFiles.filter(path => path.startsWith('dist/'));
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'";
let server;

function npm(args, cwd, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {cwd,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'});
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise(output) : reject(new Error(`npm ${args[0]} exited ${code}`)));
  });
}

async function hashes(directory) {
  const result = {};
  for (const file of distFiles) {
    const bytes = await readFile(join(directory, file));
    result[file] = createHash('sha256').update(bytes).digest('hex');
  }
  return result;
}

function stableResult(result) {
  return {status: result.status, stdout: result.stdout, stderr: result.stderr,
    truncated: result.truncated, error: result.error && {
      kind: result.error.kind, code: result.error.code ?? null,
      name: result.error.name ?? null, message: result.error.message,
      filename: result.error.filename ?? null}};
}

async function serve() {
  const packedDist = resolve(consumer, 'node_modules/javascript-browser-engine/dist');
  const sourceDist = resolve(source, 'dist');
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/' || path === '/app/nested/index.html') {
      response.writeHead(200, {'Content-Type': 'text/html', 'Content-Security-Policy': csp})
        .end('<!doctype html><meta charset="utf-8"><title>release candidate consumer</title>');
      return;
    }
    const fromSource = path.startsWith('/source/');
    const asset = fromSource ? path.slice('/source/'.length) :
      path.startsWith('/pkg/') ? path.slice('/pkg/'.length) : path.slice(1);
    const assetRoot = fromSource ? sourceDist : packedDist;
    const target = resolve(assetRoot, asset);
    if (!target.startsWith(assetRoot + sep)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(target);
      response.writeHead(200, {'Content-Type': extname(target) === '.wasm' ?
        'application/wasm' : 'text/javascript', 'Content-Security-Policy': csp}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  return `http://127.0.0.1:${server.address().port}`;
}

async function runContract(browser, base, {label, prefix, pagePath}) {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.goto(base + pagePath);
    const observed = await page.evaluate(async prefix => {
      const {JavaScriptEngine} = await import(prefix + 'index.js');
      const engine = new JavaScriptEngine();
      const rejected = async action => {
        try { await action(); return null; } catch (error) { return error.code; }
      };
      const before = await rejected(() => engine.run({source: '1'}));
      await engine.initialize();
      const info = engine.getRuntimeInfo();
      const hello = await engine.run({source: 'console.log("hello")'});
      const syntax = await engine.run({source: 'const = ;', filename: 'syntax.js'});
      const exception = await engine.run({source: 'throw new TypeError("boom")', filename: 'runtime.js'});
      await engine.run({source: 'globalThis.marker = 1'});
      const fresh = await engine.run({source: 'console.log(typeof marker)'});
      const unicode = await engine.run({source: 'console.log("😀漢")'});
      const inputLimit = await rejected(() => engine.run({source: 'x'.repeat(info.limits.sourceChars + 1)}));
      const outputLimit = await engine.run({source: "for (let i = 0; i < 33; i++) console.log('x'.repeat(1023))"});
      const pending = engine.run({source: 'while (true) {}', timeoutMs: 5000});
      await engine.cancel();
      const cancelled = await pending;
      const afterCancel = await engine.run({source: 'console.log("recovered")'});
      const timed = await engine.run({source: 'while (true) {}', timeoutMs: 150});
      await engine.initialize();
      const afterTimeout = await engine.run({source: 'console.log("again")'});
      await engine.reset();
      const afterReset = await engine.run({source: 'console.log("reset")'});
      engine.dispose();
      return {before, info: {runtimeName: info.runtimeName, runtimeVersion: info.runtimeVersion,
        bindingVersion: info.bindingVersion, policyVersion: info.policyVersion,
        initialized: info.initialized}, hello, syntax, exception, fresh, unicode,
        inputLimit, outputLimit, cancelled, afterCancel, timed, afterTimeout, afterReset,
        afterDispose: await rejected(() => engine.run({source: '1'})), state: engine.getState()};
    }, prefix);
    const summary = {before: observed.before, info: observed.info, inputLimit: observed.inputLimit,
      afterDispose: observed.afterDispose, state: observed.state};
    for (const key of ['hello','syntax','exception','fresh','unicode','outputLimit','cancelled',
      'afterCancel','timed','afterTimeout','afterReset']) summary[key] = stableResult(observed[key]);
    if (summary.before !== 'NOT_READY' || summary.inputLimit !== 'INPUT_LIMIT' ||
        summary.afterDispose !== 'DISPOSED' || summary.state !== 'disposed' ||
        summary.hello.stdout !== 'hello\n' || summary.syntax.status !== 'program-error' ||
        summary.exception.error.name !== 'TypeError' || summary.fresh.stdout !== 'undefined\n' ||
        summary.unicode.stdout !== '😀漢\n' || summary.outputLimit.stdout.length !== 32768 ||
        !summary.outputLimit.truncated || summary.cancelled.error.code !== 'CANCELLED' ||
        summary.afterCancel.stdout !== 'recovered\n' ||
        summary.timed.error.code !== 'EXECUTION_TIMEOUT' ||
        summary.afterTimeout.stdout !== 'again\n' || summary.afterReset.stdout !== 'reset\n')
      throw new Error(`${label} contract mismatch: ${JSON.stringify(summary)}`);
    if (!requests.some(url => url.endsWith(prefix + 'worker.js')) ||
        !requests.some(url => url.endsWith(prefix + 'emscripten-module.wasm')))
      throw new Error(`${label} failed to load package-relative Worker/WASM`);
    return summary;
  } finally { await page.close(); }
}

try {
  await mkdir(source);
  await mkdir(consumer);
  for (const file of ['package.json', 'package-lock.json', 'README.md', 'LICENSE'])
    await copyFile(file, join(source, file));
  await cp('src', join(source, 'src'), {recursive: true});
  await mkdir(join(source, 'scripts'));
  await copyFile('scripts/build.mjs', join(source, 'scripts/build.mjs'));
  await npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source);
  await npm(['run', 'build'], source);
  const first = await hashes(source);
  await npm(['run', 'build'], source);
  const second = await hashes(source);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Repeated build hashes differ');
  const manifest = JSON.parse(await npm(['pack', '--json', '--pack-destination', root], source, true))[0];
  const names = manifest.files.map(file => file.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedFiles) || manifest.bundled?.length)
    throw new Error(`Unexpected packed files: ${JSON.stringify(names)}`);
  const tarball = join(root, manifest.filename);
  await npm(['install', '--prefix', consumer, '--omit=dev', '--ignore-scripts', '--no-audit',
    '--no-fund', tarball], source);
  const installed = resolve(consumer, 'node_modules/javascript-browser-engine');
  const packedHashes = await hashes(installed);
  if (JSON.stringify(second) !== JSON.stringify(packedHashes))
    throw new Error('Packed/installed bytes differ from the clean build');
  const base = await serve();
  const products = [{name: 'Chrome', type: chromium, channel: 'chrome'},
    {name: 'Edge', type: chromium, channel: 'msedge'}];
  const browsers = [{name: 'Playwright Chromium', type: chromium},
    {name: 'Playwright Firefox', type: firefox}, {name: 'Playwright WebKit', type: webkit},
    ...products];
  for (const item of browsers) {
    let browser;
    try { browser = await item.type.launch({headless: true, ...(item.channel ? {channel: item.channel} : {})}); }
    catch (error) {
      if (item.channel && !requireProducts) {
        process.stdout.write(`${item.name}: UNVERIFIED (not installed: ${error.message.split('\n')[0]})\n`);
        continue;
      }
      throw error;
    }
    try {
      const cases = [
        {label: 'clean source build at nested page', prefix: '/source/', pagePath: '/app/nested/index.html'},
        {label: 'packed package at nested path', prefix: '/pkg/', pagePath: '/app/nested/index.html'},
        {label: 'packed package at root path', prefix: '/', pagePath: '/'},
      ];
      const results = [];
      for (const testCase of cases) results.push(await runContract(browser, base, testCase));
      if (results.some(result => JSON.stringify(result) !== JSON.stringify(results[0])))
        throw new Error(`${item.name} source/package/root behavior differs`);
      process.stdout.write(`${item.name} ${browser.version()}: 3/3 release-candidate contracts passed\n`);
    } finally { await browser.close(); }
  }
  process.stdout.write(`Clean repeat build and installed artifact identical: ${Object.keys(second).length} dist files; ${names.length} packed files; ${manifest.size} tarball bytes.\n`);
} finally {
  if (server) await new Promise(resolvePromise => server.close(resolvePromise));
  const resolvedRoot = await realpath(root);
  const resolvedParent = await realpath(tmpdir());
  if (!resolvedRoot.startsWith(resolvedParent + sep) ||
      !resolvedRoot.split(sep).at(-1).startsWith('js-engine-release-'))
    throw new Error('Refusing to remove unexpected temporary path');
  await rm(resolvedRoot, {recursive: true, force: true});
}
