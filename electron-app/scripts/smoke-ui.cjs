/* Real Electron main/preload/React smoke test. Native tools and D-Bus are
 * fixtures so this never enrolls, deletes or verifies a real fingerprint.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, nativeTheme } = require('electron');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fpc-ui-smoke-'));
const scenario = path.join(temporary, 'scenario');
const invocations = path.join(temporary, 'invocations.jsonl');
const node = process.env.npm_node_execpath || process.env.FPC_SMOKE_NODE;
if (!node) throw new Error('Run through npm run test:ui or set FPC_SMOKE_NODE to the Node executable');
const binaryDir = path.join(temporary, 'bin');
fs.mkdirSync(binaryDir);
fs.writeFileSync(scenario, 'samples');
for (const name of ['fprintd-list', 'fprintd-enroll', 'fprintd-verify']) {
  fs.writeFileSync(path.join(binaryDir, name), `#!${node}
const fs = require('node:fs');
const kind = ${JSON.stringify(name)};
const scenario = ${JSON.stringify(scenario)};
fs.appendFileSync(${JSON.stringify(invocations)}, JSON.stringify({ kind, args: process.argv.slice(2) }) + '\\n');
if (kind === 'fprintd-list') {
  console.log('Fingerprints for test user:\\n - #0: right-index-finger\\n - #1: right-middle-finger');
} else if (kind === 'fprintd-verify') {
  console.log('Verify result: verify-match (done)');
} else if (fs.readFileSync(scenario, 'utf8') === 'duplicate') {
  console.log('Enroll result: enroll-duplicate');
  process.exitCode = 1;
} else if (fs.readFileSync(scenario, 'utf8') === 'complete') {
  console.log('Enroll result: enroll-stage-passed\\nEnroll result: enroll-completed');
} else {
  let count = 0;
  const timer = setInterval(() => {
    if (fs.readFileSync(scenario, 'utf8') === 'complete') {
      console.log('Enroll result: enroll-completed'); clearInterval(timer); return;
    }
    if (++count <= 6) console.log('Enroll result: enroll-stage-passed');
    if (count === 7) console.log('Enroll result: enroll-finger-not-centered');
  }, 80);
}
`, { mode: 0o755 });
}
process.env.PATH = `${binaryDir}${path.delimiter}${process.env.PATH}`;
process.env.VITE_DEV_SERVER_URL = pathToFileURL(path.join(root, 'dist/index.html')).href;
app.setPath('userData', path.join(temporary, 'user-data'));
app.disableHardwareAcceleration();
nativeTheme.themeSource = 'light';
require('dbus-next').systemBus = () => ({
  on() {}, disconnect() {},
  async getProxyObject() { return { getInterface: () => ({ GetDevices: async () => ['/test/device'], Get: async () => ({ value: 25 }) }) }; },
});

let window;
const loaded = new Promise(resolve => app.on('browser-window-created', (_event, next) => {
  window = next;
  next.showInactive();
  next.webContents.setBackgroundThrottling(false);
  next.webContents.once('did-finish-load', resolve);
}));
require('../dist-electron/main/main.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = source => window.webContents.executeJavaScript(source, true);
async function waitFor(source, label = source) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(source)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${await evaluate('document.body.innerText')}`);
}
async function click(text) {
  await evaluate(`(() => { const matches = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === ${JSON.stringify(text)}); const button = matches.find(b => !b.closest('aside')) || matches[0]; if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)}); button.click(); })()`);
}
async function openEnroll() {
  await click('指纹管理');
  await waitFor("document.querySelector('h1')?.textContent === '我的指纹'");
  await click('录入指纹');
  await waitFor("Boolean(document.querySelector('[role=dialog] select'))");
}

const watchdog = setTimeout(() => { console.error('UI smoke test exceeded 45 seconds'); app.exit(1); }, 45_000);
(async () => {
  await loaded;
  await waitFor("document.body.innerText.includes('指纹管理')");
  await openEnroll();
  await evaluate(`(() => { const select = document.querySelector('[role=dialog] select'); select.value = 'right-middle-finger'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click('开始采集');
  await waitFor("document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '24'");
  await waitFor("document.querySelector('.capture-hint')?.textContent.includes('居中')");
  const calls = fs.readFileSync(invocations, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.some(call => call.kind === 'fprintd-enroll' && call.args.includes('right-middle-finger')));
  window.webContents.send('fingerprint:progress', { operationId: 'stale-event', percent: 99, message: 'stale event', phase: 'sample' });
  await delay(100);
  assert.equal(await evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')"), '24');
  const artifacts = path.join(root, 'release/ui-smoke');
  fs.mkdirSync(artifacts, { recursive: true });
  await delay(350);
  fs.writeFileSync(path.join(artifacts, 'enrollment-progress.png'), (await window.webContents.capturePage()).toPNG());
  fs.writeFileSync(scenario, 'complete');
  await waitFor("document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '100'");
  await waitFor("Boolean(document.querySelector('.fingerprint-success .result-badge'))");
  await click('完成');
  await waitFor("!document.querySelector('[role=dialog]')");

  fs.writeFileSync(scenario, 'duplicate');
  await openEnroll();
  await click('开始采集');
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('已经录入')");
  await evaluate("document.querySelector('.capture-error details').open = true");
  assert.match(await evaluate("document.querySelector('.capture-error pre').textContent"), /enroll-duplicate/);
  nativeTheme.themeSource = 'dark';
  window.setSize(540, 620);
  await delay(350);
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().bottom <= window.innerHeight"), true);
  await evaluate("document.querySelector('[role=dialog]').scrollTop = document.querySelector('[role=dialog]').scrollHeight");
  fs.writeFileSync(path.join(artifacts, 'enrollment-error-dark.png'), (await window.webContents.capturePage()).toPNG());
  fs.writeFileSync(scenario, 'complete');
  await click('重试录入');
  await waitFor("Boolean(document.querySelector('.fingerprint-success'))");
  await click('完成');
  await waitFor("!document.querySelector('[role=dialog]')");
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate("document.body.insertAdjacentHTML('beforeend', '<div id=motion-test class=animate-spin></div>')");
  assert.ok(parseFloat(await evaluate("getComputedStyle(document.getElementById('motion-test')).animationDuration")) <= 0.001);
  window.webContents.debugger.detach();

  fs.writeFileSync(scenario, 'wait');
  await openEnroll();
  await click('开始采集');
  await waitFor("document.body.innerText.includes('取消操作')");
  await click('取消操作');
  await waitFor("!document.querySelector('[role=dialog]')");
  await click('验证测试');
  await waitFor("document.querySelector('h1')?.textContent.includes('验证')");
  await click('开始验证');
  await waitFor("document.querySelector('[role=dialog]')?.textContent.includes('验证成功')");
  const completedCalls = fs.readFileSync(invocations, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(completedCalls.filter(call => call.kind === 'fprintd-verify').length, 1);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('[role=dialog]')");
  console.log('UI smoke passed: finger selection, real IPC progress, retries, stale events, success, errors, details, cancel, verify, dark mode, small window and reduced motion.');
  console.log(`Screenshots: ${artifacts}`);
  clearTimeout(watchdog);
  app.exit(0);
})().catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
