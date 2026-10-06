import { Router } from 'express';
import { AIRPORTS, getAirport, isServedRoute } from '../data/airports.js';
import { MAX_DAYS_AHEAD, addDays, findFlight, flightsForRoute, isBookable, localToday, parseIsoDate } from '../services/schedule.js';
import { CURRENCY, EXTRA_BAG_PRICE, FARES, fareOptions, quote } from '../services/pricing.js';
import { seatsAvailable } from '../store.js';
import { MAX_PASSENGERS } from '../validation.js';
import { badRequest, notFound } from '../errors.js';

const router = Router();

export function withAvailability(flight, passengers = 1) {
  const seats = seatsAvailable(flight.id);
  return {
    ...flight,
    seatsAvailable: seats,
    available: seats >= passengers,
    currency: CURRENCY,
    fares: fareOptions(flight.basePrice),
  };
}

router.get('/airports', (_req, res) => {
  res.json({ airports: AIRPORTS.map(({ code, city, name, country }) => ({ code, city, name, country })) });
});

router.get('/airports/:code/destinations', (req, res) => {
  const origin = getAirport(req.params.code);
  if (!origin) throw notFound(`Unknown airport ${req.params.code}`);
  const destinations = AIRPORTS.filter((a) => isServedRoute(origin.code, a.code)).map(({ code, city }) => ({ code, city }));
  res.json({ origin: origin.code, destinations });
});

router.get('/flights/search', (req, res) => {
  const origin = String(req.query.origin || '').toUpperCase();
  const destination = String(req.query.destination || '').toUpperCase();
  const date = String(req.query.date || '');
  const passengers = Number(req.query.passengers ?? 1);

  const errors = [];
  if (!getAirport(origin)) errors.push({ field: 'origin', message: 'Unknown origin airport' });
  if (!getAirport(destination)) errors.push({ field: 'destination', message: 'Unknown destination airport' });
  if (origin && origin === destination) errors.push({ field: 'destination', message: 'Destination must differ from origin' });
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_PASSENGERS) {
    errors.push({ field: 'passengers', message: `Passengers must be between 1 and ${MAX_PASSENGERS}` });
  }
  if (!parseIsoDate(date)) {
    errors.push({ field: 'date', message: 'Date must be a valid YYYY-MM-DD date' });
  } else if (getAirport(origin)) {
    const today = localToday(getAirport(origin));
    if (date < today) errors.push({ field: 'date', message: 'Date cannot be in the past' });
    if (date > addDays(today, MAX_DAYS_AHEAD)) errors.push({ field: 'date', message: `Date must be within ${MAX_DAYS_AHEAD} days` });
  }
  if (errors.length) throw badRequest('Search criteria are invalid', errors);

  const flights = flightsForRoute(origin, destination, date)
    .filter((f) => isBookable(f))
    .map((f) => withAvailability(f, passengers));

  res.json({ origin, destination, date, passengers, routeServed: isServedRoute(origin, destination), flights });
});

router.get('/flights/:id', (req, res) => {
  const flight = findFlight(req.params.id);
  if (!flight) throw notFound(`Flight ${req.params.id} not found`);
  res.json({ ...withAvailability(flight), bookable: isBookable(flight) });
});

router.get('/flights/:id/quote', (req, res) => {
  const flight = findFlight(req.params.id);
  if (!flight) throw notFound(`Flight ${req.params.id} not found`);
  const fare = String(req.query.fare || '').toUpperCase();
  const passengers = Number(req.query.passengers ?? 1);
  const errors = [];
  if (!FARES[fare]) errors.push({ field: 'fare', message: `Fare must be one of ${Object.keys(FARES).join(', ')}` });
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_PASSENGERS) {
    errors.push({ field: 'passengers', message: `Passengers must be between 1 and ${MAX_PASSENGERS}` });
  }
  if (errors.length) throw badRequest('Quote request is invalid', errors);
  const extraBag = req.query.extraBag === 'true';
  res.json({
    flightId: flight.id,
    fare,
    passengers,
    extraBag,
    extraBagPrice: EXTRA_BAG_PRICE,
    ...quote({ basePrice: flight.basePrice, fareCode: fare, passengers, extraBag }),
  });
});

export default router;
