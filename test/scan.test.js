'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scan } = require('../src/scan');

const ZERO_SHA = '0000000000000000000000000000000000000000';
const SOME_SHA = 'abc1234def5678901234567890123456789abcde';

test('scan returns empty array when local_sha is all-zero (ref deletion)', () => {
  const findings = scan(ZERO_SHA, SOME_SHA);
  assert.deepEqual(findings, []);
});
