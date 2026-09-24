import {LIMITS, POLICY_VERSION} from '../limits/policy.js';
import {exactKeys, validFilename} from '../security/validate.js';

export const PROTOCOL_VERSION = 1;
export const RUNTIME_INFO = Object.freeze({runtimeName: 'QuickJS', runtimeVersion: '2025-09-13',
  bindingVersion: '0.32.0', variant: 'wasmfile-release-sync', executionProfile: 'script-sync-v1', policyVersion: POLICY_VERSION});
export const positiveId = n => Number.isSafeInteger(n) && n > 0;
export const nonnegative = n => Number.isSafeInteger(n) && n >= 0;

export function encode(generation, requestId, op, type, payload) {
  const message = JSON.stringify({protocolVersion: PROTOCOL_VERSION, generation, requestId, op, type, payload});
  if (message.length > LIMITS.messageChars) throw new Error('message limit');
  return message;
}

export function decode(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.messageChars) return null;
  try {
    const message = JSON.parse(raw);
    if (!exactKeys(message, ['protocolVersion', 'generation', 'requestId', 'op', 'type', 'payload']) ||
        message.protocolVersion !== PROTOCOL_VERSION || !positiveId(message.generation) ||
        !positiveId(message.requestId)) return null;
    return message;
  } catch { return null; }
}

export function validLimits(value) {
  return exactKeys(value, Object.keys(LIMITS)) && Object.keys(LIMITS).every(key => value[key] === LIMITS[key]);
}

export function validReady(payload) {
  return exactKeys(payload, Object.keys(RUNTIME_INFO)) &&
    Object.keys(RUNTIME_INFO).every(key => typeof payload[key] === 'string' &&
      payload[key].length <= LIMITS.runtimeInfoChars && payload[key] === RUNTIME_INFO[key]);
}

export function validRun(payload) {
  return exactKeys(payload, ['source', 'filename', 'executionBudgetMs']) &&
    typeof payload.source === 'string' && payload.source.length <= LIMITS.sourceChars &&
    !payload.source.includes('\0') && validFilename(payload.filename) &&
    payload.filename.length <= LIMITS.filenameChars && positiveId(payload.executionBudgetMs) &&
    payload.executionBudgetMs <= LIMITS.maxExecutionTimeoutMs;
}

export function validStream(payload) {
  return exactKeys(payload, ['sequence', 'channel', 'text']) && positiveId(payload.sequence) &&
    ['stdout', 'stderr'].includes(payload.channel) && typeof payload.text === 'string' &&
    payload.text.length > 0 && payload.text.length <= LIMITS.streamChunkChars;
}

export function validResult(payload, filename) {
  if (!exactKeys(payload, ['status', 'error', 'truncated', 'lastSequence', 'stdoutChars', 'stderrChars']) ||
      !['ok', 'program-error', 'engine-error'].includes(payload.status) ||
      typeof payload.truncated !== 'boolean' || !nonnegative(payload.lastSequence) ||
      !nonnegative(payload.stdoutChars) || !nonnegative(payload.stderrChars)) return false;
  if (payload.status === 'ok') return payload.error === null;
  if (payload.status === 'engine-error') return exactKeys(payload.error, ['kind', 'code']) &&
    payload.error.kind === 'engine' && ['EXECUTION_TIMEOUT', 'RESOURCE_LIMIT', 'RUNTIME_FAILURE'].includes(payload.error.code);
  const e = payload.error;
  return exactKeys(e, ['kind', 'name', 'message', 'stack', 'filename']) && e.kind === 'program' &&
    typeof e.name === 'string' && e.name.length <= LIMITS.errorNameChars &&
    typeof e.message === 'string' && e.message.length <= LIMITS.errorMessageChars &&
    (e.stack === null || typeof e.stack === 'string' && e.stack.length <= LIMITS.errorStackChars) &&
    e.filename === filename;
}
