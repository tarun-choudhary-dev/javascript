import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

test('new QuickJS runtime isolates globals, functions, objects, and prototypes', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const first = await engine.run({source: `
      globalThis.testValue = 123;
      globalThis.foo = 'bar';
      globalThis.fn = () => 1;
      globalThis.object = {a: 1};
      Object.prototype.leaked = 'old';
    `});
    const second = await engine.run({source: `
      console.log(typeof testValue, typeof foo, typeof fn, typeof object, typeof ({}).leaked);
    `});
    engine.dispose();
    return {first, second};
  });
  expect(observed.first.status).toBe('ok');
  expect(observed.second.stdout).toBe('undefined undefined undefined undefined undefined\n');
});

test('Script evaluation is ordered and does not drain Promise jobs', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const result = await engine.run({source: `
      console.log('A');
      Promise.resolve().then(() => console.log('promise later'));
      async function task() { console.log('prefix'); await Promise.resolve(); console.log('async later'); }
      task();
      new Promise(resolve => { console.log('executor'); resolve(); }).then(() => console.log('then later'));
      console.log('B');
      console.log(typeof setTimeout, typeof setInterval, typeof queueMicrotask);
    `});
    engine.dispose(); return result;
  });
  expect(observed.status).toBe('ok');
  expect(observed.stdout).toBe('A\nprefix\nexecutor\nB\nundefined undefined undefined\n');
});

test('program errors, engine errors, and stderr stay separate', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const syntax = await engine.run({source: 'const =', filename: 'syntax.js'});
    const reference = await engine.run({source: 'missingVariable;', filename: 'reference.js'});
    const runtime = await engine.run({source: 'throw new TypeError("bad")', filename: 'runtime.js'});
    const thrown = await engine.run({source: 'throw "plain"', filename: 'plain.js'});
    const stderr = await engine.run({source: 'console.error("warning")'});
    engine.dispose(); return {syntax, reference, runtime, thrown, stderr};
  });
  expect(observed.syntax).toMatchObject({status: 'program-error', stderr: '', error: {kind: 'program', name: 'SyntaxError', filename: 'syntax.js'}});
  expect(observed.reference).toMatchObject({status: 'program-error', stderr: '', error: {kind: 'program', name: 'ReferenceError', filename: 'reference.js'}});
  expect(observed.runtime).toMatchObject({status: 'program-error', stderr: '', error: {kind: 'program', name: 'TypeError', message: 'bad', filename: 'runtime.js'}});
  expect(observed.thrown).toMatchObject({status: 'program-error', error: {kind: 'program', name: 'ThrownValue', message: 'plain'}});
  expect(observed.stderr).toMatchObject({status: 'ok', stdout: '', stderr: 'warning\n', error: null});
});

test('runtime information and results are snapshots without runtime handles', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    const before = engine.getRuntimeInfo();
    await engine.initialize();
    const result = await engine.run({source: 'console.log("safe")'});
    result.stdout = 'changed by consumer';
    result.error = {kind: 'engine', code: 'RUNTIME_FAILURE'};
    const next = await engine.run({source: 'console.log("independent")'});
    engine.dispose();
    return {beforeFrozen: Object.isFrozen(before) && Object.isFrozen(before.limits) && Object.isFrozen(before.capabilities),
      beforeInitialized: before.initialized, afterDisposed: engine.getRuntimeInfo().initialized,
      next, keys: Object.keys(next).sort()};
  });
  expect(observed.beforeFrozen).toBe(true);
  expect(observed.beforeInitialized).toBe(false);
  expect(observed.afterDisposed).toBe(false);
  expect(observed.next.stdout).toBe('independent\n');
  expect(observed.keys).toEqual(['durationMs', 'error', 'status', 'stderr', 'stdout', 'truncated']);
});
