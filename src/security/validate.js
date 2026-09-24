import {EngineError} from '../api/errors.js';
import {LIMITS} from '../limits/policy.js';

export const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined &&
      Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
}

export function validFilename(filename) {
  return typeof filename === 'string' && filename.length > 0 &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(filename);
}

export function validateRequest(request) {
  if (!isRecord(request) || Object.keys(request).some(key => !['source', 'filename', 'timeoutMs'].includes(key)) ||
      !Object.hasOwn(request, 'source') ||
      Object.keys(request).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptors(request), key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key), 'value'))) throw new EngineError('INVALID_REQUEST');
  const source = request.source;
  const filename = Object.hasOwn(request, 'filename') ? request.filename : 'input.js';
  const timeoutMs = Object.hasOwn(request, 'timeoutMs') ? request.timeoutMs : LIMITS.defaultExecutionTimeoutMs;
  if (typeof source !== 'string' || typeof filename !== 'string')
    throw new EngineError('INVALID_REQUEST');
  if (source.length > LIMITS.sourceChars || filename.length > LIMITS.filenameChars)
    throw new EngineError('INPUT_LIMIT');
  if (source.includes('\0') || !validFilename(filename) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > LIMITS.maxExecutionTimeoutMs)
    throw new EngineError('INVALID_REQUEST');
  return {source, filename, timeoutMs};
}
