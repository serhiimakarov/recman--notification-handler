import { normalizeEmail, normalizeDate } from '../normalize.js';

export default {
  typeId: 2,
  normalize: (e) => ({
    email: normalizeEmail(e.email),
    requested: normalizeDate(e.requested, 'requested'),
  }),
};
