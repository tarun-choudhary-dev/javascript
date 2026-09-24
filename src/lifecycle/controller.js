import {LIMITS} from '../limits/policy.js';
import {EngineError, engineResult} from '../api/errors.js';
import {validateRequest} from '../security/validate.js';
import {encode, decode, validReady, validStream, validResult, RUNTIME_INFO} from '../execution/protocol.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const now = () => performance.now();

export class EngineController {
  #state = 'created';
  #worker = null;
  #generation = 0;
  #requestId = 0;
  #boot = null;
  #run = null;
  #workerUrl;

  constructor(workerUrl) { this.#workerUrl = workerUrl; }
  getState() { return this.#state; }
  isReady() { return this.#state === 'ready'; }
  isBusy() { return this.#state === 'busy'; }
  getRuntimeInfo() {
    return Object.freeze({engineVersion: '0.1.0', ...RUNTIME_INFO,
      initialized: this.#state === 'ready' || this.#state === 'busy',
      capabilities: Object.freeze({script: true, boundedConsole: true, dom: false, network: false,
        storage: false, modules: false, asyncJobs: false, persistentState: false, analysis: false}),
      limits: Object.freeze({...LIMITS})});
  }

  #nextId() {
    if (this.#requestId >= Number.MAX_SAFE_INTEGER - 1 || this.#generation >= Number.MAX_SAFE_INTEGER - 1)
      throw new EngineError('RUNTIME_FAILURE');
    return ++this.#requestId;
  }
  #revoke() {
    const worker = this.#worker;
    this.#worker = null;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      try { worker.terminate(); } catch { /* disposal is terminal even on browser error */ }
    }
  }

  #startBoot(recovery) {
    this.#state = recovery ? 'recovering' : 'initializing';
    const d = deferred();
    let requestId;
    try { requestId = this.#nextId(); }
    catch (error) { this.#state = 'failed'; d.reject(error); d.promise.catch(() => {}); return d.promise; }
    const generation = ++this.#generation;
    const boot = {d, generation, requestId, recovery, timer: null,
      deadline: now() + (recovery ? LIMITS.recoveryTimeoutMs : LIMITS.initializationTimeoutMs)};
    this.#boot = boot;
    const timeout = recovery ? LIMITS.recoveryTimeoutMs : LIMITS.initializationTimeoutMs;
    boot.timer = setTimeout(() => this.#bootFailure(boot, recovery ? 'RECOVERY_TIMEOUT' : 'INITIALIZATION_TIMEOUT'), timeout);
    try {
      if (typeof Worker !== 'function' || typeof WebAssembly !== 'object') throw new EngineError('UNSUPPORTED_ENVIRONMENT');
      const worker = new Worker(this.#workerUrl, {type: 'module'});
      this.#worker = worker;
      worker.onmessage = event => this.#onMessage(worker, generation, event);
      worker.onerror = event => { event.preventDefault?.(); this.#onWorkerFailure(worker, generation); };
      worker.onmessageerror = () => this.#onWorkerFailure(worker, generation);
      worker.postMessage(encode(generation, requestId, 'initialize', 'init',
        {policyVersion: RUNTIME_INFO.policyVersion, limits: {...LIMITS}}));
    } catch (error) {
      this.#bootFailure(boot, error instanceof EngineError ? error.code :
        recovery ? 'RECOVERY_FAILED' : 'INITIALIZATION_FAILED');
    }
    // A background recovery may have no awaiter; keep its rejection observed.
    d.promise.catch(() => {});
    return d.promise;
  }

  #bootFailure(boot, code) {
    if (this.#boot !== boot || this.#state === 'disposed') return;
    clearTimeout(boot.timer);
    this.#boot = null;
    this.#revoke();
    this.#state = 'failed';
    boot.d.reject(new EngineError(code));
  }

  async initialize() {
    if (this.#state === 'disposed') throw new EngineError('DISPOSED');
    if (this.#state === 'ready' || this.#state === 'busy') return;
    if (this.#boot) return this.#boot.d.promise;
    return this.#startBoot(false);
  }

  run(request) {
    if (this.#state === 'disposed') return Promise.reject(new EngineError('DISPOSED'));
    let validated;
    try { validated = validateRequest(request); } catch (error) { return Promise.reject(error); }
    if (this.#state === 'busy') return Promise.reject(new EngineError('BUSY'));
    if (this.#state !== 'ready') return Promise.reject(new EngineError('NOT_READY'));
    let requestId;
    try { requestId = this.#nextId(); } catch (error) { return Promise.reject(error); }
    const d = deferred();
    const run = {d, requestId, generation: this.#generation, started: now(),
      deadline: 0, timer: null, filename: validated.filename, timeoutMs: validated.timeoutMs,
      stdout: '', stderr: '', sequence: 0, truncated: false};
    run.deadline = run.started + validated.timeoutMs;
    this.#run = run;
    this.#state = 'busy';
    run.timer = setTimeout(() => this.#failRun(run, 'EXECUTION_TIMEOUT'), validated.timeoutMs);
    try {
      this.#worker.postMessage(encode(run.generation, requestId, 'run', 'run',
        {source: validated.source, filename: validated.filename, executionBudgetMs: validated.timeoutMs}));
    } catch { this.#failRun(run, 'WORKER_FAILURE'); }
    return d.promise;
  }

  #settleRun(run, result) {
    if (this.#run !== run) return;
    clearTimeout(run.timer);
    this.#run = null;
    run.d.resolve(result);
  }
  #failRun(run, code) {
    if (this.#run !== run || this.#state === 'disposed') return;
    const result = engineResult(code, run.stdout, run.stderr, Math.max(0, now() - run.started), run.truncated);
    this.#revoke();
    this.#settleRun(run, result);
    return this.#startBoot(true);
  }

  #onWorkerFailure(worker, generation) {
    if (worker !== this.#worker || generation !== this.#generation || this.#state === 'disposed') return;
    if (this.#boot) return this.#bootFailure(this.#boot,
      this.#boot.recovery ? 'RECOVERY_FAILED' : 'INITIALIZATION_FAILED');
    if (this.#run) return this.#failRun(this.#run, 'WORKER_FAILURE');
    this.#revoke();
    this.#startBoot(true);
  }

  #protocolFailure() {
    if (this.#boot) return this.#bootFailure(this.#boot,
      this.#boot.recovery ? 'RECOVERY_FAILED' : 'INITIALIZATION_FAILED');
    if (this.#run) return this.#failRun(this.#run, 'PROTOCOL_ERROR');
    this.#revoke();
    this.#startBoot(true);
  }

  #onMessage(worker, generation, event) {
    if (worker !== this.#worker || generation !== this.#generation || this.#state === 'disposed') return;
    try {
      if (event.ports?.length) return this.#protocolFailure();
      const message = decode(event.data);
      if (!message) return this.#protocolFailure();
      const current = this.#boot ?? this.#run;
      if (message.generation < generation || message.requestId < (current?.requestId ?? this.#requestId) ||
          (!current && message.requestId === this.#requestId)) return;
      if (message.generation !== generation) return this.#protocolFailure();
      if (!current || message.requestId !== current.requestId) return this.#protocolFailure();
      if (this.#boot) {
        if (now() >= this.#boot.deadline) return this.#bootFailure(this.#boot,
          this.#boot.recovery ? 'RECOVERY_TIMEOUT' : 'INITIALIZATION_TIMEOUT');
        if (message.op !== 'initialize' || message.type !== 'ready' || !validReady(message.payload))
          return this.#protocolFailure();
        clearTimeout(this.#boot.timer);
        const boot = this.#boot;
        this.#boot = null;
        this.#state = 'ready';
        boot.d.resolve();
        return;
      }
      const run = this.#run;
      if (now() >= run.deadline) return this.#failRun(run, 'EXECUTION_TIMEOUT');
      if (message.op !== 'run') return this.#protocolFailure();
      if (message.type === 'stream') {
        const p = message.payload;
        if (!validStream(p) || p.sequence !== run.sequence + 1 ||
            p.sequence > LIMITS.streamMessageCount ||
            run[p.channel].length + p.text.length > LIMITS[`${p.channel}Chars`] ||
            run.stdout.length + run.stderr.length + p.text.length > LIMITS.combinedOutputChars)
          return this.#protocolFailure();
        run[p.channel] += p.text;
        run.sequence = p.sequence;
        return;
      }
      if (message.type === 'fatal') {
        if (!message.payload || !['INITIALIZATION_FAILED', 'RESOURCE_LIMIT', 'RUNTIME_FAILURE', 'PROTOCOL_ERROR'].includes(message.payload.code) ||
            Object.keys(message.payload).length !== 1) return this.#protocolFailure();
        return this.#failRun(run, message.payload.code);
      }
      if (message.type !== 'result' || !validResult(message.payload, run.filename)) return this.#protocolFailure();
      const p = message.payload;
      if (p.lastSequence !== run.sequence || p.stdoutChars !== run.stdout.length ||
          p.stderrChars !== run.stderr.length) return this.#protocolFailure();
      if (p.status === 'engine-error') {
        run.truncated = p.truncated;
        return this.#failRun(run, p.error.code);
      }
      const result = {status: p.status, stdout: run.stdout, stderr: run.stderr,
        durationMs: Math.max(0, now() - run.started), error: p.error,
        truncated: run.truncated || p.truncated};
      if (JSON.stringify(result).length > LIMITS.resultChars) return this.#protocolFailure();
      this.#settleRun(run, result);
      this.#state = 'ready';
    } catch { this.#protocolFailure(); }
  }

  async cancel() {
    if (this.#state === 'disposed') throw new EngineError('DISPOSED');
    if (this.#boot?.recovery) return this.#boot.d.promise;
    if (!this.#run) return;
    return this.#failRun(this.#run, 'CANCELLED');
  }

  async reset() {
    if (this.#state === 'disposed') throw new EngineError('DISPOSED');
    if (this.#boot?.recovery) return this.#boot.d.promise;
    if (this.#boot) {
      const boot = this.#boot;
      clearTimeout(boot.timer);
      this.#boot = null;
      this.#revoke();
      boot.d.reject(new EngineError('RESET'));
      return this.#startBoot(true);
    }
    if (this.#run) {
      return this.#failRun(this.#run, 'RESET');
    }
    this.#revoke();
    return this.#startBoot(this.#state === 'ready');
  }

  dispose() {
    if (this.#state === 'disposed') return;
    const boot = this.#boot;
    const run = this.#run;
    this.#state = 'disposed';
    this.#boot = null;
    this.#run = null;
    if (boot) clearTimeout(boot.timer);
    if (run) clearTimeout(run.timer);
    this.#revoke();
    if (boot) boot.d.reject(new EngineError('DISPOSED'));
    if (run) run.d.resolve(engineResult('DISPOSED', run.stdout, run.stderr,
      Math.max(0, now() - run.started), run.truncated));
  }
}
