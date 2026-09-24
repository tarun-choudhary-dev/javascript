import {LIMITS, POLICY_VERSION} from '../limits/policy.js';
import {encode, decode, validLimits, validRun, RUNTIME_INFO} from '../execution/protocol.js';
import {exactKeys} from '../security/validate.js';
import {initializeQuickJS, executeScript} from './quickjs.js';

let phase = 'created';
let generation = 0;
let lastRequestId = 0;

function send(requestId, op, type, payload) {
  self.postMessage(encode(generation, requestId, op, type, payload));
}

self.onmessage = async event => {
  const message = decode(event.data);
  if (!message) return;
  const {requestId, op, type, payload} = message;
  if (phase === 'created') {
    if (op !== 'initialize' || type !== 'init' || !exactKeys(payload, ['policyVersion', 'limits']) ||
        payload.policyVersion !== POLICY_VERSION || !validLimits(payload.limits)) return;
    generation = message.generation;
    lastRequestId = requestId;
    phase = 'initializing';
    try {
      await initializeQuickJS();
      phase = 'ready';
      send(requestId, 'initialize', 'ready', {...RUNTIME_INFO});
    } catch {
      phase = 'failed';
      send(requestId, 'initialize', 'fatal', {code: 'INITIALIZATION_FAILED'});
    }
    return;
  }
  if (phase !== 'ready' || message.generation !== generation || requestId <= lastRequestId ||
      op !== 'run' || type !== 'run' || !validRun(payload)) {
    if (phase === 'ready' && message.generation === generation && requestId > lastRequestId)
      send(requestId, 'run', 'fatal', {code: 'PROTOCOL_ERROR'});
    return;
  }
  lastRequestId = requestId;
  phase = 'busy';
  try {
    const result = executeScript(payload, chunk => send(requestId, 'run', 'stream', chunk));
    phase = result.status === 'engine-error' ? 'failed' : 'ready';
    send(requestId, 'run', 'result', result);
  } catch {
    phase = 'failed';
    send(requestId, 'run', 'fatal', {code: 'RUNTIME_FAILURE'});
  }
};
