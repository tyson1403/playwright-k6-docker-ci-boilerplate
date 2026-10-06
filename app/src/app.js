import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import flightRoutes from './routes/flights.js';
import bookingRoutes from './routes/bookings.js';
import testRoutes from './routes/testSupport.js';
import { ApiError } from './errors.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const startedAt = Date.now();

export function createApp({ enableTestApi = process.env.ENABLE_TEST_API !== 'false', logRequests = process.env.LOG_REQUESTS === 'true' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    if (logRequests) {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'skylane-air', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', flightRoutes);
  app.use('/api/bookings', bookingRoutes);
  if (enableTestApi) app.use('/api/test', testRoutes);

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found')));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });

  return app;
}
