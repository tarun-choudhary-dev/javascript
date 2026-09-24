import {mkdtemp, readFile, realpath, rm, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve, sep, extname} from 'node:path';
import {chromium} from '@playwright/test';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:consumer');
const tempRoot = await mkdtemp(join(tmpdir(), 'js-engine-consumer-'));
const consumer = join(tempRoot, 'consumer');
await mkdir(consumer);
let server;
let browser;

function npm(args, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {cwd: process.cwd(),
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'});
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise(output) : reject(new Error(`npm exited ${code}`)));
  });
}

try {
  const manifest = JSON.parse(await npm(['pack', '--json', '--pack-destination', tempRoot], true))[0];
  const expectedFiles = ['LICENSE', 'README.md', 'dist/THIRD_PARTY_NOTICES.txt',
    'dist/emscripten-module.wasm', 'dist/index.d.ts', 'dist/index.js', 'dist/package.json',
    'dist/worker.js', 'package.json'];
  const actualFiles = manifest.files.map(file => file.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles.sort()) || manifest.bundled.length)
    throw new Error(`Unexpected packed files: ${JSON.stringify(actualFiles)}`);
  for (const file of ['dist/index.js', 'dist/worker.js', 'dist/index.d.ts']) {
    const content = await readFile(file, 'utf8');
    if (content.includes(process.cwd()) || content.includes(process.cwd().replaceAll('\\', '/')) ||
        /(?:\.agents\/|SKILL\.md|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/u.test(content))
      throw new Error(`Local path or private material in packed ${file}`);
  }
  const tarball = join(tempRoot, 'javascript-browser-engine-0.1.0.tgz');
  await npm(['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const assetRoot = resolve(consumer, 'node_modules/javascript-browser-engine/dist');
  server = createServer(async (request, response) => {
    if (request.url === '/') { response.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html><title>consumer</title>'); return; }
    const path = resolve(assetRoot, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(assetRoot + sep)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(path);
      response.writeHead(200, {'Content-Type': extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript'}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const first = await engine.run({source: 'console.log("packed")'});
    let oversized;
    try { await engine.run({source: 'x'.repeat(32769)}); }
    catch (error) { oversized = error.code; }
    const limited = await engine.run({source: "for (let i = 0; i < 33; i++) console.log('x'.repeat(1023))"});
    const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    await engine.cancel();
    const cancelled = await pending;
    await engine.reset();
    const second = await engine.run({source: 'console.log("again")'});
    engine.dispose();
    return {first, oversized, limited, cancelled, second, state: engine.getState()};
  });
  if (result.first.stdout !== 'packed\n' || result.oversized !== 'INPUT_LIMIT' ||
      result.limited.stdout.length !== 32768 || !result.limited.truncated ||
      result.cancelled.error.code !== 'CANCELLED' || result.second.stdout !== 'again\n' ||
      result.state !== 'disposed')
    throw new Error('Packed consumer contract failed');
  process.stdout.write('Packed external consumer, contents, limits, and recovery passed.\n');
} finally {
  await browser?.close();
  if (server) await new Promise(resolvePromise => server.close(resolvePromise));
  const resolvedTemp = await realpath(tempRoot);
  const resolvedParent = await realpath(tmpdir());
  if (!resolvedTemp.startsWith(resolvedParent + sep) || !resolvedTemp.split(sep).at(-1).startsWith('js-engine-consumer-'))
    throw new Error('Refusing to remove unexpected temporary path');
  await rm(resolvedTemp, {recursive: true, force: true});
}
