import { fetchData } from '../services/api';

export const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadInto(key) {
  const data = await fetchData(key);
  for (const fn of listeners) fn(data);
  return data;
}
