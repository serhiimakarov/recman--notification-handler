import { normalizeEmail, normalizeDate } from '../normalize.js';

export default {
  typeId: 3,
  normalize: (e) => ({
    email: normalizeEmail(e.email),
    deleted: normalizeDate(e.deleted, 'deleted'),
  }),
};
