import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, findFlight, flightsForRoute, isBookable, localToday, parseIsoDate } from '../src/services/schedule.js';
import { getAirport, isServedRoute } from '../src/data/airports.js';

test('only routes touching the DXB hub are served', () => {
  assert.ok(isServedRoute('DXB', 'KHI'));
  assert.ok(isServedRoute('KHI', 'DXB'));
  assert.ok(!isServedRoute('KHI', 'BOM'));
  assert.ok(!isServedRoute('DXB', 'DXB'));
  assert.ok(!isServedRoute('DXB', 'XXX'));
  assert.deepEqual(flightsForRoute('KHI', 'BOM', '2026-12-01'), []);
});

test('schedule is deterministic and has 2-3 daily flights', () => {
  const a = flightsForRoute('DXB', 'MCT', '2026-12-01');
  const b = flightsForRoute('DXB', 'MCT', '2026-12-01');
  assert.deepEqual(a, b);
  assert.ok(a.length >= 2 && a.length <= 3);
});

test('times are local to each airport and duration is consistent', () => {
  const [flight] = flightsForRoute('DXB', 'KHI', '2026-12-01');
  assert.match(flight.departureTime, /\+04:00$/);
  assert.match(flight.arrivalTime, /\+05:00$/);
  assert.equal(Date.parse(flight.arrivalUtc) - Date.parse(flight.departureUtc), getAirport('KHI').blockMinutes * 60_000);
  // The local departure time is on the requested local date.
  assert.equal(flight.departureTime.slice(0, 10), '2026-12-01');
});

test('findFlight resolves ids produced by the schedule and rejects others', () => {
  for (const flight of flightsForRoute('IST', 'DXB', '2027-01-15')) {
    assert.deepEqual(findFlight(flight.id), flight);
  }
  for (const id of ['', 'SL9990-20270115', 'SL1000-20270115', 'SL1031-20270230', 'XX1031-20270115']) {
    assert.equal(findFlight(id), null, id);
  }
});

test('flights close for booking 2 hours before departure', () => {
  const [flight] = flightsForRoute('DXB', 'MCT', '2026-12-01');
  const departure = Date.parse(flight.departureUtc);
  assert.ok(isBookable(flight, departure - 121 * 60_000));
  assert.ok(!isBookable(flight, departure - 119 * 60_000));
});

test('date helpers', () => {
  assert.equal(parseIsoDate('2026-02-29'), null); // not a leap year
  assert.deepEqual(parseIsoDate('2028-02-29'), { y: 2028, m: 2, d: 29 });
  assert.equal(parseIsoDate('2026-1-1'), null);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  // 22:30 UTC is already the next day in Dubai (UTC+4).
  assert.equal(localToday(getAirport('DXB'), Date.parse('2026-10-06T22:30:00Z')), '2026-10-07');
  assert.equal(localToday(getAirport('IST'), Date.parse('2026-10-06T20:30:00Z')), '2026-10-06');
});
