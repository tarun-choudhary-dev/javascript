import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {newQuickJSWASMModuleFromVariant, newVariant} from 'quickjs-emscripten-core';
import {LIMITS} from '../limits/policy.js';

let moduleInstance;

export async function initializeQuickJS() {
  const variant = newVariant(RELEASE_SYNC, {
    wasmLocation: new URL('./emscripten-module.wasm', import.meta.url).href,
  });
  moduleInstance = await newQuickJSWASMModuleFromVariant(variant);
  // Verify a real interpreter can create, evaluate and dispose a context.
  const runtime = moduleInstance.newRuntime();
  try {
    runtime.setMemoryLimit(LIMITS.guestHeapBytes);
    runtime.setMaxStackSize(LIMITS.guestStackBytes);
    const context = runtime.newContext();
    try {
      const answer = context.evalCode('1 + 1', 'self-check.js', {type: 'global'});
      if (answer.error) { answer.error.dispose(); throw new Error('runtime self-check failed'); }
      try { if (context.getNumber(answer.value) !== 2) throw new Error('runtime self-check failed'); }
      finally { answer.value.dispose(); }
    } finally { context.dispose(); }
  } finally { runtime.dispose(); }
}

const safePrefix = (value, cap) => {
  if (value.length <= cap) return value;
  if (cap > 0 && /[\uD800-\uDBFF]/u.test(value[cap - 1])) cap--;
  return value.slice(0, cap);
};

export function executeScript({source, filename, executionBudgetMs}, stream) {
  if (!moduleInstance) throw new Error('runtime unavailable');
  const started = performance.now();
  const deadline = started + executionBudgetMs;
  const runtime = moduleInstance.newRuntime();
  let context;
  let sliceFunction;
  let objectIs;
  let truncation = false;
  let callCount = 0;
  let sequence = 0;
  let stdoutChars = 0;
  let stderrChars = 0;
  let quotaReached = false;
  let interrupted = false;
  let outcome;

  const dispose = handle => { if (handle?.alive) handle.dispose(); };
  const textOf = (handle, cap) => {
    if (context.typeof(handle) !== 'string') return null;
    const lengthHandle = context.getProp(handle, 'length');
    let length;
    try { length = context.getNumber(lengthHandle); } finally { dispose(lengthHandle); }
    if (length > cap) {
      truncation = true;
      const zero = context.newNumber(0);
      const end = context.newNumber(cap);
      let result;
      try { result = context.callFunction(sliceFunction, handle, zero, end); }
      finally { dispose(zero); dispose(end); }
      if (result.error) { dispose(result.error); throw new Error('bounded slice failed'); }
      try { return safePrefix(context.getString(result.value), cap); }
      finally { dispose(result.value); }
    }
    return context.getString(handle);
  };
  const primitiveText = (handle, cap) => {
    const kind = context.typeof(handle);
    if (kind === 'string') return textOf(handle, cap);
    if (kind === 'number') return String(context.getNumber(handle));
    if (kind === 'boolean') return context.getNumber(handle) ? 'true' : 'false';
    if (kind === 'undefined') return 'undefined';
    if (kind === 'function') return '[function]';
    if (kind === 'symbol') return '[symbol]';
    if (kind === 'bigint') return '[bigint]';
    if (kind === 'object') {
      const same = context.callFunction(objectIs, context.undefined, handle, context.null);
      if (same.error) { dispose(same.error); throw new Error('null comparison failed'); }
      try { if (context.getNumber(same.value)) return 'null'; }
      finally { dispose(same.value); }
    }
    return '[object]';
  };
  const append = (channel, value) => {
    const channelCount = channel === 'stdout' ? stdoutChars : stderrChars;
    const remaining = Math.min(LIMITS[`${channel}Chars`] - channelCount,
      LIMITS.combinedOutputChars - stdoutChars - stderrChars);
    if (remaining <= 0) { truncation = true; return; }
    if (value.length > remaining) { value = safePrefix(value, remaining); truncation = true; }
    for (let index = 0; index < value.length; index += LIMITS.streamChunkChars) {
      if (sequence >= LIMITS.streamMessageCount) { quotaReached = true; return; }
      const chunk = value.slice(index, index + LIMITS.streamChunkChars);
      sequence++;
      if (channel === 'stdout') stdoutChars += chunk.length;
      else stderrChars += chunk.length;
      stream({sequence, channel, text: chunk});
    }
  };
  const consoleCall = channel => (...args) => {
    if (++callCount > LIMITS.consoleCallCount) { quotaReached = true; throw new Error('console call quota'); }
    const count = Math.min(args.length, LIMITS.consoleArgumentCount);
    if (args.length > count) truncation = true;
    const parts = [];
    for (let index = 0; index < count; index++) parts.push(primitiveText(args[index], LIMITS.streamChunkChars));
    append(channel, parts.join(' ') + '\n');
    return context.undefined;
  };

  try {
    runtime.setMemoryLimit(LIMITS.guestHeapBytes);
    runtime.setMaxStackSize(LIMITS.guestStackBytes);
    runtime.setInterruptHandler(() => {
      if (performance.now() >= deadline) { interrupted = true; return true; }
      return false;
    });
    context = runtime.newContext();
    const stringConstructor = context.getProp(context.global, 'String');
    const stringPrototype = context.getProp(stringConstructor, 'prototype');
    sliceFunction = context.getProp(stringPrototype, 'slice');
    dispose(stringPrototype); dispose(stringConstructor);
    const objectConstructor = context.getProp(context.global, 'Object');
    objectIs = context.getProp(objectConstructor, 'is');
    dispose(objectConstructor);
    const consoleObject = context.newObject();
    try {
      for (const [method, channel] of [['log', 'stdout'], ['info', 'stdout'],
        ['debug', 'stdout'], ['warn', 'stderr'], ['error', 'stderr']]) {
        const fn = context.newFunction(method, consoleCall(channel));
        try { context.setProp(consoleObject, method, fn); } finally { dispose(fn); }
      }
      context.setProp(context.global, 'console', consoleObject);
    } finally { dispose(consoleObject); }

    const evaluated = context.evalCode(source, filename, {type: 'global'});
    if (evaluated.error) {
      try {
        if (interrupted) outcome = {status: 'engine-error', error: {kind: 'engine', code: 'EXECUTION_TIMEOUT'}};
        else if (quotaReached) outcome = {status: 'engine-error', error: {kind: 'engine', code: 'RESOURCE_LIMIT'}};
        else {
          const error = evaluated.error;
          let name = 'ThrownValue', message = '', stack = null;
          if (context.typeof(error) === 'object') {
            for (const [key, cap] of [['name', LIMITS.errorNameChars],
              ['message', LIMITS.errorMessageChars], ['stack', LIMITS.errorStackChars]]) {
              const property = context.getProp(error, key);
              try {
                const text = textOf(property, cap);
                if (text !== null) {
                  if (key === 'name') name = text;
                  if (key === 'message') message = text;
                  if (key === 'stack') stack = text;
                }
              } finally { dispose(property); }
            }
          } else message = safePrefix(primitiveText(error, LIMITS.errorMessageChars), LIMITS.errorMessageChars);
          outcome = name === 'InternalError' ?
            {status: 'engine-error', error: {kind: 'engine', code: 'RUNTIME_FAILURE'}} :
            {status: 'program-error', error: {kind: 'program', name, message, stack, filename}};
        }
      } finally { dispose(evaluated.error); }
    } else {
      dispose(evaluated.value);
      outcome = quotaReached ? {status: 'engine-error', error: {kind: 'engine', code: 'RESOURCE_LIMIT'}} :
        {status: 'ok', error: null};
    }
  } finally {
    dispose(sliceFunction);
    dispose(objectIs);
    if (context) context.dispose();
    runtime.dispose();
  }
  return {...outcome, truncated: truncation, lastSequence: sequence, stdoutChars, stderrChars};
}
