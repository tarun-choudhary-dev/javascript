import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

test('output and error limits hold at and past their boundaries', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const at = await engine.run({source: "for (let i = 0; i < 32; i++) console.log('x'.repeat(1023))"});
    const beyond = await engine.run({source: "for (let i = 0; i < 33; i++) console.log('x'.repeat(1023))"});
    const argument = await engine.run({source: "console.log('x'.repeat(1025))"});
    const unicode = await engine.run({source: "console.log('x'.repeat(1023) + '😀')"});
    const error = await engine.run({source: "throw new Error('y'.repeat(3000))"});
    const flood = await engine.run({source: 'for (let i = 0; i < 200; i++) console.log()'});
    engine.dispose();
    return {at, beyond, argument, unicode, error, flood};
  });
  expect(observed.at).toMatchObject({status: 'ok', truncated: false});
  expect(observed.at.stdout).toHaveLength(32768);
  expect(observed.beyond).toMatchObject({status: 'ok', truncated: true});
  expect(observed.beyond.stdout).toHaveLength(32768);
  expect(observed.argument.stdout).toHaveLength(1025);
  expect(observed.argument.truncated).toBe(true);
  expect(observed.unicode.stdout).toBe('x'.repeat(1023) + '\n');
  expect(observed.unicode.truncated).toBe(true);
  expect(observed.error.status).toBe('program-error');
  expect(observed.error.error.message).toHaveLength(2048);
  expect(observed.error.truncated).toBe(true);
  expect(observed.flood.error).toMatchObject({kind: 'engine', code: 'RESOURCE_LIMIT'});
});

test('initialization failure on unavailable WASM is bounded and retryable', async ({page}) => {
  fixture.setWasmBlocked(true);
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const failed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    window.__engine = new JavaScriptEngine();
    try { await window.__engine.initialize(); return null; }
    catch (error) { return {code: error.code, state: window.__engine.getState()}; }
  });
  expect(failed).toEqual({code: 'INITIALIZATION_FAILED', state: 'failed'});
  fixture.setWasmBlocked(false);
  const restored = await page.evaluate(async () => {
    await window.__engine.initialize();
    const result = await window.__engine.run({source: 'console.log("restored")'});
    window.__engine.dispose();
    return {result, state: window.__engine.getState()};
  });
  expect(restored.result.stdout).toBe('restored\n');
  expect(restored.state).toBe('disposed');
});
