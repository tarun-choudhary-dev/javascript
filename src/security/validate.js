import {EngineError} from '../api/errors.js';
import {LIMITS} from '../limits/policy.js';

export const isRecord = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every(key =>
    Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

export function validFilename(filename) {
  return typeof filename === 'string' && filename.length > 0 &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(filename);
}

export function validateRequest(request) {
  if (!isRecord(request)) throw new EngineError('INVALID_REQUEST');
  const descriptors = Object.getOwnPropertyDescriptors(request);
  const fields = Reflect.ownKeys(descriptors);
  if (!Object.hasOwn(descriptors, 'source') || fields.some(key =>
    typeof key !== 'string' || !['source', 'filename', 'timeoutMs'].includes(key) ||
    !Object.hasOwn(descriptors[key], 'value'))) throw new EngineError('INVALID_REQUEST');
  const source = descriptors.source.value;
  const filename = Object.hasOwn(descriptors, 'filename') ? descriptors.filename.value : 'input.js';
  const timeoutMs = Object.hasOwn(descriptors, 'timeoutMs') ? descriptors.timeoutMs.value : LIMITS.defaultExecutionTimeoutMs;
  if (typeof source !== 'string' || typeof filename !== 'string')
    throw new EngineError('INVALID_REQUEST');
  if (source.length > LIMITS.sourceChars || filename.length > LIMITS.filenameChars)
    throw new EngineError('INPUT_LIMIT');
  if (source.includes('\0') || !validFilename(filename) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > LIMITS.maxExecutionTimeoutMs)
    throw new EngineError('INVALID_REQUEST');
  return Object.freeze({source, filename, timeoutMs});
}
