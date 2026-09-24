import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

test('CSP denying WASM network acquisition fails closed and permits disposal', async ({page}) => {
  fixture.setCsp("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'none'");
  try {
    await page.goto(`${fixture.base}/tests/browser/fixture.html`);
    const observed = await page.evaluate(async () => {
      const {JavaScriptEngine} = await import('/dist/index.js');
      const engine = new JavaScriptEngine();
      let code;
      try { await engine.initialize(); } catch (error) { code = error.code; }
      const failedState = engine.getState();
      engine.dispose();
      return {code, failedState, disposedState: engine.getState()};
    });
    expect(observed).toEqual({code: 'INITIALIZATION_FAILED', failedState: 'failed',
      disposedState: 'disposed'});
  } finally { fixture.setCsp(null); }
});

test('CSP without WASM compilation permission rejects initialization', async ({page}) => {
  fixture.setCsp("default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'");
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

test('cross-origin distribution script cannot boot its package-relative Worker', async ({page}) => {
  const assetHost = await startFixtureServer();
  assetHost.setCors('*');
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.goto(`${fixture.base}/tests/browser/fixture.html`);
    const observed = await page.evaluate(async assetBase => {
      const {JavaScriptEngine} = await import(`${assetBase}/dist/index.js`);
      const engine = new JavaScriptEngine();
      let code;
      try { await engine.initialize(); } catch (error) { code = error.code; }
      const state = engine.getState();
      engine.dispose();
      return {code, state};
    }, assetHost.base);
    expect(observed).toEqual({code: 'INITIALIZATION_FAILED', state: 'failed'});
    expect(requests).toContain(`${assetHost.base}/dist/index.js`);
    expect(requests).not.toContain(`${assetHost.base}/dist/emscripten-module.wasm`);
  } finally { await assetHost.close(); }
});

test('indirect guest constructors and dynamic import do not reach host or network', async ({page}) => {
  const forbidden = [];
  page.on('request', request => {
    if (request.url().includes('guest-forbidden')) forbidden.push(request.url());
  });
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    window.__releaseCanary = 'host-secret';
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const result = await engine.run({source: `
      const routes = [Function('return this')(), ({}).constructor.constructor('return this')(),
        console.log.constructor('return this')(), (0,eval)('this')];
      console.log(routes.every(value => value === globalThis));
      console.log(routes.map(value => typeof value.__releaseCanary).join(','));
      console.log(routes.map(value => typeof value.fetch).join(','));
      try { import('/guest-forbidden'); } catch (e) { console.log(e.name); }
    `});
    engine.dispose();
    return {result, canary: window.__releaseCanary};
  });
  expect(observed.result.status).toBe('ok');
  expect(observed.result.stdout).toContain('true\n');
  expect(observed.result.stdout).toContain('undefined,undefined,undefined,undefined\n');
  expect(observed.canary).toBe('host-secret');
  expect(forbidden).toEqual([]);
});
