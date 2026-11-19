import { requireString, normalizeEmail, normalizeDate, normalizeRoles } from '../normalize.js';

export default {
  typeId: 1,
  normalize: (e) => ({
    name: requireString(e.name, 'name'),
    email: normalizeEmail(e.email),
    roles: normalizeRoles(e.roles),
    joined: normalizeDate(e.joined, 'joined'),
  }),
};
