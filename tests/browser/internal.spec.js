import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

test('synchronous Script semantics and nested stack remain stable', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const sources = ['', '  \n  ', '1 + 2',
      'let x = 2; const y = 3; console.log(x + y)',
      'function twice(n) { return n * 2 } console.log(twice(4))',
      'const data = {a: [1, 2]}; for (const n of data.a) console.log(n)',
      'try { throw new Error("inner") } catch (e) { console.warn(e.message) }',
      'console.log("café 漢字 😀 e\u0301")'];
    const results = [];
    for (const source of sources) results.push(await engine.run({source}));
    const nested = await engine.run({source: [
      'function outer() { inner(); }',
      'function inner() { throw new Error("nested"); }',
      'outer();',
    ].join('\n'), filename: 'nested.js'});
    const syntax = await engine.run({source: 'const =', filename: 'syntax.js'});
    engine.dispose();
    return {results, nested, syntax};
  });
  expect(observed.results.map(result => [result.status, result.stdout, result.stderr])).toEqual([
    ['ok', '', ''], ['ok', '', ''], ['ok', '', ''], ['ok', '5\n', ''],
    ['ok', '8\n', ''], ['ok', '1\n2\n', ''], ['ok', '', 'inner\n'],
    ['ok', 'café 漢字 😀 e\u0301\n', ''],
  ]);
  expect(observed.nested).toMatchObject({status: 'program-error', error: {
    kind: 'program', name: 'Error', message: 'nested', filename: 'nested.js',
  }});
  expect(observed.nested.error.stack).toContain('inner');
  expect(observed.nested.error.stack).toContain('outer');
  expect(observed.nested.error.stack).toContain('nested.js');
  expect(observed.nested.error.stack).toMatch(/nested\.js:2:\d+/);
  expect(observed.nested.error.stack.length).toBeLessThanOrEqual(4096);
  expect(observed.syntax).toMatchObject({status: 'program-error', error: {
    kind: 'program', name: 'SyntaxError', filename: 'syntax.js',
  }});
  expect(observed.syntax.error.stack).toMatch(/syntax\.js:1:\d+/);
});

test('cancelling after a stream boundary preserves well-formed UTF-16 output', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const NativeWorker = window.Worker;
    let worker;
    window.Worker = function (...args) { worker = new NativeWorker(...args); return worker; };
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const original = worker.onmessage;
    let cancellation;
    worker.onmessage = event => {
      original(event);
      const message = JSON.parse(event.data);
      if (message.type === 'stream' && message.payload.sequence === 1)
        cancellation = engine.cancel();
    };
    const result = await engine.run({source: "console.log('x'.repeat(1022), '😀')"});
    await cancellation;
    const next = await engine.run({source: 'console.log("ready")'});
    engine.dispose();
    return {result, next};
  });
  expect(observed.result.error.code).toBe('CANCELLED');
  expect(observed.result.stdout).toBe('x'.repeat(1022) + ' ');
  expect(observed.next.stdout).toBe('ready\n');
});

test('large multilingual output stays bounded without broken surrogate pairs', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const result = await engine.run({source:
      "for (let i = 0; i < 70; i++) console.log('漢😀e\\u0301'.repeat(100))"});
    engine.dispose();
    return result;
  });
  const full = ('漢😀e\u0301'.repeat(100) + '\n').repeat(70);
  expect(result.status).toBe('ok');
  expect(result.truncated).toBe(true);
  expect(result.stdout.length).toBeLessThanOrEqual(32768);
  expect(full.startsWith(result.stdout)).toBe(true);
  expect(result.stdout).not.toContain('\uFFFD');
  expect(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u.test(result.stdout)).toBe(false);
});

test('fresh guest globals survive normal, reset, cancel, and timeout boundaries', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const outputs = [];
    for (const boundary of ['normal', 'reset', 'cancel', 'timeout']) {
      await engine.run({source: 'globalThis.secret = 1; Object.prototype.marker = 2'});
      if (boundary === 'reset') await engine.reset();
      if (boundary === 'cancel') {
        const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
        await engine.cancel();
        outputs.push((await pending).error.code);
      }
      if (boundary === 'timeout') {
        const timed = await engine.run({source: 'for (;;) {}', timeoutMs: 150});
        outputs.push(timed.error.code);
        await engine.initialize();
      }
      const fresh = await engine.run({source: 'console.log(typeof secret, typeof ({}).marker)'});
      outputs.push(fresh.stdout.trim());
    }
    engine.dispose();
    return outputs;
  });
  expect(observed).toEqual(['undefined undefined', 'undefined undefined', 'CANCELLED',
    'undefined undefined', 'EXECUTION_TIMEOUT', 'undefined undefined']);
});

test('the five console methods map only to bounded stdout and stderr', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const result = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const result = await engine.run({source: `
      console.log('log'); console.info('info'); console.debug('debug');
      console.warn('warn'); console.error('error');
    `});
    engine.dispose();
    return result;
  });
  expect(result.status).toBe('ok');
  expect(result.stdout).toBe('log\ninfo\ndebug\n');
  expect(result.stderr).toBe('warn\nerror\n');
});
