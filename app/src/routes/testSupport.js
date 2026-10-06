// Test hooks. Only mounted when ENABLE_TEST_API is not "false" - never in production.
import { Router } from 'express';
import { findFlight } from '../services/schedule.js';
import * as store from '../store.js';
import { badRequest, notFound } from '../errors.js';

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

export default router;
