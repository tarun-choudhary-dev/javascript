import {LIMITS} from '../limits/policy.js';

const isHighSurrogate = code => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = code => code >= 0xdc00 && code <= 0xdfff;

// Limits count UTF-16 units; a cut may use one fewer unit to preserve a pair.
export function safePrefix(value, cap) {
  if (value.length <= cap) return value;
  if (cap > 0 && isHighSurrogate(value.charCodeAt(cap - 1))) cap--;
  return value.slice(0, cap);
}

export function createOutputCollector(stream, limits = LIMITS) {
  let sequence = 0;
  let stdoutChars = 0;
  let stderrChars = 0;
  let consoleCalls = 0;
  let truncated = false;
  let quotaReached = false;

  return {
    markTruncated() { truncated = true; },
    noteConsoleCall() {
      if (++consoleCalls > limits.consoleCallCount) quotaReached = true;
      return !quotaReached;
    },
    get quotaReached() { return quotaReached; },
    append(channel, value) {
      const channelCount = channel === 'stdout' ? stdoutChars : stderrChars;
      const remaining = Math.min(limits[`${channel}Chars`] - channelCount,
        limits.combinedOutputChars - stdoutChars - stderrChars);
      if (remaining <= 0) { truncated = true; return; }
      if (value.length > remaining) { value = safePrefix(value, remaining); truncated = true; }
      for (let index = 0; index < value.length;) {
        if (sequence >= limits.streamMessageCount) { quotaReached = true; return; }
        let end = Math.min(value.length, index + limits.streamChunkChars);
        if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1)) &&
            isLowSurrogate(value.charCodeAt(end))) end--;
        const chunk = value.slice(index, end);
        sequence++;
        if (channel === 'stdout') stdoutChars += chunk.length;
        else stderrChars += chunk.length;
        stream({sequence, channel, text: chunk});
        index = end;
      }
    },
    summary() { return {truncated, lastSequence: sequence, stdoutChars, stderrChars}; },
  };
}
