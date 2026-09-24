import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineController} from '../../src/lifecycle/controller.js';
import {encode, decode, RUNTIME_INFO} from '../../src/execution/protocol.js';

class FakeWorker {
  static instances = [];
  constructor() { this.sent = []; this.terminated = false; FakeWorker.instances.push(this); }
  postMessage(raw) {
    const message = decode(raw);
    this.sent.push(message);
    if (message.type === 'init') queueMicrotask(() => this.deliver(message.generation, message.requestId,
      'initialize', 'ready', {...RUNTIME_INFO}));
  }
  deliver(generation, requestId, op, type, payload) {
    this.onmessage?.({data: encode(generation, requestId, op, type, payload), ports: []});
  }
  terminate() { this.terminated = true; }
}

test('generation replacement ignores former Worker callbacks and retired messages', async () => {
  const realWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    assert.equal(engine.getState(), 'created');
    await engine.initialize();
    const old = FakeWorker.instances[0];
    const pending = engine.run({source: 'while (true) {}'});
    const first = old.sent.at(-1);
    const staleHandler = old.onmessage;
    const staleError = old.onerror;
    const staleMessageError = old.onmessageerror;
    const readiness = engine.cancel();
    assert.equal(old.terminated, true);
    assert.equal((await pending).error.code, 'CANCELLED');
    await readiness;
    assert.equal(engine.getState(), 'ready');
    const current = FakeWorker.instances[1];
    const next = engine.run({source: 'console.log("next")'});
    const second = current.sent.at(-1);
    staleHandler({data: encode(first.generation, first.requestId, 'run', 'result',
      {status: 'ok', error: null, truncated: false, lastSequence: 0, stdoutChars: 0, stderrChars: 0}), ports: []});
    staleHandler({data: encode(first.generation, first.requestId, 'run', 'stream',
      {sequence: 1, channel: 'stdout', text: 'stale'}), ports: []});
    staleHandler({data: encode(first.generation, first.requestId, 'run', 'fatal',
      {code: 'RUNTIME_FAILURE'}), ports: []});
    const oldBoot = old.sent[0];
    staleHandler({data: encode(oldBoot.generation, oldBoot.requestId, 'initialize', 'ready',
      {...RUNTIME_INFO}), ports: []});
    staleError({preventDefault() {}});
    staleMessageError({});
    assert.equal(engine.getState(), 'busy');
    current.deliver(second.generation, second.requestId, 'run', 'stream',
      {sequence: 1, channel: 'stdout', text: 'next\n'});
    current.deliver(second.generation, second.requestId, 'run', 'result',
      {status: 'ok', error: null, truncated: false, lastSequence: 1, stdoutChars: 5, stderrChars: 0});
    assert.equal((await next).stdout, 'next\n');
    current.deliver(second.generation, second.requestId, 'run', 'result',
      {status: 'ok', error: null, truncated: false, lastSequence: 1, stdoutChars: 5, stderrChars: 0});
    assert.equal(engine.getState(), 'ready');
    engine.dispose();
    assert.equal(current.terminated, true);
  } finally { globalThis.Worker = realWorker; }
});

test('future request identity is a protocol fault rather than a new operation', async () => {
  const realWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const worker = FakeWorker.instances[0];
    const pending = engine.run({source: '1'});
    const message = worker.sent.at(-1);
    worker.deliver(message.generation, message.requestId + 1, 'run', 'result',
      {status: 'ok', error: null, truncated: false, lastSequence: 0, stdoutChars: 0, stderrChars: 0});
    assert.equal((await pending).error.code, 'PROTOCOL_ERROR');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('future generation is a protocol fault even with an older request ID', async () => {
  const realWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const worker = FakeWorker.instances[0];
    const pending = engine.run({source: '1'});
    const current = worker.sent.at(-1);
    worker.deliver(current.generation + 1, current.requestId - 1, 'run', 'result',
      {status: 'ok', error: null, truncated: false, lastSequence: 0, stdoutChars: 0, stderrChars: 0});
    assert.equal((await pending).error.code, 'PROTOCOL_ERROR');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('retired execution timeout cannot abort a replacement run', async () => {
  const realWorker = globalThis.Worker;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.Worker = FakeWorker;
  globalThis.setTimeout = fn => { timers.push(fn); return timers.length; };
  globalThis.clearTimeout = () => {};
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const first = engine.run({source: 'for (;;) {}'});
    const staleTimer = timers.at(-1);
    await engine.cancel();
    assert.equal((await first).error.code, 'CANCELLED');
    const replacement = FakeWorker.instances.at(-1);
    const second = engine.run({source: '2'});
    const identity = replacement.sent.at(-1);
    staleTimer();
    assert.equal(engine.getState(), 'busy');
    replacement.deliver(identity.generation, identity.requestId, 'run', 'result',
      {status: 'ok', error: null, truncated: false, lastSequence: 0, stdoutChars: 0, stderrChars: 0});
    assert.equal((await second).status, 'ok');
    engine.dispose();
  } finally {
    globalThis.Worker = realWorker;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('malformed current response fails run and recovers once', async () => {
  const realWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const worker = FakeWorker.instances[0];
    const pending = engine.run({source: '1'});
    const message = worker.sent.at(-1);
    worker.deliver(message.generation, message.requestId, 'run', 'stream',
      {sequence: 2, channel: 'stdout', text: 'wrong'});
    assert.equal((await pending).error.code, 'PROTOCOL_ERROR');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    assert.equal(FakeWorker.instances.length, 2);
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('malformed Worker envelopes fail safely and a fresh Worker can execute', async () => {
  const realWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const malformed = [null, undefined, 1, [], '{}', 'x'.repeat(210001),
      JSON.stringify({protocolVersion: 1, generation: 1, requestId: 2, op: 'run', payload: {}}),
      encode(1, 2, 'run', 'unknown', {}),
      encode(1, 2, 'run', 'result', null)];
    for (const raw of malformed) {
      FakeWorker.instances = [];
      const engine = new EngineController(new URL('file:///fake-worker.js'));
      await engine.initialize();
      const worker = FakeWorker.instances[0];
      const pending = engine.run({source: '1'});
      worker.onmessage({data: raw, ports: []});
      assert.equal((await pending).error.code, 'PROTOCOL_ERROR');
      await engine.initialize();
      assert.equal(engine.getState(), 'ready');
      assert.equal(FakeWorker.instances.length, 2);
      engine.dispose();
    }
  } finally { globalThis.Worker = realWorker; }
});

test('initialization, recovery, and message decode failures have distinct outcomes', async () => {
  const realWorker = globalThis.Worker;
  let bootCount = 0;
  class FailingWorker extends FakeWorker {
    postMessage(raw) {
      const message = decode(raw);
      if (message.type === 'init' && ++bootCount <= 2)
        queueMicrotask(() => this.onerror?.({preventDefault() {}}));
      else super.postMessage(raw);
    }
  }
  globalThis.Worker = FailingWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await assert.rejects(engine.initialize(), {code: 'INITIALIZATION_FAILED'});
    assert.equal(engine.getState(), 'failed');
    await assert.rejects(engine.reset(), {code: 'INITIALIZATION_FAILED'});
    await engine.initialize();
    const worker = FakeWorker.instances.at(-1);
    const pending = engine.run({source: 'for (;;) {}'});
    worker.onmessageerror?.({});
    assert.equal((await pending).error.code, 'WORKER_FAILURE');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('recovery boot failure leaves failed state and explicit initialize retries', async () => {
  const realWorker = globalThis.Worker;
  let bootCount = 0;
  class RecoveryFailWorker extends FakeWorker {
    postMessage(raw) {
      const message = decode(raw);
      if (message.type === 'init' && ++bootCount === 2)
        queueMicrotask(() => this.onerror?.({preventDefault() {}}));
      else super.postMessage(raw);
    }
  }
  globalThis.Worker = RecoveryFailWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const pending = engine.run({source: 'for (;;) {}'});
    await assert.rejects(engine.cancel(), {code: 'RECOVERY_FAILED'});
    assert.equal((await pending).error.code, 'CANCELLED');
    assert.equal(engine.getState(), 'failed');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('Worker construction and run post failures have bounded retry/recovery paths', async () => {
  const realWorker = globalThis.Worker;
  let constructions = 0;
  let failedRunPost = false;
  class TransportFailWorker extends FakeWorker {
    constructor() {
      if (++constructions === 1) throw Error('construction failed');
      super();
    }
    postMessage(raw) {
      const message = decode(raw);
      if (message.type === 'run' && !failedRunPost) {
        failedRunPost = true;
        throw Error('post failed');
      }
      super.postMessage(raw);
    }
  }
  globalThis.Worker = TransportFailWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await assert.rejects(engine.initialize(), {code: 'INITIALIZATION_FAILED'});
    assert.equal(engine.getState(), 'failed');
    await engine.initialize();
    const failed = await engine.run({source: '1'});
    assert.equal(failed.error.code, 'WORKER_FAILURE');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    assert.equal(FakeWorker.instances.length, 2);
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('malformed program error and runtime fatal remain engine failures', async () => {
  const realWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const firstWorker = FakeWorker.instances.at(-1);
    const first = engine.run({source: 'throw Error("x")'});
    const firstId = firstWorker.sent.at(-1);
    firstWorker.deliver(firstId.generation, firstId.requestId, 'run', 'result',
      {status: 'program-error', error: {kind: 'program', name: 'Error', message: 'x',
        stack: null}, truncated: false, lastSequence: 0, stdoutChars: 0, stderrChars: 0});
    assert.equal((await first).error.code, 'PROTOCOL_ERROR');
    await engine.initialize();
    const secondWorker = FakeWorker.instances.at(-1);
    const second = engine.run({source: '1'});
    const secondId = secondWorker.sent.at(-1);
    secondWorker.deliver(secondId.generation, secondId.requestId, 'run', 'fatal',
      {code: 'RUNTIME_FAILURE'});
    assert.equal((await second).error.code, 'RUNTIME_FAILURE');
    await engine.initialize();
    assert.equal(engine.getState(), 'ready');
    engine.dispose();
  } finally { globalThis.Worker = realWorker; }
});

test('dispose stays terminal if the Worker termination API throws', async () => {
  const realWorker = globalThis.Worker;
  class TerminationFailWorker extends FakeWorker {
    terminate() { this.terminated = true; throw Error('browser termination failure'); }
  }
  globalThis.Worker = TerminationFailWorker;
  FakeWorker.instances = [];
  try {
    const engine = new EngineController(new URL('file:///fake-worker.js'));
    await engine.initialize();
    const worker = FakeWorker.instances[0];
    const formerHandler = worker.onmessage;
    engine.dispose();
    assert.equal(engine.getState(), 'disposed');
    assert.equal(worker.onmessage, null);
    formerHandler({data: null, ports: []});
    assert.equal(engine.getState(), 'disposed');
  } finally { globalThis.Worker = realWorker; }
});
