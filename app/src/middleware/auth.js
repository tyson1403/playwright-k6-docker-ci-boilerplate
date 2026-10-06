import { resolveSession } from '../store.js';
import { unauthorized } from '../errors.js';

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Attaches req.user when a valid token is sent; anonymous requests pass through. */
export function optionalAuth(req, _res, next) {
  const token = bearerToken(req);
  if (token) {
    req.token = token;
    req.user = resolveSession(token);
  }
  next();
}

export function requireAuth(req, _res, next) {
  optionalAuth(req, _res, () => {
    if (!req.user) return next(unauthorized());
    next();
  });
}
