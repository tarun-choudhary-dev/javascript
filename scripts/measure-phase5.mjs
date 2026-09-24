// Diagnostic snapshots only: browser JS-heap APIs are not a total Worker/WASM/process cap.
import {chromium, firefox, webkit} from '@playwright/test';
import {startFixtureServer} from '../tests/browser/server.js';

const fixture = await startFixtureServer();
try {
  for (const [name, browserType] of Object.entries({chromium, firefox, webkit})) {
    const browser = await browserType.launch({headless: true});
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.base}/tests/browser/fixture.html`);
      const snapshot = async label => {
        const pageHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
        const worker = page.workers()[0];
        const workerHeap = worker ? await worker.evaluate(() =>
          performance.memory?.usedJSHeapSize ?? null).catch(() => null) : null;
        return {label, pageHeap, workerHeap, workerCount: page.workers().length};
      };
      const samples = [await snapshot('baseline')];
      await page.evaluate(async () => {
        const {JavaScriptEngine} = await import('/dist/index.js');
        window.__phase5Engine = new JavaScriptEngine();
        await window.__phase5Engine.initialize();
      });
      const inventory = await page.evaluate(() => window.__phase5Engine.run({source: `
        const names = Object.getOwnPropertyNames(globalThis).sort();
        for (let i = 0; i < names.length; i += 12) console.log(JSON.stringify(names.slice(i, i + 12)));
      `}));
      const guestGlobals = inventory.stdout.trim().split('\n').flatMap(line => JSON.parse(line));
      samples.push(await snapshot('initialized'));
      const outcomes = [];
      for (const [label, source] of [
        ['small', 'console.log(1)'],
        ['bounded-allocation', 'let a = new Uint8Array(8 * 1024 * 1024); a[0] = 1; console.log(a.length)'],
        ['heap-pressure', 'let a = new Uint8Array(20 * 1024 * 1024); console.log(a.length)'],
      ]) {
        const result = await page.evaluate(source => window.__phase5Engine.run({source, timeoutMs: 2000}), source);
        outcomes.push({label, status: result.status, code: result.error?.code ?? null});
        await page.evaluate(() => window.__phase5Engine.initialize());
        samples.push(await snapshot(label));
      }
      for (let iteration = 0; iteration < 3; iteration++) {
        const result = await page.evaluate(async () => {
          const pending = window.__phase5Engine.run({source: 'while (true) {}', timeoutMs: 5000});
          await window.__phase5Engine.cancel();
          return pending;
        });
        outcomes.push({label: `cancel-${iteration}`, status: result.status, code: result.error?.code ?? null});
        samples.push(await snapshot(`recovery-${iteration}`));
      }
      const finalWorker = page.workers()[0];
      const closed = new Promise(resolve => finalWorker?.once('close', resolve));
      await page.evaluate(() => window.__phase5Engine.dispose());
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 500))]);
      samples.push(await snapshot('disposed'));
      process.stdout.write(`${JSON.stringify({browser: name, guestGlobals, samples, outcomes})}\n`);
    } finally { await browser.close(); }
  }
} finally { await fixture.close(); }
