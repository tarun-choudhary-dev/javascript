export default {
  testDir: './tests/browser',
  timeout: 30000,
  projects: [
    {name: 'Chrome product', use: {browserName: 'chromium', channel: 'chrome', headless: true}},
    {name: 'Edge product', use: {browserName: 'chromium', channel: 'msedge', headless: true}},
  ],
};
