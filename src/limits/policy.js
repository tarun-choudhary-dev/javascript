export const POLICY_VERSION = 'script-sync-v1-policy-1';

// UTF-16 units unless a key explicitly says bytes or milliseconds.
export const LIMITS = Object.freeze({
  sourceChars: 32768, filenameChars: 256,
  stdoutChars: 32768, stderrChars: 32768, combinedOutputChars: 32768,
  consoleArgumentCount: 16, consoleCallCount: 1000,
  errorNameChars: 80, errorMessageChars: 2048, errorStackChars: 4096,
  resultChars: 250000, messageChars: 210000, runtimeInfoChars: 80,
  streamChunkChars: 1024, streamMessageCount: 128,
  guestHeapBytes: 16777216, guestStackBytes: 524288,
  initializationTimeoutMs: 15000, defaultExecutionTimeoutMs: 2000,
  maxExecutionTimeoutMs: 5000, recoveryTimeoutMs: 15000,
});
