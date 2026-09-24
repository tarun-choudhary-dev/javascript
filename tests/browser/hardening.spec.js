import {test, expect} from '@playwright/test';
import {startFixtureServer} from './server.js';

let fixture;
test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture.close(); });

async function trackWorkers(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__engineWorkers = [];
    window.Worker = function (...args) {
      const worker = new NativeWorker(...args);
      worker.__sent = [];
      worker.__terminated = false;
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (raw, ...rest) => {
        worker.__sent.push(JSON.parse(raw));
        return post(raw, ...rest);
      };
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { worker.__terminated = true; return terminate(); };
      window.__engineWorkers.push(worker);
      return worker;
    };
    window.Worker.prototype = NativeWorker.prototype;
  });
}

test('initialization, invalid calls, and reset during initialization follow the state contract', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    const rejected = async operation => { try { await operation(); return null; } catch (error) { return error.code; } };
    const before = await rejected(() => engine.run({source: '1'}));
    const first = engine.initialize();
    const initializing = engine.getState();
    const during = await rejected(() => engine.run({source: '1'}));
    await engine.cancel();
    const second = engine.initialize();
    const reset = engine.reset();
    const superseded = await rejected(() => first);
    const joined = await rejected(() => second);
    await reset;
    const ready = engine.getState();
    await engine.initialize();
    await engine.cancel();
    const stillReady = engine.getState();
    engine.dispose();
    engine.dispose();
    return {before, initializing, during, superseded, joined, ready, stillReady,
      after: await rejected(() => engine.run({source: '1'})), state: engine.getState()};
  });
  expect(observed).toEqual({before: 'NOT_READY', initializing: 'initializing', during: 'NOT_READY',
    superseded: 'RESET', joined: 'RESET', ready: 'ready', stillReady: 'ready',
    after: 'DISPOSED', state: 'disposed'});
});

test('busy and reset/dispose overlaps settle once', async ({page}) => {
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const first = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    let concurrent;
    try { await engine.run({source: '1'}); } catch (error) { concurrent = error.code; }
    await engine.reset();
    const resetResult = await first;
    const afterReset = await engine.run({source: 'console.log("fresh")'});
    const second = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    engine.dispose();
    const disposedResult = await second;
    return {concurrent, resetResult, afterReset, disposedResult, state: engine.getState()};
  });
  expect(observed.concurrent).toBe('BUSY');
  expect(observed.resetResult.error.code).toBe('RESET');
  expect(observed.afterReset.stdout).toBe('fresh\n');
  expect(observed.disposedResult.error.code).toBe('DISPOSED');
  expect(observed.state).toBe('disposed');
});

test('old real Worker handlers cannot change a replacement run', async ({page}) => {
  await trackWorkers(page);
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const old = window.__engineWorkers[0];
    const oldHandler = old.onmessage;
    const first = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    const runId = old.__sent.at(-1);
    const bootId = old.__sent[0];
    await engine.cancel();
    const cancelled = await first;
    const second = engine.run({source: 'console.log("current")'});
    const deliver = (identity, op, type, payload) => oldHandler({data: JSON.stringify({
      protocolVersion: 1, generation: identity.generation, requestId: identity.requestId,
      op, type, payload}), ports: []});
    deliver(runId, 'run', 'stream', {sequence: 1, channel: 'stdout', text: 'stale\n'});
    deliver(runId, 'run', 'result', {status: 'ok', error: null, truncated: false,
      lastSequence: 1, stdoutChars: 6, stderrChars: 0});
    deliver(runId, 'run', 'fatal', {code: 'RUNTIME_FAILURE'});
    deliver(bootId, 'initialize', 'ready', {runtimeName: 'QuickJS'});
    const busyAfterStale = engine.isBusy();
    const current = await second;
    const oldTerminated = old.__terminated;
    const generations = window.__engineWorkers.map(worker => worker.__sent[0].generation);
    engine.dispose();
    return {cancelled, current, busyAfterStale, oldTerminated, generations,
      allTerminated: window.__engineWorkers.every(worker => worker.__terminated)};
  });
  expect(observed.cancelled.error.code).toBe('CANCELLED');
  expect(observed.current.stdout).toBe('current\n');
  expect(observed.busyAfterStale).toBe(true);
  expect(observed.oldTerminated).toBe(true);
  expect(observed.generations).toEqual([1, 2]);
  expect(observed.allTerminated).toBe(true);
});

test('repeated timeout and cancellation replace each Worker once', async ({page}) => {
  await trackWorkers(page);
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const outcomes = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      const timed = await engine.run({source: 'while (true) {}', timeoutMs: 150});
      outcomes.push(timed.error.code);
      await engine.initialize();
      const cancelledRun = engine.run({source: 'while (true) {}', timeoutMs: 5000});
      await engine.cancel();
      outcomes.push((await cancelledRun).error.code);
      outcomes.push((await engine.run({source: `console.log(${iteration})`})).stdout.trim());
    }
    const generations = window.__engineWorkers.map(worker => worker.__sent[0].generation);
    engine.dispose();
    return {outcomes, generations, allTerminated: window.__engineWorkers.every(worker => worker.__terminated),
      state: engine.getState()};
  });
  expect(observed.outcomes).toEqual(['EXECUTION_TIMEOUT', 'CANCELLED', '0',
    'EXECUTION_TIMEOUT', 'CANCELLED', '1', 'EXECUTION_TIMEOUT', 'CANCELLED', '2']);
  expect(observed.generations).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(observed.allTerminated).toBe(true);
  expect(observed.state).toBe('disposed');
});

test('controlled Worker error settles run and recovers', async ({page}) => {
  await trackWorkers(page);
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    await engine.initialize();
    const worker = window.__engineWorkers[0];
    const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    worker.onerror({preventDefault() {}});
    const failed = await pending;
    await engine.initialize();
    const next = await engine.run({source: 'console.log("after failure")'});
    engine.dispose();
    return {failed, next, firstTerminated: worker.__terminated,
      workers: window.__engineWorkers.length};
  });
  expect(observed.failed.error.code).toBe('WORKER_FAILURE');
  expect(observed.next.stdout).toBe('after failure\n');
  expect(observed.firstTerminated).toBe(true);
  expect(observed.workers).toBe(2);
});

test('repeated lifecycle cycles leave no live or attached tracked Workers', async ({page}) => {
  await trackWorkers(page);
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const states = [];
    for (let iteration = 0; iteration < 8; iteration++) {
      const engine = new JavaScriptEngine();
      await engine.initialize();
      const first = await engine.run({source: `console.log(${iteration})`});
      await engine.reset();
      const second = await engine.run({source: 'console.log("reset")'});
      const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
      await engine.cancel();
      const cancelled = await pending;
      const final = await engine.run({source: 'console.log("recovered")'});
      engine.dispose();
      states.push([first.stdout.trim(), second.stdout.trim(), cancelled.error.code,
        final.stdout.trim(), engine.getState()]);
    }
    return {states, workerCount: window.__engineWorkers.length,
      terminated: window.__engineWorkers.filter(worker => worker.__terminated).length,
      attached: window.__engineWorkers.filter(worker =>
        worker.onmessage || worker.onerror || worker.onmessageerror).length};
  });
  expect(observed.states).toEqual(Array.from({length: 8}, (_, iteration) =>
    [String(iteration), 'reset', 'CANCELLED', 'recovered', 'disposed']));
  expect(observed.workerCount).toBe(24);
  expect(observed.terminated).toBe(24);
  expect(observed.attached).toBe(0);
});

test('overlapping initialization and terminal disposal settle controls without extra Workers', async ({page}) => {
  await trackWorkers(page);
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const observed = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const code = async pending => { try { await pending; return 'ok'; } catch (error) { return error.code; } };
    const initializing = new JavaScriptEngine();
    const bootA = initializing.initialize();
    const bootB = initializing.initialize();
    initializing.dispose();
    const boot = [await code(bootA), await code(bootB), initializing.getState()];
    const engine = new JavaScriptEngine();
    const joinA = engine.initialize();
    const joinB = engine.initialize();
    const joined = [await code(joinA), await code(joinB), engine.getState()];
    const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    const cancelling = engine.cancel();
    engine.dispose();
    const cancelled = [(await pending).error.code, await code(cancelling), engine.getState()];
    const resetting = new JavaScriptEngine();
    await resetting.initialize();
    const reset = resetting.reset();
    resetting.dispose();
    const resetResult = [await code(reset), resetting.getState()];
    return {boot, joined, cancelled, resetResult,
      workerCount: window.__engineWorkers.length,
      terminated: window.__engineWorkers.every(worker => worker.__terminated)};
  });
  expect(observed.boot).toEqual(['DISPOSED', 'DISPOSED', 'disposed']);
  expect(observed.joined).toEqual(['ok', 'ok', 'ready']);
  expect(observed.cancelled).toEqual(['CANCELLED', 'DISPOSED', 'disposed']);
  expect(observed.resetResult).toEqual(['DISPOSED', 'disposed']);
  expect(observed.workerCount).toBe(5);
  expect(observed.terminated).toBe(true);
});
