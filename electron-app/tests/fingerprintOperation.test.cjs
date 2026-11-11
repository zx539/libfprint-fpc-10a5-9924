const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FingerprintOperations } = require('../dist-electron/main/fingerprintOperation.js');

const fixture = (script, options = {}) => ({ command: process.execPath, args: ['-e', script], mode: 'enroll', operationId: 'test-operation', ...options });

test('streams split lines, retries and actual samples before the process finishes', async () => {
  const runner = new FingerprintOperations();
  const events = [];
  const result = await runner.run(fixture(`
    process.stdout.write('Enroll res');
    setTimeout(() => {
      process.stdout.write('ult: enroll-stage-passed\\r\\nEnroll result: enroll-finger-not-centered\\n');
      process.stdout.write('Enroll result: enroll-stage-passed\\n');
      setTimeout(() => process.stderr.write('Enroll result: enroll-completed'), 30);
    }, 10);
  `, { totalStages: 5, onProgress: event => {
    if (event.phase === 'sample') assert.equal(runner.busy, true);
    events.push(event);
  } }));
  assert.equal(result.ok, true);
  const samples = events.filter(event => event.phase === 'sample');
  assert.deepEqual(samples.map(event => event.percent), [20, 40]);
  assert.equal(events.find(event => event.phase === 'retry').completedStages, 1);
  assert.match(events.find(event => event.phase === 'retry').message, /居中/);
  assert.ok(events.filter(event => event.phase !== 'success').every(event => event.percent < 100));
  assert.equal(events.at(-1).percent, 100);
  assert.equal(runner.busy, false);
});

test('reaching the sample target waits for successful completion before 100%', async () => {
  const events = [];
  const result = await new FingerprintOperations().run(fixture("console.log('Enroll result: enroll-stage-passed')", { totalStages: 1, onProgress: event => events.push(event) }));
  assert.equal(result.ok, false);
  assert.equal(events.find(event => event.phase === 'sample').percent, 99);
  assert.ok(events.every(event => event.percent !== 100));
});

test('duplicate errors are translated and fail even if the tool exits with zero', async () => {
  const result = await new FingerprintOperations().run(fixture("console.log('Enroll result: enroll-duplicate')"));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'enroll-duplicate');
  assert.match(result.message, /已经录入/);
  assert.match(result.output, /enroll-duplicate/);
});

test('unknown stage totals remain indeterminate until success', async () => {
  const events = [];
  await new FingerprintOperations().run(fixture("console.log('Enroll result: enroll-stage-passed\\nEnroll result: enroll-completed')", { onProgress: event => events.push(event) }));
  assert.equal(events.find(event => event.phase === 'sample').percent, null);
  assert.equal(events.at(-1).percent, 100);
});

test('completion output followed by a failed process never reports success', async () => {
  const events = [];
  const result = await new FingerprintOperations().run(fixture("console.log('Enroll result: enroll-completed'); process.exitCode = 1", { totalStages: 25, onProgress: event => events.push(event) }));
  assert.equal(result.ok, false);
  assert.ok(events.every(event => event.phase !== 'success'));
});

test('device ownership errors are actionable', async () => {
  const result = await new FingerprintOperations().run(fixture("console.error('Device was already claimed'); process.exitCode = 1"));
  assert.match(result.message, /其他操作占用/);
});

test('operation IDs isolate cancellation and the lock lasts until process exit', async () => {
  const runner = new FingerprintOperations();
  const first = runner.run(fixture('setInterval(() => {}, 1000)'));
  assert.equal((await runner.run(fixture(''))).code, 'busy');
  assert.equal((await runner.cancel('stale-operation')).code, 'operation-mismatch');
  assert.equal(runner.busy, true);
  const cancellation = runner.cancel('test-operation');
  assert.equal(runner.busy, true);
  await cancellation;
  assert.equal((await first).code, 'cancelled');
  assert.equal(runner.busy, false);
  const second = await runner.run(fixture("console.log('Enroll result: enroll-completed')", { operationId: 'new-operation' }));
  assert.equal(second.ok, true);
});

test('timeouts and missing executables fail and release the device lock', async () => {
  const runner = new FingerprintOperations();
  assert.equal((await runner.run(fixture('setInterval(() => {}, 1000)', { timeout: 20 }))).code, 'timeout');
  assert.equal(runner.busy, false);
  assert.equal((await runner.run({ command: '/nonexistent-fprintd-test', args: [] })).code, 'spawn-error');
  assert.equal(runner.busy, false);
});

test('verification requires a real match and reports retries', async () => {
  const runner = new FingerprintOperations();
  const events = [];
  const match = await runner.run(fixture("console.log('Verify result: verify-finger-not-centered\\nVerify result: verify-match (done)')", { mode: 'verify', onProgress: event => events.push(event) }));
  assert.equal(match.ok, true);
  assert.ok(events.some(event => event.phase === 'retry'));
  const noMatch = await runner.run(fixture("console.log('Verify result: verify-no-match (done)')", { mode: 'verify' }));
  assert.equal(noMatch.ok, false);
  assert.match(noMatch.message, /不匹配/);
});
