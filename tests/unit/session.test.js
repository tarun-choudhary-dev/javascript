import test from 'node:test';
import assert from 'node:assert/strict';
import {withQuickJSContext} from '../../src/runtime/session.js';
import {LIMITS} from '../../src/limits/policy.js';

function fakeModule(events, failAt) {
  return {newRuntime() {
    events.push('newRuntime');
    if (failAt === 'newRuntime') throw Error('runtime allocation failed');
    return {
      setMemoryLimit(value) { events.push(['heap', value]); },
      setMaxStackSize(value) { events.push(['stack', value]); },
      newContext() {
        events.push('newContext');
        if (failAt === 'newContext') throw Error('context allocation failed');
        return {dispose() {
          events.push('disposeContext');
          if (failAt === 'disposeContext') throw Error('context cleanup failed');
        }};
      },
      dispose() { events.push('disposeRuntime'); },
    };
  }};
}

test('runtime/session ownership applies limits and disposes in reverse order', () => {
  const events = [];
  const value = withQuickJSContext(fakeModule(events), runtime => {
    assert.ok(runtime);
    events.push('configure');
  }, context => { assert.ok(context); events.push('execute'); return 42; });
  assert.equal(value, 42);
  assert.deepEqual(events, ['newRuntime', ['heap', LIMITS.guestHeapBytes],
    ['stack', LIMITS.guestStackBytes], 'configure', 'newContext', 'execute',
    'disposeContext', 'disposeRuntime']);
});

test('runtime creation, configuration, context, execution, and cleanup failures release what exists', () => {
  for (const failure of ['newRuntime', 'configure', 'newContext', 'execute', 'disposeContext']) {
    const events = [];
    const module = fakeModule(events, failure);
    assert.throws(() => withQuickJSContext(module, () => {
      events.push('configure');
      if (failure === 'configure') throw Error('configure failed');
    }, () => {
      events.push('execute');
      if (failure === 'execute') throw Error('execution failed');
    }));
    assert.equal(events.includes('disposeRuntime'), failure !== 'newRuntime');
    assert.equal(events.includes('disposeContext'), ['execute', 'disposeContext'].includes(failure));
  }
});
