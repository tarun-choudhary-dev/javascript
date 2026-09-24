import {chromium, firefox, webkit} from '@playwright/test';
import {startFixtureServer} from '../tests/browser/server.js';

const browserType = {chromium, firefox, webkit}[process.argv[2] ?? 'chromium'];
if (!browserType) throw new Error('Use chromium, firefox, or webkit');
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
    const runsMs = [];
    for (let i = 0; i < 10; i++)
      runsMs.push(await timed(() => engine.run({source: 'console.log(1 + 1)'})));
    const resetMs = await timed(() => engine.reset());
    const pending = engine.run({source: 'for (;;) {}', timeoutMs: 5000});
    const cancelRecoveryMs = await timed(() => engine.cancel());
    const cancelled = await pending;
    const afterRecoveryMs = await timed(() => engine.run({source: 'console.log("ready")'}));
    engine.dispose();
    return {initializeMs, runsMs, resetMs, cancelRecoveryMs,
      cancelCode: cancelled.error.code, afterRecoveryMs};
  });
  console.log(JSON.stringify({browser: browserType.name(), browserVersion: browser.version(), samples}));
} finally {
  await browser?.close();
  await fixture.close();
}
