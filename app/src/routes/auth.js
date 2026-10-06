import { Router } from 'express';
import { createSession, createUser, deleteSession, findUser, verifyPassword } from '../store.js';
import { validateRegistration } from '../validation.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const publicUser = ({ id, email, firstName, lastName }) => ({ id, email, firstName, lastName });

router.post('/register', (req, res) => {
  const errors = validateRegistration(req.body);
  if (errors.length) throw badRequest('Registration details are invalid', errors);
  if (findUser(req.body.email)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');

  const user = createUser(req.body);
  res.status(201).json({ user: publicUser(user), ...createSession(user.email) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw badRequest('Email and password are required');
  const user = findUser(email);
  // Same error for unknown email and wrong password to avoid account enumeration.
  if (!user || !verifyPassword(String(password), user.passwordHash)) throw unauthorized('Invalid email or password');
  res.json({ user: publicUser(user), ...createSession(user.email) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/logout', requireAuth, (req, res) => {
  deleteSession(req.token);
  res.status(204).end();
});

export default router;
