// Mock payment gateway. No real card data is ever stored - only the last 4 digits.
export const TEST_CARDS = {
  APPROVED: '4111111111111111',
  DECLINED: '4000000000000002',
  INSUFFICIENT_FUNDS: '4000000000009995',
};

export function luhnValid(number) {
  if (!/^\d{12,19}$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = Number(number[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Returns a list of field errors for the card details (empty if valid). */
export function validateCard(card, now = new Date()) {
  const errors = [];
  if (!card || typeof card !== 'object') return [{ field: 'payment', message: 'Payment details are required' }];
  const number = String(card.number || '').replace(/[\s-]/g, '');
  if (!luhnValid(number)) errors.push({ field: 'payment.number', message: 'Card number is invalid' });
  if (!String(card.holder || '').trim()) errors.push({ field: 'payment.holder', message: 'Card holder name is required' });

  const expiry = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(card.expiry || ''));
  if (!expiry) {
    errors.push({ field: 'payment.expiry', message: 'Expiry must be in MM/YY format' });
  } else {
    const endOfMonth = new Date(Date.UTC(2000 + Number(expiry[2]), Number(expiry[1]), 1));
    if (endOfMonth <= now) errors.push({ field: 'payment.expiry', message: 'Card has expired' });
  }
  if (!/^\d{3}$/.test(String(card.cvv || ''))) errors.push({ field: 'payment.cvv', message: 'CVV must be 3 digits' });
  return errors;
}

/** Simulates authorising the charge. */
export function charge(card, amount) {
  const number = String(card.number).replace(/[\s-]/g, '');
  if (number === TEST_CARDS.DECLINED) return { approved: false, reason: 'Card declined by issuer' };
  if (number === TEST_CARDS.INSUFFICIENT_FUNDS) return { approved: false, reason: 'Insufficient funds' };
  return {
    approved: true,
    amount,
    cardLast4: number.slice(-4),
    authCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
  };
}
