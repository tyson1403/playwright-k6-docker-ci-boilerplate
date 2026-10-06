import { randomUUID } from 'node:crypto';

export type Title = 'MR' | 'MRS' | 'MS';
export type FareCode = 'SAVER' | 'STANDARD' | 'FLEX';

export interface Passenger {
  title: Title;
  firstName: string;
  lastName: string;
}

export interface Card {
  holder: string;
  number: string;
  expiry: string;
  cvv: string;
}

export const DEMO_USER = { email: 'demo@skylane.test', password: 'Passw0rd!', firstName: 'Demo', lastName: 'Traveller' };

export const PRICING = { taxesPerPassenger: 85, extraBagPrice: 95, standardCancelFee: 200, currency: 'AED' };

/**
 * Routes are spread across specs so tests that change seat inventory
 * never interfere with each other when running in parallel.
 */
export const ROUTES = {
  search: { origin: 'DXB', destination: 'MCT' },
  booking: { origin: 'DXB', destination: 'KHI' },
  bookingUi: { origin: 'DXB', destination: 'BOM' },
  manage: { origin: 'DXB', destination: 'KWI' },
  checkin: { origin: 'DXB', destination: 'BAH' },
  checkinUi: { origin: 'DXB', destination: 'RUH' },
  // One flight per browser project, so desktop and mobile runs never compete for seats.
  checkinFamily: { chromium: { origin: 'DXB', destination: 'COK' }, 'mobile-chrome': { origin: 'DXB', destination: 'KTM' } },
  trips: { origin: 'DXB', destination: 'JED' },
  inventory: { origin: 'DXB', destination: 'TBS' },
  inbound: { origin: 'IST', destination: 'DXB' },
} as const;

export const CARDS = {
  valid: (): Card => ({ holder: 'Test Traveller', number: '4111111111111111', expiry: futureExpiry(), cvv: '123' }),
  declined: (): Card => ({ holder: 'Test Traveller', number: '4000000000000002', expiry: futureExpiry(), cvv: '123' }),
  insufficientFunds: (): Card => ({ holder: 'Test Traveller', number: '4000000000009995', expiry: futureExpiry(), cvv: '123' }),
  invalidLuhn: (): Card => ({ holder: 'Test Traveller', number: '4111111111111112', expiry: futureExpiry(), cvv: '123' }),
  expired: (): Card => ({ holder: 'Test Traveller', number: '4111111111111111', expiry: '01/20', cvv: '123' }),
};

function futureExpiry() {
  const year = (new Date().getUTCFullYear() + 3) % 100;
  return `12/${String(year).padStart(2, '0')}`;
}

/** YYYY-MM-DD in Dubai (UTC+4), offset by N days. Search dates are local to the origin airport. */
export function dubaiDate(offsetDays = 0): string {
  return new Date(Date.now() + 4 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Letters-only unique suffix, because passenger names may not contain digits. */
export function uniqueLetters(length = 6): string {
  const hex = randomUUID().replace(/-/g, '');
  return Array.from(hex.slice(0, length), (c) => String.fromCharCode(97 + (parseInt(c, 16) % 26))).join('');
}

export function passenger(overrides: Partial<Passenger> = {}): Passenger {
  const suffix = uniqueLetters();
  return {
    title: 'MR',
    firstName: 'Omar',
    lastName: `Test${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`,
    ...overrides,
  };
}

/** A party sharing a last name, like a family booking. */
export function party(count: number): Passenger[] {
  const lead = passenger();
  const firstNames = ['Omar', 'Layla', 'Yusuf', 'Mariam', 'Zayd', 'Noor', 'Adam', 'Huda', 'Ilyas'];
  return Array.from({ length: count }, (_, i) => ({
    title: i % 2 ? 'MS' : 'MR',
    firstName: firstNames[i],
    lastName: lead.lastName,
  }));
}

export const uniqueEmail = (prefix = 'qa') => `${prefix}.${randomUUID().slice(0, 8)}@example.com`;
