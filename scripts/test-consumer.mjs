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

function npm(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {cwd: process.cwd(), stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`npm exited ${code}`)));
  });
}

try {
  await npm(['pack', '--pack-destination', tempRoot]);
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
    await engine.reset();
    const second = await engine.run({source: 'console.log("again")'});
    engine.dispose();
    return {first, second, state: engine.getState()};
  });
  if (result.first.stdout !== 'packed\n' || result.second.stdout !== 'again\n' || result.state !== 'disposed')
    throw new Error('Packed consumer contract failed');
  process.stdout.write('Packed external consumer passed.\n');
} finally {
  await browser?.close();
  if (server) await new Promise(resolvePromise => server.close(resolvePromise));
  const resolvedTemp = await realpath(tempRoot);
  const resolvedParent = await realpath(tmpdir());
  if (!resolvedTemp.startsWith(resolvedParent + sep) || !resolvedTemp.split(sep).at(-1).startsWith('js-engine-consumer-'))
    throw new Error('Refusing to remove unexpected temporary path');
  await rm(resolvedTemp, {recursive: true, force: true});
}
