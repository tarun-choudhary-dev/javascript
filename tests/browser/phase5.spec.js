import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

test('guest global inventory excludes browser, Node, and host bridge capabilities', async ({page}) => {
  const network = [];
  page.on('request', request => {
    if (request.url().includes('guest-forbidden')) network.push(request.url());
  });
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    window.__phase5Canary = 'host-only';
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const probe = await engine.run({source: `
      const names = ['window','document','parent','top','opener','self','navigator','location',
        'HTMLElement','DOMParser','MutationObserver','customElements',
        'localStorage','sessionStorage','indexedDB','caches','cookieStore',
        'fetch','XMLHttpRequest','WebSocket','EventSource','RTCPeerConnection',
        'Worker','SharedWorker','BroadcastChannel','MessageChannel','MessagePort','postMessage',
        'ServiceWorker','WebTransport','importScripts','URL','Blob','WebAssembly','crypto',
        'Notification','Clipboard','Geolocation','MediaDevices','USB','Serial','HID',
        'process','require','Buffer','__phase5Canary'];
      for (let i = 0; i < names.length; i += 8)
        console.log(JSON.stringify(names.slice(i, i + 8).map(name => [name, typeof globalThis[name]])));
      const all = Object.getOwnPropertyNames(globalThis);
      for (let i = 0; i < all.length; i += 12) console.log(JSON.stringify({globals: all.slice(i, i + 12)}));
      const escaped = globalThis.constructor.constructor('return this')();
      console.log(JSON.stringify({escapeIsGuest: escaped === globalThis,
        hostCanary: typeof escaped.__phase5Canary, consoleMethods: Object.keys(console).sort()}));
      console.log(typeof globalThis.fetch === 'undefined' ? 'fetch-absent' : 'fetch-present');
    `});
    const mutation = await engine.run({source: `
      console.extra = 'guest'; globalThis.__phase5Canary = 'guest';
      console.log(typeof globalThis.fetch, typeof globalThis.document);
    `});
    const fresh = await engine.run({source: `console.log(typeof console.extra, typeof globalThis.__phase5Canary)`});
    engine.dispose();
    return {probe, mutation, fresh, hostCanary: window.__phase5Canary};
  });
  expect(observed.probe.status).toBe('ok');
  const records = observed.probe.stdout.trim().split('\n').map(line => {
    try { return JSON.parse(line); } catch { return line; }
  });
  const targeted = records.filter(Array.isArray).flat();
  const globals = records.filter(record => record && typeof record === 'object' &&
    !Array.isArray(record) && 'globals' in record).flatMap(record => record.globals);
  expect(targeted.length).toBeGreaterThan(35);
  expect(targeted.every(([, kind]) => kind === 'undefined')).toBe(true);
  expect(globals).toContain('console');
  expect(globals).toContain('Object');
  expect(globals).not.toContain('fetch');
  const allowedGlobals = new Set(`AggregateError Array ArrayBuffer BigInt BigInt64Array BigUint64Array
    Boolean DataView Date Error EvalError FinalizationRegistry Float16Array Float32Array Float64Array
    Function Infinity Int16Array Int32Array Int8Array InternalError Iterator JSON Map Math NaN
    Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer
    String Symbol SyntaxError TypeError URIError Uint16Array Uint32Array Uint8Array
    Uint8ClampedArray WeakMap WeakRef WeakSet console decodeURI decodeURIComponent encodeURI
    encodeURIComponent escape eval globalThis isFinite isNaN parseFloat parseInt undefined
    unescape`.split(/\s+/u).filter(Boolean));
  expect(globals.length).toBe(allowedGlobals.size);
  expect(globals.every(name => allowedGlobals.has(name))).toBe(true);
  expect(records).toContainEqual({escapeIsGuest: true, hostCanary: 'undefined',
    consoleMethods: ['debug', 'error', 'info', 'log', 'warn']});
  expect(records).toContain('fetch-absent');
  expect(observed.mutation.stdout).toBe('undefined undefined\n');
  expect(observed.fresh.stdout).toBe('undefined undefined\n');
  expect(observed.hostCanary).toBe('host-only');
  expect(network).toEqual([]);
});

test('a restrictive same-origin CSP permits the packaged Worker and WASM', async ({page}) => {
  fixture.setCsp("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'");
  try {
    await page.goto(`${fixture.base}/tests/browser/fixture.html`);
    const result = await page.evaluate(async () => {
      const {JavaScriptEngine} = await import('/dist/index.js');
      const engine = new JavaScriptEngine();
      await engine.initialize();
      const run = await engine.run({source: 'console.log("csp")'});
      engine.dispose();
      return run;
    });
    expect(result.stdout).toBe('csp\n');
  } finally { fixture.setCsp(null); }
});

test('worker-src denial prevents initialization without executing guest code', async ({page}) => {
  fixture.setCsp("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'none'; connect-src 'self'");
  try {
    await page.goto(`${fixture.base}/tests/browser/fixture.html`);
    const observed = await page.evaluate(async () => {
      const {JavaScriptEngine} = await import('/dist/index.js');
      const engine = new JavaScriptEngine();
      let code;
      try { await engine.initialize(); } catch (error) { code = error.code; }
      const state = engine.getState();
      engine.dispose();
      return {code, state};
    });
    expect(observed).toEqual({code: 'INITIALIZATION_FAILED', state: 'failed'});
  } finally { fixture.setCsp(null); }
});

test('runtime asset acquisition is distinct from guest networking and can carry origin cookies', async ({page}) => {
  await page.context().addCookies([{name: 'phase5-asset', value: 'canary',
    url: fixture.base, sameSite: 'Lax'}]);
  const assets = [];
  page.on('request', request => {
    if (request.url().endsWith('/worker.js') || request.url().endsWith('/emscripten-module.wasm'))
      assets.push(request);
  });
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const guest = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const result = await engine.run({source: 'console.log(typeof fetch)'});
    engine.dispose();
    return result;
  });
  expect(guest.stdout).toBe('undefined\n');
  const wasm = assets.find(request => request.url().endsWith('/emscripten-module.wasm'));
  expect(wasm).toBeDefined();
  expect((await wasm.allHeaders()).cookie).toContain('phase5-asset=canary');
});

test('trusted Worker retains browser authority that is not bridged into QuickJS', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const guest = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    window.__phase5Engine = new JavaScriptEngine();
    await window.__phase5Engine.initialize();
    return window.__phase5Engine.run({source: `
      console.log(typeof fetch, typeof postMessage, typeof WebAssembly, typeof indexedDB);
    `});
  });
  expect(page.workers()).toHaveLength(1);
  const worker = await page.workers()[0].evaluate(() => ({
    fetch: typeof fetch, postMessage: typeof postMessage, WebAssembly: typeof WebAssembly,
    indexedDB: typeof indexedDB, performanceMemory: typeof performance.memory,
    specificMemory: typeof performance.measureUserAgentSpecificMemory,
  }));
  expect(guest.stdout).toBe('undefined undefined undefined undefined\n');
  expect(worker).toMatchObject({fetch: 'function', postMessage: 'function', WebAssembly: 'object'});
  await page.evaluate(() => window.__phase5Engine.dispose());
});

test('output and error Unicode boundaries preserve a healthy next run', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const output = await engine.run({source: `
      for (let i = 0; i < 40; i++) { console.log('😀'.repeat(510)); console.error('é漢'.repeat(170)); }
    `});
    const error = await engine.run({source: `throw Error('😀'.repeat(1500))`});
    const stack = await engine.run({source: `throw new Error('stack')`, filename: 'phase5.js'});
    const next = await engine.run({source: 'console.log("next")'});
    engine.dispose();
    return {output, error, stack, next};
  });
  const broken = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u;
  expect(observed.output.status).toBe('ok');
  expect(observed.output.truncated).toBe(true);
  expect(observed.output.stdout.length + observed.output.stderr.length).toBeLessThanOrEqual(32768);
  expect(broken.test(observed.output.stdout + observed.output.stderr)).toBe(false);
  expect(observed.error.status).toBe('program-error');
  expect(observed.error.error.message.length).toBeLessThanOrEqual(2048);
  expect(broken.test(observed.error.error.message)).toBe(false);
  expect(observed.stack.error.stack).toContain('phase5.js');
  expect(observed.next.stdout).toBe('next\n');
});

test('bounded allocation, cancellation, and timeout leave a responsive browser', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const allocations = [];
    for (const blocks of [4, 8, 12]) {
      const result = await engine.run({source: `
        let buffers = []; for (let i = 0; i < ${blocks}; i++) buffers.push(('x'.repeat(1048576) + i).slice(0, 1048576));
        console.log(buffers.length);
      `, timeoutMs: 2000});
      allocations.push({blocks, status: result.status, code: result.error?.code ?? null});
      await engine.initialize();
    }
    const withinHeap = await engine.run({source: 'const a = new Uint8Array(8 * 1024 * 1024); a[0] = 1; console.log(a.length)'});
    const pressure = await engine.run({source: 'const a = new Uint8Array(20 * 1024 * 1024); console.log(a.length)'});
    await engine.initialize();
    const pending = engine.run({source: `let data = []; for (;;) data.push('x'.repeat(1024) + data.length)`, timeoutMs: 5000});
    await engine.cancel();
    const cancelled = await pending;
    const timed = await engine.run({source: `console.log('before'); while (true) {}`, timeoutMs: 150});
    await engine.initialize();
    const next = await engine.run({source: `console.log('healthy')`});
    engine.dispose();
    return {allocations, withinHeap, pressure, cancelled, timed, next,
      state: engine.getState(), responsive: 1 + 1};
  });
  expect(observed.allocations).toHaveLength(3);
  expect(observed.allocations.every(item => ['ok', 'engine-error'].includes(item.status))).toBe(true);
  expect(observed.withinHeap.stdout).toBe('8388608\n');
  expect(observed.pressure).toMatchObject({status: 'engine-error', error: {code: 'RUNTIME_FAILURE'}});
  expect(observed.cancelled.error.code).toBe('CANCELLED');
  expect(observed.timed.error.code).toBe('EXECUTION_TIMEOUT');
  expect(observed.next.stdout).toBe('healthy\n');
  expect(observed.state).toBe('disposed');
  expect(observed.responsive).toBe(2);
});
