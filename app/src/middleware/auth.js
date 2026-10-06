import { accounts } from '../store.js';
import { ApiError, unauthorized } from '../errors.js';

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/**
 * Attaches req.user / req.session for a valid token and slides the idle timeout.
 * Anonymous requests pass through. A token that was sent but has expired is
 * rejected, so a logged-in customer never silently continues as a guest.
 */
export function optionalAuth(req, _res, next) {
  const token = bearerToken(req);
  if (!token) return next();

  const result = accounts.resolveSession(token);
  if (result.status === 'expired') {
    return next(new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.'));
  }
  if (result.status === 'invalid') return next(unauthorized('Invalid or revoked session'));

  req.token = token;
  req.user = result.user;
  req.session = result.session;
  next();
}

export function requireAuth(req, res, next) {
  optionalAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user) return next(unauthorized());
    next();
  });
}
