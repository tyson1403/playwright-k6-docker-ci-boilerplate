import exec from 'k6/execution';

export const HUB = 'DXB';
export const SPOKES = ['MCT', 'BAH', 'KWI', 'RUH', 'JED', 'KHI', 'BOM', 'COK', 'KTM', 'IST', 'TBS'];
export const FARES = ['SAVER', 'STANDARD', 'FLEX'];
const FIRST_NAMES = ['Omar', 'Layla', 'Yusuf', 'Mariam', 'Arjun', 'Priya', 'Elif', 'Giorgi', 'Fatima', 'Rahul'];

export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/** Random hub-and-spoke route in either direction. */
export function randomRoute() {
  const spoke = pick(SPOKES);
  return Math.random() < 0.5 ? { origin: HUB, destination: spoke } : { origin: spoke, destination: HUB };
}

/** YYYY-MM-DD in Dubai time (UTC+4), N days from today. */
export function dubaiDate(offsetDays) {
  return new Date(Date.now() + 4 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function letters(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + randomInt(0, 25));
  return out;
}

/** Party sharing a unique last name (names may only contain letters). */
export function party(size) {
  const lastName = `Load${letters(7)}`;
  return Array.from({ length: size }, (_, i) => ({ title: i % 2 ? 'MS' : 'MR', firstName: pick(FIRST_NAMES), lastName }));
}

export const VALID_CARD = { holder: 'Load Tester', number: '4111111111111111', expiry: '12/35', cvv: '123' };

export function uniqueKey() {
  return `${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${Date.now()}-${letters(6)}`;
}
