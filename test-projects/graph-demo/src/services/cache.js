import { API_VERSION } from './api';

const store = new Map();

export function getCached(key) {
  if (!store.has(key)) return null;
  return { ...store.get(key), cachedWithVersion: API_VERSION };
}

export function setCached(key, value) {
  store.set(key, value);
}
