import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_BAG_PRICE, STANDARD_CANCEL_FEE, TAXES_PER_PASSENGER, farePrice, quote, refundAmount } from '../src/services/pricing.js';

test('fare multipliers: Saver 1x, Standard 1.4x, Flex 1.9x (rounded)', () => {
  assert.equal(farePrice(500, 'SAVER'), 500);
  assert.equal(farePrice(500, 'STANDARD'), 700);
  assert.equal(farePrice(333, 'FLEX'), 633); // 632.7 rounds up
  assert.throws(() => farePrice(500, 'FIRST'), /Unknown fare/);
});

test('quote multiplies every component by the passenger count', () => {
  const q = quote({ basePrice: 400, fareCode: 'STANDARD', passengers: 3, extraBag: true });
  assert.deepEqual(q, {
    currency: 'AED',
    fare: 560 * 3,
    taxes: TAXES_PER_PASSENGER * 3,
    extras: EXTRA_BAG_PRICE * 3,
    total: (560 + TAXES_PER_PASSENGER + EXTRA_BAG_PRICE) * 3,
  });
});

test('quote without extra bag has zero extras', () => {
  assert.equal(quote({ basePrice: 400, fareCode: 'SAVER', passengers: 1 }).extras, 0);
});

test('refunds follow the fare rules', () => {
  const booking = (fare, total, taxes, pax) => ({ fare, price: { total, taxes }, passengers: Array(pax).fill({}) });
  assert.equal(refundAmount(booking('SAVER', 1000, 170, 2)), 170);
  assert.equal(refundAmount(booking('STANDARD', 1000, 170, 2)), 1000 - STANDARD_CANCEL_FEE * 2);
  assert.equal(refundAmount(booking('FLEX', 1000, 170, 2)), 1000);
});

test('Standard refund never drops below the taxes', () => {
  const booking = { fare: 'STANDARD', price: { total: 300, taxes: 85 }, passengers: [{}] };
  assert.equal(refundAmount(booking), 100);
  const cheap = { fare: 'STANDARD', price: { total: 250, taxes: 85 }, passengers: [{}] };
  assert.equal(refundAmount(cheap), 85);
});
