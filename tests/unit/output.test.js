import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutputCollector, safePrefix} from '../../src/runtime/output.js';

const wellFormed = value => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (++index >= value.length) return false;
      const low = value.charCodeAt(index);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

test('bounded prefixes and every streamed chunk preserve valid UTF-16', () => {
  let seed = 17;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  const tokens = ['a', 'é', '漢', '😀', 'e\u0301'];
  for (let iteration = 0; iteration < 200; iteration++) {
    let value = '';
    for (let index = 0; index < 20; index++) value += tokens[next() % tokens.length];
    const cap = 2 + next() % 24;
    const chunks = [];
    const limits = {stdoutChars: cap, stderrChars: cap, combinedOutputChars: cap,
      streamChunkChars: 2 + next() % 6, streamMessageCount: 50, consoleCallCount: 3};
    const output = createOutputCollector(chunk => chunks.push(chunk), limits);
    output.append('stdout', value);
    const result = chunks.map(chunk => chunk.text).join('');
    assert.ok(wellFormed(value));
    assert.ok(wellFormed(safePrefix(value, cap)));
    assert.ok(chunks.every(chunk => wellFormed(chunk.text) && chunk.text.length <= limits.streamChunkChars));
    assert.ok(wellFormed(result));
    assert.equal(result, safePrefix(value, cap));
    assert.deepEqual(chunks.map(chunk => chunk.sequence), chunks.map((_, index) => index + 1));
    assert.equal(output.summary().stdoutChars, result.length);
    assert.equal(output.summary().truncated, value.length > cap);
  }
});

test('combined channel and console-call quotas have one accounting owner', () => {
  const chunks = [];
  const output = createOutputCollector(chunk => chunks.push(chunk), {stdoutChars: 8, stderrChars: 8,
    combinedOutputChars: 8, streamChunkChars: 3, streamMessageCount: 8, consoleCallCount: 2});
  assert.equal(output.noteConsoleCall(), true);
  output.append('stdout', 'abcd');
  assert.equal(output.noteConsoleCall(), true);
  output.append('stderr', '漢😀zz');
  assert.equal(chunks.filter(chunk => chunk.channel === 'stderr').map(chunk => chunk.text).join(''), '漢😀z');
  assert.deepEqual(output.summary(), {truncated: true, lastSequence: 4, stdoutChars: 4, stderrChars: 4});
  assert.equal(output.noteConsoleCall(), false);
  assert.equal(output.quotaReached, true);
});
