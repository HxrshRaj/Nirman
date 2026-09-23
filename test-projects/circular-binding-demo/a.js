import { bFn } from './b';

export const A_VALUE = 'a-value';

export function aFn() {
  return 'a-called';
}

console.log('a.js top-level, calling bFn():', bFn());
