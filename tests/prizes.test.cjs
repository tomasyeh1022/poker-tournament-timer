'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocate, toPercent, validate, emptyConfig, loadConfig, STORAGE_KEY } = require('../prizes.js');
const configured = overrides => ({ pool: 100, unit: 'NT$', mode: 'percent', count: 3, values: [50, 30, 20], ...overrides });

test('initial state contains no prize amount or percentage assumptions', () => {
  assert.equal(emptyConfig().pool, null);
  assert.deepEqual(emptyConfig().values, [null, null, null]);
  assert.equal(validate(emptyConfig()).valid, false);
  assert.equal(validate(emptyConfig(), true).valid, true);
});

test('largest remainder awards exact total and prioritizes earlier tied ranks', () => {
  assert.deepEqual(allocate(101, [50, 30, 20]), [51, 30, 20]);
  assert.deepEqual(allocate(103, [25, 25, 25, 25]), [26, 26, 26, 25]);
  assert.deepEqual(allocate(100, [33.33, 33.33, 33.34]), [33, 33, 34]);
  for (let pool = 6; pool <= 2000; pool += 7) {
    const amounts = allocate(pool, [35, 25, 15, 10, 8, 7]);
    assert.equal(amounts.reduce((sum, value) => sum + value, 0), pool);
    assert.ok(amounts.every(Number.isSafeInteger));
  }
  assert.equal(allocate(999999999, [33.33, 33.33, 33.34]).reduce((sum, value) => sum + value, 0), 999999999);
});

test('fixed amount conversion preserves total at 0.01 percent precision', () => {
  assert.deepEqual(toPercent(3, [1, 1, 1]), [33.34, 33.33, 33.33]);
  assert.deepEqual(toPercent(100, [50, 30, 20]), [50, 30, 20]);
  assert.throws(() => toPercent(100, [50, 30, 19]), RangeError);
  assert.throws(() => allocate(100, [50, 30, 19]), RangeError);
});

test('blank pool never silently discards supplied rewards', () => {
  const result = validate(configured({ pool: null }));
  assert.equal(result.valid, false);
  assert.equal(result.field, 'pool');
  assert.match(result.message, /已填入名次分配/);
  assert.equal(validate(configured({ pool: null }), true).valid, false);
  assert.match(validate(configured({ values: [50, null, 20] })).message, /第 2 名/);
});

test('rejects malformed, unsafe, incomplete and inconsistent stored input', () => {
  const invalid = [null, [], {}, configured({ pool: 0 }), configured({ pool: -1 }), configured({ pool: 1.5 }),
    configured({ pool: 1000000000 }), configured({ pool: '100' }), configured({ count: 0 }), configured({ count: 7 }),
    configured({ count: 2 }), configured({ mode: 'script' }), configured({ unit: '<script>' }),
    configured({ values: [50, 30, '20'] }), configured({ values: [50, NaN, 20] }), configured({ values: [50, Infinity, 20] }),
    configured({ values: [50.001, 29.999, 20] }), configured({ values: [100, 0, 0] }), configured({ values: [50, 30, 10] }),
    configured({ values: [50, 30, 20], injected: 1 }), configured({ pool: 2 })];
  for (const config of invalid) assert.equal(validate(config, true).valid, false, JSON.stringify(config));
});

test('fixed prizes must use integer units and equal the pool', () => {
  assert.equal(validate(configured({ mode: 'amount' })).valid, true);
  assert.equal(validate(configured({ mode: 'amount', values: [50, 30, 21] })).valid, false);
  assert.equal(validate(configured({ mode: 'amount', values: [50.5, 29.5, 20] })).valid, false);
  for (const unit of ['NT$', '點', '籌碼']) assert.equal(validate(configured({ unit })).valid, true);
  for (let count = 1; count <= 6; count += 1) {
    assert.equal(validate(configured({ count, mode: 'amount', pool: count * 10, values: Array(count).fill(10) })).valid, true);
  }
});

test('load handles absent, corrupt or blocked storage without inventing prizes', () => {
  const calls = [];
  const absent = loadConfig({ getItem(key) { calls.push(key); return null; } });
  assert.equal(absent.config.pool, null);
  assert.equal(absent.warning, '');
  assert.deepEqual(calls, [STORAGE_KEY]);
  const config = configured();
  assert.deepEqual(loadConfig({ getItem: () => JSON.stringify(config) }).config, config);
  for (const getItem of [() => '{broken', () => JSON.stringify(configured({ mode: 'bad' })), () => { throw new Error('SecurityError'); }]) {
    const result = loadConfig({ getItem });
    assert.equal(result.config.pool, null);
    assert.deepEqual(result.config.values, [null, null, null]);
    assert.ok(result.warning.length > 0);
  }
});
