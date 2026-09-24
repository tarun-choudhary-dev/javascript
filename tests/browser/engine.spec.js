import {test, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';

let server;
let base;
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = resolve('.', `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(resolve('.') + sep)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(path);
      const mime = {'.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html'}[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, {'Content-Type': mime}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

test('external-style consumer initializes, executes, resets and disposes', async ({page}) => {
  await page.goto(`${base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    const states = [engine.getState()];
    await engine.initialize(); states.push(engine.getState());
    const hello = await engine.run({source: 'console.log("Hello from QuickJS");'});
    const computation = await engine.run({source: 'const a = 10; const b = 20; console.log(a+b);'});
    const error = await engine.run({source: 'throw new Error("intentional test")'});
    const syntax = await engine.run({source: 'const ='});
    await engine.run({source: 'globalThis.testValue = 123'});
    const fresh = await engine.run({source: 'console.log(globalThis.testValue)'});
    await engine.reset(); states.push(engine.getState());
    const afterReset = await engine.run({source: 'console.warn("again")'});
    engine.dispose(); states.push(engine.getState());
    return {states, hello, computation, error, syntax, fresh, afterReset,
      info: engine.getRuntimeInfo()};
  });
  expect(result.states).toEqual(['created', 'ready', 'ready', 'disposed']);
  expect(result.hello).toMatchObject({status: 'ok', stdout: 'Hello from QuickJS\n', stderr: '', error: null});
  expect(result.computation.stdout).toBe('30\n');
  expect(result.error).toMatchObject({status: 'program-error', error: {kind: 'program', name: 'Error', message: 'intentional test'}});
  expect(result.syntax).toMatchObject({status: 'program-error', error: {kind: 'program', name: 'SyntaxError'}});
  expect(result.fresh.stdout).toBe('undefined\n');
  expect(result.afterReset.stderr).toBe('again\n');
  expect(result.info.initialized).toBe(false);
});

test('infinite loop cancellation terminates and recovers Worker', async ({page}) => {
  await page.goto(`${base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    const busy = engine.isBusy();
    await engine.cancel();
    const cancelled = await pending;
    const next = await engine.run({source: 'console.log("recovered")'});
    engine.dispose();
    return {busy, cancelled, next};
  });
  expect(result.busy).toBe(true);
  expect(result.cancelled.error.code).toBe('CANCELLED');
  expect(result.next.stdout).toBe('recovered\n');
});

test('host deadline interrupts infinite loop and recovers', async ({page}) => {
  await page.goto(`${base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const timed = await engine.run({source: 'while (true) {}', timeoutMs: 100});
    while (engine.getState() === 'recovering') await new Promise(resolve => setTimeout(resolve, 10));
    const next = await engine.run({source: 'console.log("ok")'});
    engine.dispose();
    return {timed, next};
  });
  expect(result.timed.error.code).toBe('EXECUTION_TIMEOUT');
  expect(result.next.stdout).toBe('ok\n');
});

test('guest has no ambient browser API references', async ({page}) => {
  await page.goto(`${base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const probe = await engine.run({source: 'console.log(["window","document","fetch","localStorage","indexedDB","Worker","postMessage","WebSocket"].map(x=>typeof globalThis[x]).join(","))'});
    engine.dispose(); return probe;
  });
  expect(result.stdout).toBe(`${Array(8).fill('undefined').join(',')}\n`);
});

test('script profile, output bounds, and invalid lifecycle calls', async ({page}) => {
  await page.goto(`${base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    let before, after;
    try { await engine.run({source: '1'}); } catch (error) { before = error.code; }
    await engine.initialize();
    const primitives = await engine.run({source: 'console.log(true, false, null, 42, {a:1})'});
    const moduleSyntax = await engine.run({source: 'export const value = 1'});
    const promise = await engine.run({source: 'Promise.resolve().then(() => console.log("later")); console.log("now")'});
    const huge = await engine.run({source: 'console.log("x".repeat(100000))'});
    engine.dispose();
    try { await engine.run({source: '1'}); } catch (error) { after = error.code; }
    return {before, after, primitives, moduleSyntax, promise, huge};
  });
  expect(result.before).toBe('NOT_READY');
  expect(result.after).toBe('DISPOSED');
  expect(result.primitives.stdout).toBe('true false null 42 [object]\n');
  expect(result.moduleSyntax.error.name).toBe('SyntaxError');
  expect(result.promise.stdout).toBe('now\n');
  expect(result.huge.status).toBe('ok');
  expect(result.huge.truncated).toBe(true);
  expect(result.huge.stdout.length).toBeLessThanOrEqual(32768);
});

test('guest cannot read host storage canary or issue fetch through browser APIs', async ({page}) => {
  let externalRequests = 0;
  page.on('request', request => { if (request.url().includes('/forbidden-network')) externalRequests++; });
  await page.goto(`${base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    localStorage.setItem('engine-canary', 'secret');
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const probe = await engine.run({source: `
      const lookup = Function('return [typeof fetch, typeof localStorage, typeof window, typeof postMessage]')();
      console.log(lookup.join(','));
      try { fetch('/forbidden-network'); } catch (e) { console.log(e.name); }
    `});
    const canary = localStorage.getItem('engine-canary');
    engine.dispose();
    return {probe, canary};
  });
  expect(result.probe.stdout).toBe('undefined,undefined,undefined,undefined\nReferenceError\n');
  expect(result.canary).toBe('secret');
  expect(externalRequests).toBe(0);
});
