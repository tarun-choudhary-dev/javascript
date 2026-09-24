import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRequest} from '../../src/security/validate.js';
import {LIMITS} from '../../src/limits/policy.js';
import {decode, encode, validResult, validStream} from '../../src/execution/protocol.js';

test('request validation at source and filename boundaries', () => {
  for (const length of [LIMITS.sourceChars - 1, LIMITS.sourceChars])
    assert.equal(validateRequest({source: 'x'.repeat(length)}).source.length, length);
  assert.throws(() => validateRequest({source: 'x'.repeat(LIMITS.sourceChars + 1)}), {code: 'INPUT_LIMIT'});
  for (const length of [LIMITS.filenameChars - 1, LIMITS.filenameChars])
    assert.equal(validateRequest({source: '', filename: 'x'.repeat(length)}).filename.length, length);
  assert.throws(() => validateRequest({source: '', filename: 'x'.repeat(LIMITS.filenameChars + 1)}), {code: 'INPUT_LIMIT'});
  for (const value of [null, [], {source: 7}, {source: 'a\0b'}, {source: '', timeoutMs: 0},
    {source: '', timeoutMs: Infinity}, {source: '', timeoutMs: 1.2},
    {source: '', extra: true}, {source: '', filename: undefined}, {source: '', timeoutMs: undefined},
    Object.defineProperty({source: ''}, 'hidden', {value: true}),
    Object.assign({source: ''}, {[Symbol('hidden')]: true}),
    Object.defineProperty({}, 'source', {get() { throw Error('getter'); }, enumerable: true})]) {
    assert.throws(() => validateRequest(value), {code: 'INVALID_REQUEST'});
  }
});

test('wire grammar rejects malformed and contradictory records', () => {
  const encoded = encode(1, 2, 'run', 'stream', {sequence: 1, channel: 'stdout', text: 'x'});
  assert.equal(decode(encoded).requestId, 2);
  assert.equal(decode('{'), null);
  assert.equal(decode('x'.repeat(LIMITS.messageChars + 1)), null);
  assert.equal(decode(JSON.stringify({...JSON.parse(encoded), requestId: 0})), null);
  assert.equal(validStream({sequence: 1, channel: 'stdout', text: ''}), false);
  assert.equal(validResult({status: 'ok', error: {kind: 'engine', code: 'CANCELLED'}, truncated: false,
    lastSequence: 0, stdoutChars: 0, stderrChars: 0}, 'input.js'), false);
  const accessor = Object.defineProperty({}, 'sequence', {get: undefined, enumerable: true});
  Object.assign(accessor, {channel: 'stdout', text: 'x'});
  assert.equal(validStream(accessor), false);
});
