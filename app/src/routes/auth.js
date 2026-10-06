import { Router } from 'express';
import { accounts } from '../store.js';
import { config } from '../config.js';
import { validateRegistration } from '../validation.js';
import { ApiError, badRequest, conflict, unauthorized } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const publicUser = ({ id, email, firstName, lastName, lastLoginAt }) => ({ id, email, firstName, lastName, lastLoginAt });

router.post('/register', (req, res) => {
  const errors = validateRegistration(req.body);
  if (errors.length) throw badRequest('Registration details are invalid', errors);
  if (accounts.findByEmail(req.body.email)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');

  const user = accounts.createUser(req.body);
  res.status(201).json({ user: publicUser(user), ...accounts.createSession(user.id) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw badRequest('Email and password are required');

  const result = accounts.authenticate(email, password);
  if (result.status === 'locked') {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.lockedUntil - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfterSeconds));
    throw new ApiError(
      423,
      'ACCOUNT_LOCKED',
      `Your account is temporarily locked after too many failed login attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
    );
  }
  // Same error for unknown email and wrong password to avoid account enumeration.
  if (result.status === 'invalid') throw unauthorized('Invalid email or password');

  res.json({ user: publicUser(result.user), ...accounts.createSession(result.user.id) });
});

/** Current user and session timings. Calling it also counts as activity (keep-alive). */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), session: req.session });
});

router.post('/logout', requireAuth, (req, res) => {
  accounts.deleteSession(req.token);
  res.status(204).end();
});

/** Public, non-sensitive policy values the UI needs (e.g. for the idle-timeout warning). */
router.get('/policy', (_req, res) => {
  const { lockoutThreshold, lockoutMinutes, sessionIdleMinutes, sessionAbsoluteHours } = config.auth;
  res.json({ lockoutThreshold, lockoutMinutes, sessionIdleMinutes, sessionAbsoluteHours });
});

export default router;
