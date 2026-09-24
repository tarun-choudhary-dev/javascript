import {chromium, firefox, webkit} from '@playwright/test';
import {startFixtureServer} from '../tests/browser/server.js';

const browserType = {chromium, firefox, webkit}[process.argv[2] ?? 'chromium'];
if (!browserType) throw new Error('Use chromium, firefox, or webkit');
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
};
const fixture = await startFixtureServer();
let browser;
try {
  browser = await browserType.launch();
  const page = await browser.newPage();
  await page.goto(`${fixture.base}/tests/browser/fixture.html`);
  const samples = await page.evaluate(async () => {
    const {JavaScriptEngine} = await import('/dist/index.js');
    const engine = new JavaScriptEngine();
    const timed = async action => {
      const before = performance.now();
      await action();
      return Math.round((performance.now() - before) * 10) / 10;
    };
    const initializeMs = await timed(() => engine.initialize());
    const firstRunMs = await timed(() => engine.run({source: 'console.log(1 + 1)'}));
    const runsMs = [];
    for (let i = 0; i < 20; i++)
      runsMs.push(await timed(() => engine.run({source: 'console.log(1 + 1)'})));
    const largeOutputMs = await timed(() => engine.run({source:
      "for (let i = 0; i < 16; i++) console.log('x'.repeat(1000))"}));
    const resetMs = await timed(() => engine.reset());
    const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    const cancelRecoveryMs = await timed(() => engine.cancel());
    const cancelled = await pending;
    const afterRecoveryMs = await timed(() => engine.run({source: 'console.log("ready")'}));
    const timeoutRecoveryMs = await timed(async () => {
      const timedOut = await engine.run({source: 'for (;;) {}', timeoutMs: 150});
      if (timedOut.error?.code !== 'EXECUTION_TIMEOUT') throw Error('timeout workload did not time out');
      await engine.initialize();
    });
    engine.dispose();
    return {initializeMs, firstRunMs, runsMs, largeOutputMs, resetMs,
      cancelRecoveryMs, cancelCode: cancelled.error.code, afterRecoveryMs,
      timeoutRecoveryMs};
  });
  console.log(JSON.stringify({browser: browserType.name(), browserVersion: browser.version(),
    workload: 'local HTTP, fresh page, one engine, 20 subsequent 1+1 console runs',
    samples, summary: {subsequentRunMedianMs: percentile(samples.runsMs, 0.5),
      subsequentRunP95Ms: percentile(samples.runsMs, 0.95)}}));
} finally {
  await browser?.close();
  await fixture.close();
}
