import { getCached, setCached } from './cache';
import { APP_NAME } from '../constants';

export const API_VERSION = 'v1';

export async function fetchData(key) {
  const cached = getCached(key);
  if (cached) return cached;
  const value = { key, source: APP_NAME, version: API_VERSION };
  setCached(key, value);
  return value;
}
