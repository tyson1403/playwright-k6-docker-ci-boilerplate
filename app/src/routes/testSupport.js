// Test hooks. Only mounted when ENABLE_TEST_API is not "false" - never in production.
import { Router } from 'express';
import { findFlight } from '../services/schedule.js';
import * as store from '../store.js';
import { badRequest, notFound } from '../errors.js';
import { config } from '../config.js';

const router = Router();

router.post('/reset', (_req, res) => {
  store.reset();
  res.json({ status: 'reset', demoUser: { email: store.DEMO_USER.email, password: store.DEMO_USER.password } });
});

router.put('/flights/:id/inventory', (req, res) => {
  const flight = findFlight(req.params.id);
  if (!flight) throw notFound(`Flight ${req.params.id} not found`);
  const seats = req.body?.seatsAvailable;
  if (!Number.isInteger(seats) || seats < 0 || seats > flight.capacity) {
    throw badRequest(`seatsAvailable must be an integer between 0 and ${flight.capacity}`);
  }
  store.setSeatsAvailable(flight.id, seats);
  res.json({ flightId: flight.id, seatsAvailable: seats });
});

router.get('/stats', (_req, res) => res.json(store.stats()));

// ---- accounts: lets tests check database state and skip waiting for real time to pass ----
router.get('/users/:email', (req, res) => {
  const account = store.accounts.inspect(req.params.email);
  if (!account) throw notFound('User not found');
  res.json(account);
});

router.post('/users/:email/expire-lock', (req, res) => {
  if (!store.accounts.expireLock(req.params.email)) throw notFound('User not found');
  res.json(store.accounts.inspect(req.params.email));
});

/** Body: { token, idleMinutes?, ageMinutes? } - pretends the session has been idle / alive that long. */
router.post('/sessions/age', (req, res) => {
  const { token, idleMinutes = 0, ageMinutes = 0 } = req.body || {};
  if (!Number.isFinite(idleMinutes) || !Number.isFinite(ageMinutes)) throw badRequest('idleMinutes and ageMinutes must be numbers');
  if (!token || !store.accounts.ageSession(token, { idleMinutes, ageMinutes })) throw notFound('Session not found');
  res.json({ status: 'aged', idleMinutes, ageMinutes });
});

router.get('/config', (_req, res) => res.json({ auth: config.auth }));

export default router;
