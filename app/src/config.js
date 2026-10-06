import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const number = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);

export const config = {
  dbPath: process.env.DB_PATH || path.join(appRoot, 'data', 'skylane.db'),
  auth: {
    lockoutThreshold: number('LOCKOUT_THRESHOLD', 5), // consecutive failed logins before locking
    lockoutMinutes: number('LOCKOUT_MINUTES', 15),
    sessionIdleMinutes: number('SESSION_IDLE_MINUTES', 15), // sliding inactivity timeout
    sessionAbsoluteHours: number('SESSION_ABSOLUTE_HOURS', 8), // hard limit, even if active
  },
};
