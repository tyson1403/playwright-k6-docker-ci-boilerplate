import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_CARDS, charge, luhnValid, validateCard } from '../src/services/payment.js';

const validCard = { number: TEST_CARDS.APPROVED, holder: 'A Traveller', expiry: '12/30', cvv: '123' };
const now = new Date('2026-10-06T00:00:00Z');

test('Luhn check accepts valid numbers and rejects typos', () => {
  for (const n of [TEST_CARDS.APPROVED, TEST_CARDS.DECLINED, '5555555555554444', '378282246310005']) assert.ok(luhnValid(n), n);
  for (const n of ['4111111111111112', '1234', 'abcd1234abcd1234', '']) assert.ok(!luhnValid(n), n);
});

test('a valid card has no errors; spaces and dashes are ignored', () => {
  assert.deepEqual(validateCard(validCard, now), []);
  assert.deepEqual(validateCard({ ...validCard, number: '4111 1111-1111 1111' }, now), []);
});

test('expiry: the card is valid through the end of its expiry month', () => {
  assert.deepEqual(validateCard({ ...validCard, expiry: '10/26' }, now), []);
  const expired = validateCard({ ...validCard, expiry: '09/26' }, now);
  assert.deepEqual(expired, [{ field: 'payment.expiry', message: 'Card has expired' }]);
});

test('reports every invalid field', () => {
  const errors = validateCard({ number: '1', holder: '', expiry: '13/30', cvv: '12a' }, now).map((e) => e.field);
  assert.deepEqual(errors, ['payment.number', 'payment.holder', 'payment.expiry', 'payment.cvv']);
  assert.deepEqual(validateCard(undefined, now).map((e) => e.field), ['payment']);
});

test('test cards drive gateway outcomes', () => {
  assert.equal(charge(validCard, 100).approved, true);
  assert.equal(charge(validCard, 100).cardLast4, '1111');
  assert.deepEqual(charge({ ...validCard, number: TEST_CARDS.DECLINED }, 100), { approved: false, reason: 'Card declined by issuer' });
  assert.equal(charge({ ...validCard, number: TEST_CARDS.INSUFFICIENT_FUNDS }, 100).reason, 'Insufficient funds');
});
