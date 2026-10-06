// SkyLane Air is a hub-and-spoke airline: every route touches the DXB hub.
// utcOffset is in minutes; blockMinutes is the flight time to/from DXB.
export const HUB = 'DXB';

export const AIRPORTS = [
  { code: 'DXB', city: 'Dubai', name: 'Dubai International', country: 'United Arab Emirates', utcOffset: 240, blockMinutes: 0 },
  { code: 'MCT', city: 'Muscat', name: 'Muscat International', country: 'Oman', utcOffset: 240, blockMinutes: 70 },
  { code: 'BAH', city: 'Bahrain', name: 'Bahrain International', country: 'Bahrain', utcOffset: 180, blockMinutes: 75 },
  { code: 'KWI', city: 'Kuwait City', name: 'Kuwait International', country: 'Kuwait', utcOffset: 180, blockMinutes: 105 },
  { code: 'RUH', city: 'Riyadh', name: 'King Khalid International', country: 'Saudi Arabia', utcOffset: 180, blockMinutes: 110 },
  { code: 'JED', city: 'Jeddah', name: 'King Abdulaziz International', country: 'Saudi Arabia', utcOffset: 180, blockMinutes: 165 },
  { code: 'KHI', city: 'Karachi', name: 'Jinnah International', country: 'Pakistan', utcOffset: 300, blockMinutes: 125 },
  { code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International', country: 'India', utcOffset: 330, blockMinutes: 185 },
  { code: 'COK', city: 'Kochi', name: 'Cochin International', country: 'India', utcOffset: 330, blockMinutes: 245 },
  { code: 'KTM', city: 'Kathmandu', name: 'Tribhuvan International', country: 'Nepal', utcOffset: 345, blockMinutes: 255 },
  { code: 'IST', city: 'Istanbul', name: 'Istanbul Airport', country: 'Türkiye', utcOffset: 180, blockMinutes: 290 },
  { code: 'TBS', city: 'Tbilisi', name: 'Tbilisi International', country: 'Georgia', utcOffset: 240, blockMinutes: 215 },
];

const byCode = new Map(AIRPORTS.map((a) => [a.code, a]));

export function getAirport(code) {
  return byCode.get(String(code || '').toUpperCase()) || null;
}

export function isServedRoute(from, to) {
  if (!getAirport(from) || !getAirport(to) || from === to) return false;
  return from === HUB || to === HUB;
}
