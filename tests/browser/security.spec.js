import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

test('guest lacks sampled browser capabilities and cannot read host canaries', async ({page}) => {
  const forbiddenRequests = [];
  const sockets = [];
  page.on('request', request => { if (request.url().includes('/guest-forbidden')) forbiddenRequests.push(request.url()); });
  page.on('websocket', socket => sockets.push(socket.url()));
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    window.__engineSecret = 'host-global-secret';
    document.body.dataset.engineSecret = 'dom-secret';
    localStorage.setItem('engine-secret', 'storage-secret');
    sessionStorage.setItem('engine-secret', 'session-secret');
    document.cookie = 'engine-secret=cookie-secret; SameSite=Lax';
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const names = ['window','document','parent','top','opener','self','location','navigator',
      'localStorage','sessionStorage','indexedDB','caches','cookieStore','fetch','XMLHttpRequest',
      'WebSocket','EventSource','RTCPeerConnection','Worker','SharedWorker','BroadcastChannel',
      'postMessage','MessageChannel','importScripts','Notification','WebAssembly','process','require',
      'Buffer','setTimeout','setInterval','queueMicrotask'];
    const inventory = await engine.run({source: `
      const names = ${JSON.stringify(names)};
      console.log(JSON.stringify(names.map(name => [name, typeof globalThis[name]])));
      try { Function('return window.__engineSecret')(); }
      catch (error) { console.log(error.name); }
    `});
    const attempted = await engine.run({source: `
      try { fetch('/guest-forbidden'); } catch (error) { console.log(error.name); }
      try { new WebSocket('ws://127.0.0.1/guest-forbidden'); } catch (error) { console.log(error.name); }
      console.log(typeof Function('return this')().__engineSecret);
    `});
    const canaries = {global: window.__engineSecret, dom: document.body.dataset.engineSecret,
      local: localStorage.getItem('engine-secret'), session: sessionStorage.getItem('engine-secret'),
      cookie: document.cookie.includes('engine-secret=cookie-secret')};
    engine.dispose();
    return {inventory, attempted, canaries};
  });
  const values = JSON.parse(observed.inventory.stdout.split('\n')[0]);
  expect(values.map(([name, type]) => `${name}:${type}`)).toEqual(values.map(([name]) => `${name}:undefined`));
  expect(observed.inventory.stdout.split('\n')[1]).toBe('ReferenceError');
  expect(observed.attempted.stdout).toBe('ReferenceError\nReferenceError\nundefined\n');
  expect(observed.canaries).toEqual({global: 'host-global-secret', dom: 'dom-secret',
    local: 'storage-secret', session: 'session-secret', cookie: true});
  expect(forbiddenRequests).toEqual([]);
  expect(sockets).toEqual([]);
});

test('console object formatting does not traverse hostile guest values', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const result = await engine.run({source: `
      let traps = 0;
      const value = new Proxy({}, {get() { traps++; throw Error('get'); }, ownKeys() { traps++; throw Error('keys'); }});
      console.log(value);
      console.log(traps);
      String.prototype.slice = () => { throw Error('modified'); };
      console.log('x'.repeat(3000));
    `});
    engine.dispose(); return result;
  });
  expect(observed.status).toBe('ok');
  expect(observed.stdout.startsWith('[object]\n0\n')).toBe(true);
  expect(observed.truncated).toBe(true);
  expect(observed.stdout.length).toBeLessThan(1100);
});

test('host deadline covers hostile error getter and recovery', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const bad = await engine.run({source: 'throw {get name() { while (true) {} }}', timeoutMs: 150});
    await engine.initialize();
    const next = await engine.run({source: 'console.log("healthy")'});
    engine.dispose(); return {bad, next};
  });
  expect(['EXECUTION_TIMEOUT', 'RUNTIME_FAILURE']).toContain(observed.bad.error.code);
  expect(observed.next.stdout).toBe('healthy\n');
});
