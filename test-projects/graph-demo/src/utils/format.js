import { add, clamp } from './math';
import { capitalize, truncate } from './string';

export function formatScore(score) {
  const clamped = clamp(add(score, 0), 0, 100);
  return `${clamped}%`;
}

export function formatTitle(title) {
  return truncate(capitalize(title), 20);
}
