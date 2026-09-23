// Namespace import, not a destructured named import, on purpose: `api` and `./api`
// are circularly dependent (api.js -> cache.js -> api.js). A destructured
// `import { API_VERSION } from './api'` would snapshot whatever value API_VERSION has
// at the moment THIS file is first evaluated -- which, given the circular ordering
// here, is before api.js has assigned it. Reading `api.API_VERSION` lazily, inside a
// function body called after the whole graph has finished loading, always sees the
// real value. See docs/module-resolution.md for the full writeup of this edge case.
import * as api from './api';

const store = new Map();

export function getCached(key) {
  if (!store.has(key)) return null;
  return { ...store.get(key), cachedWithVersion: api.API_VERSION };
}

export function setCached(key, value) {
  store.set(key, value);
}
