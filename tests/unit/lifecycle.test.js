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
