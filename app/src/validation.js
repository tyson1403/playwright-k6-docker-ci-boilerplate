export const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]{1,29}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const TITLES = ['MR', 'MRS', 'MS'];
export const MAX_PASSENGERS = 9;

export function validatePassengers(passengers) {
  const errors = [];
  if (!Array.isArray(passengers) || passengers.length === 0) {
    return [{ field: 'passengers', message: 'At least one passenger is required' }];
  }
  if (passengers.length > MAX_PASSENGERS) {
    return [{ field: 'passengers', message: `A booking can have at most ${MAX_PASSENGERS} passengers` }];
  }
  passengers.forEach((p, i) => {
    if (!TITLES.includes(p?.title)) errors.push({ field: `passengers[${i}].title`, message: `Title must be one of ${TITLES.join(', ')}` });
    if (!NAME_PATTERN.test(p?.firstName || '')) errors.push({ field: `passengers[${i}].firstName`, message: 'First name must be 2-30 letters' });
    if (!NAME_PATTERN.test(p?.lastName || '')) errors.push({ field: `passengers[${i}].lastName`, message: 'Last name must be 2-30 letters' });
  });
  return errors;
}

export function validateRegistration(body) {
  const errors = [];
  if (!EMAIL_PATTERN.test(body?.email || '')) errors.push({ field: 'email', message: 'A valid email is required' });
  if (!NAME_PATTERN.test(body?.firstName || '')) errors.push({ field: 'firstName', message: 'First name must be 2-30 letters' });
  if (!NAME_PATTERN.test(body?.lastName || '')) errors.push({ field: 'lastName', message: 'Last name must be 2-30 letters' });
  const password = String(body?.password || '');
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    errors.push({ field: 'password', message: 'Password must be at least 8 characters with upper, lower case and a number' });
  }
  return errors;
}
